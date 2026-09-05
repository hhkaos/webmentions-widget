import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  WebmentionFetchError,
  excerptText,
  fetchWebmentions,
  filterMentionsByTargets,
  getCanonicalTargets,
  getMentionContent,
  getMentionSourceUrl,
  getMentionType,
  getSnapshotMentions,
  groupWebmentions,
  mergeSnapshot,
  normalizeJsonFeed,
  normalizeProperty,
  parseWebmentionJson,
  repairJson,
  stripMojibake,
} from '../src/core.js';

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

describe('getCanonicalTargets', () => {
  it('covers www, no-www and both slash forms', () => {
    const targets = getCanonicalTargets({
      siteUrl: 'https://www.example.com',
      pathname: '/blog/post',
      i18n: {locales: ['en'], defaultLocale: 'en'},
      localePrefixes: [],
    });

    assert.ok(targets.includes('https://www.example.com/blog/post'));
    assert.ok(targets.includes('https://www.example.com/blog/post/'));
    assert.ok(targets.includes('https://example.com/blog/post'));
    assert.ok(targets.includes('https://example.com/blog/post/'));
  });

  it('adds locale-prefixed variants and strips them for localized paths', () => {
    const i18n = {locales: ['en', 'es'], defaultLocale: 'en'};

    const fromDefault = getCanonicalTargets({
      siteUrl: 'https://www.example.com',
      pathname: '/blog/post',
      i18n,
    });
    assert.ok(fromDefault.includes('https://www.example.com/es/blog/post'));

    const fromLocalized = getCanonicalTargets({
      siteUrl: 'https://www.example.com',
      pathname: '/es/blog/post',
      i18n,
    });
    assert.ok(fromLocalized.includes('https://www.example.com/blog/post'));
    assert.ok(fromLocalized.includes('https://www.example.com/es/blog/post'));
  });

  it('drops query strings and fragments, and returns nothing without a site url', () => {
    const targets = getCanonicalTargets({
      siteUrl: 'https://example.com',
      pathname: '/post',
      localePrefixes: [],
    });

    assert.ok(targets.every((target) => !target.includes('?') && !target.includes('#')));
    assert.deepEqual(getCanonicalTargets({}), []);
  });
});

describe('property normalization', () => {
  it('folds the two spellings of "mention" together', () => {
    assert.equal(normalizeProperty('mention'), 'mention-of');
    assert.equal(normalizeProperty('like-of'), 'like-of');
    assert.equal(getMentionType({'wm-property': 'mention'}), 'Mention');
    assert.equal(getMentionType({'wm-property': 'mention-of'}), 'Mention');
  });

  it('honours custom labels', () => {
    assert.equal(
      getMentionType({'wm-property': 'in-reply-to'}, {'in-reply-to': 'respondió'}),
      'respondió',
    );
  });
});

describe('stripMojibake', () => {
  it('removes replacement chars and question-mark runs left by emoji', () => {
    assert.equal(stripMojibake('Great post ???? really'), 'Great post really');
    assert.equal(stripMojibake('Nice ��� one'), 'Nice one');
    assert.equal(stripMojibake('Wait ???!'), 'Wait!');
  });
});

describe('groupWebmentions', () => {
  const mention = (overrides) => ({
    'wm-source': `https://source.example/${Math.random()}`,
    ...overrides,
  });

  it('splits facepile properties from thread properties', () => {
    const groups = groupWebmentions([
      mention({'wm-id': 1, 'wm-property': 'like-of', author: {url: 'https://a.example'}}),
      mention({'wm-id': 2, 'wm-property': 'repost-of', author: {url: 'https://b.example'}}),
      mention({'wm-id': 3, 'wm-property': 'in-reply-to', author: {url: 'https://c.example'}}),
      mention({'wm-id': 4, 'wm-property': 'mention', author: {url: 'https://d.example'}}),
    ]);

    assert.equal(groups.interactions.length, 2);
    assert.equal(groups.threads.length, 2);
    assert.equal(groups.byProperty['like-of'].length, 1);
    assert.equal(groups.byProperty['repost-of'].length, 1);
    assert.equal(groups.counts['like-of'], 1);
    assert.equal(groups.total, 4);
  });

  it('dedupes the facepile per author per property, but keeps a like and a repost from the same author', () => {
    const author = {url: 'https://same.example/@me'};
    const groups = groupWebmentions([
      mention({'wm-id': 1, 'wm-property': 'like-of', author}),
      mention({'wm-id': 2, 'wm-property': 'like-of', author}),
      mention({'wm-id': 3, 'wm-property': 'repost-of', author}),
    ]);

    assert.equal(groups.byProperty['like-of'].length, 1);
    assert.equal(groups.byProperty['repost-of'].length, 1);
  });

  it('dedupes repeated wm-ids arriving from overlapping target queries', () => {
    const duplicate = {
      'wm-id': 99,
      'wm-property': 'in-reply-to',
      'wm-source': 'https://source.example/reply',
    };

    assert.equal(groupWebmentions([duplicate, {...duplicate}]).threads.length, 1);
  });

  it('ignores entries with no source and tolerates a nullish feed', () => {
    assert.equal(groupWebmentions([{'wm-property': 'like-of'}, null]).total, 0);
    assert.equal(groupWebmentions(undefined).total, 0);
  });
});

describe('excerpting and source links', () => {
  it('keeps short content untouched and truncates long content on a word boundary', () => {
    assert.equal(excerptText('Short and sweet'), 'Short and sweet');

    const long = 'word '.repeat(80).trim();
    const excerpt = excerptText(long, {maxLength: 40});

    assert.ok(excerpt.length <= 40);
    assert.ok(excerpt.endsWith('...'));
  });

  it('centres the excerpt on the focus text', () => {
    const content = `${'a '.repeat(60)}NEEDLE ${'b '.repeat(60)}`.trim();
    const excerpt = excerptText(content, {focus: 'NEEDLE', maxLength: 60});

    assert.ok(excerpt.includes('NEEDLE'));
    assert.ok(excerpt.startsWith('...'));
  });

  it('appends a text fragment to the source url', () => {
    const url = getMentionSourceUrl(
      {url: 'https://source.example/post'},
      '...quoted sentence...',
    );

    assert.equal(url, 'https://source.example/post#:~:text=quoted%20sentence');
  });

  it('leaves the source url alone when there is no content', () => {
    assert.equal(
      getMentionSourceUrl({url: 'https://source.example/post'}, ''),
      'https://source.example/post',
    );
  });
});

describe('getMentionContent', () => {
  it('falls back to plain text when no HTML parser is available', () => {
    const content = getMentionContent({
      content: {text: 'A plain text reply'},
      'wm-target': 'https://example.com/post',
    }, {parseHTML: () => null});

    assert.equal(content, 'A plain text reply');
  });

  it('uses an injected parser to quote around the backlink', () => {
    const paragraph = {
      tagName: 'P',
      textContent: 'Before __webmention_link_context__the post__webmention_link_context__ after',
    };
    const link = {
      textContent: 'the post',
      href: 'https://example.com/post',
      getAttribute: () => 'https://example.com/post',
      parentElement: paragraph,
      insertAdjacentText: () => {},
    };
    const parseHTML = () => ({querySelectorAll: () => [link]});

    const content = getMentionContent({
      content: {html: '<p>Before <a href="https://example.com/post">the post</a> after</p>'},
      'wm-target': 'https://example.com/post',
      'wm-source': 'https://source.example/x',
    }, {parseHTML});

    assert.equal(content, 'Before the post after');
  });
});

describe('normalizeJsonFeed', () => {
  it('reshapes the legacy .json payload into jf2 entries', () => {
    const entries = normalizeJsonFeed({
      links: [{
        id: 7,
        source: 'https://brid.gy/like/mastodon/x',
        target: 'https://example.com/post',
        verified_date: '2026-09-02T10:22:05+00:00',
        activity: {type: 'like'},
        data: {author: {name: 'Someone'}, url: 'https://mastodon.example/x', content: 'hi'},
      }],
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0]['wm-property'], 'like-of');
    assert.equal(entries[0]['wm-id'], 7);
    assert.equal(entries[0]['wm-source'], 'https://brid.gy/like/mastodon/x');
    assert.equal(entries[0].content.text, 'hi');
  });

  it('defaults unknown activity types to a mention', () => {
    const [entry] = normalizeJsonFeed({links: [{source: 's', activity: {type: 'wat'}}]});

    assert.equal(entry['wm-property'], 'mention-of');
    assert.deepEqual(normalizeJsonFeed({}), []);
  });
});

describe('fetchWebmentions resilience', () => {
  const targets = ['https://example.com/post'];

  it('retries past a transient 502 and returns the feed', async () => {
    const statuses = [502, 502, 200];
    let calls = 0;

    const mentions = await fetchWebmentions({
      targets,
      retries: 2,
      retryDelayMs: 0,
      fetch: async () => {
        const status = statuses[calls];
        calls += 1;

        return status === 200
          ? response(200, {children: [{'wm-id': 1, 'wm-source': 'https://s.example'}]})
          : response(status);
      },
    });

    assert.equal(calls, 3);
    assert.equal(mentions.length, 1);
  });

  it('retries past a network-level failure (the CORS-masked 502 case)', async () => {
    let calls = 0;

    const mentions = await fetchWebmentions({
      targets,
      retries: 1,
      retryDelayMs: 0,
      fetch: async () => {
        calls += 1;

        if (calls === 1) {
          throw new TypeError('Failed to fetch');
        }

        return response(200, {children: []});
      },
    });

    assert.equal(calls, 2);
    assert.deepEqual(mentions, []);
  });

  it('falls back to the .json endpoint when jf2 stays down', async () => {
    const urls = [];

    const mentions = await fetchWebmentions({
      targets,
      retries: 1,
      retryDelayMs: 0,
      fetch: async (url) => {
        urls.push(url);

        return url.includes('mentions.json')
          ? response(200, {links: [{id: 1, source: 'https://s.example', activity: {type: 'reply'}}]})
          : response(502);
      },
    });

    assert.equal(urls.filter((url) => url.includes('mentions.jf2')).length, 2);
    assert.ok(urls.at(-1).includes('mentions.json'));
    assert.equal(mentions[0]['wm-property'], 'in-reply-to');
  });

  it('does not retry a 4xx, but still tries the fallback endpoint', async () => {
    const urls = [];

    await assert.rejects(
      fetchWebmentions({
        targets,
        retries: 3,
        retryDelayMs: 0,
        fetch: async (url) => {
          urls.push(url);

          return response(400);
        },
      }),
      WebmentionFetchError,
    );

    assert.equal(urls.length, 2);
  });

  it('throws a typed error carrying the status once every attempt is spent', async () => {
    await assert.rejects(
      fetchWebmentions({
        targets,
        retries: 1,
        retryDelayMs: 0,
        fallbackToJson: false,
        fetch: async () => response(502),
      }),
      (error) => {
        assert.ok(error instanceof WebmentionFetchError);
        assert.equal(error.status, 502);
        assert.equal(error.attempts, 2);

        return true;
      },
    );
  });

  it('propagates aborts instead of retrying them', async () => {
    await assert.rejects(
      fetchWebmentions({
        targets,
        retries: 5,
        retryDelayMs: 0,
        fetch: async () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';

          throw error;
        },
      }),
      /Aborted/,
    );
  });

  it('sends every target and returns early when there are none', async () => {
    let requestUrl = '';

    await fetchWebmentions({
      targets: ['https://a.example/p', 'https://b.example/p'],
      retryDelayMs: 0,
      fetch: async (url) => {
        requestUrl = url;

        return response(200, {children: []});
      },
    });

    assert.equal(requestUrl.match(/target%5B%5D=/g).length, 2);
    assert.deepEqual(await fetchWebmentions({targets: [], document: null}), []);
  });
});

describe('snapshot helpers', () => {
  const snapshot = {
    generatedAt: '2026-09-05T00:00:00Z',
    lastId: 3,
    mentions: [
      {'wm-id': 3, 'wm-target': 'https://www.example.com/post', 'wm-property': 'like-of', 'wm-source': 'https://s/3'},
      {'wm-id': 2, 'wm-target': 'https://example.com/post/', 'wm-property': 'in-reply-to', 'wm-source': 'https://s/2'},
      {'wm-id': 1, 'wm-target': 'https://www.example.com/other', 'wm-property': 'like-of', 'wm-source': 'https://s/1'},
    ],
  };

  it('narrows a whole-domain snapshot to one page, ignoring trailing slashes', () => {
    const mentions = filterMentionsByTargets(getSnapshotMentions(snapshot), [
      'https://www.example.com/post',
      'https://example.com/post',
    ]);

    assert.deepEqual(mentions.map((m) => m['wm-id']), [3, 2]);
  });

  it('returns nothing without targets, and reads a bare array snapshot', () => {
    assert.deepEqual(filterMentionsByTargets(snapshot.mentions, []), []);
    assert.equal(getSnapshotMentions(snapshot.mentions).length, 3);
    assert.deepEqual(getSnapshotMentions(undefined), []);
  });

  it('merges incremental fetches, deduping by wm-id and tracking the high-water mark', () => {
    const merged = mergeSnapshot(snapshot, [
      {'wm-id': 4, 'wm-target': 'https://www.example.com/post', 'wm-source': 'https://s/4'},
      {'wm-id': 3, 'wm-target': 'https://www.example.com/post', 'wm-source': 'https://s/3-updated'},
    ]);

    assert.equal(merged.count, 4);
    assert.equal(merged.lastId, 4);
    assert.deepEqual(merged.mentions.map((m) => m['wm-id']), [4, 3, 2, 1]);
    assert.equal(merged.mentions[1]['wm-source'], 'https://s/3-updated', 'incoming wins on conflict');
  });

  it('builds a snapshot from nothing', () => {
    const merged = mergeSnapshot(null, [{'wm-id': 9, 'wm-source': 'https://s/9'}]);

    assert.equal(merged.count, 1);
    assert.equal(merged.lastId, 9);
  });
});

describe('malformed payload repair', () => {
  it('parses a payload with an unescaped backslash in content', () => {
    const raw = '{"children":[{"content":{"text":"curl foo \\ bar"}}]}';

    assert.throws(() => JSON.parse(raw), SyntaxError, 'precondition: raw is invalid');
    assert.equal(parseWebmentionJson(raw).children[0].content.text, 'curl foo \\ bar');
  });

  it('parses a payload with a raw newline inside a string', () => {
    const raw = '{"children":[{"content":{"text":"line one\nline two"}}]}';

    assert.throws(() => JSON.parse(raw), SyntaxError);
    assert.equal(parseWebmentionJson(raw).children[0].content.text, 'line one\nline two');
  });

  it('leaves valid escapes and valid payloads untouched', () => {
    const valid = '{"children":[{"content":{"text":"quote \\" tab \\t unicode \\u00e9"}}]}';

    assert.equal(repairJson(valid), valid);
    assert.equal(parseWebmentionJson(valid).children[0].content.text, 'quote " tab \t unicode é');
  });

  it('does not mangle backslashes outside string literals', () => {
    assert.equal(repairJson('{"a": 1}'), '{"a": 1}');
  });

  it('still throws when the payload is not JSON at all', () => {
    assert.throws(() => parseWebmentionJson('<html>502 Bad Gateway</html>'), SyntaxError);
  });
});
