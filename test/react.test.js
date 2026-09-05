import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

import {Webmentions} from '../src/react.js';

// `initialMentions` seeds state synchronously, so the component renders its
// real markup during a server render instead of waiting on an effect.
const mentions = [
  {'wm-id': 1, 'wm-property': 'like-of', 'wm-source': 'https://s/1', author: {name: 'Ana', url: 'https://a', photo: 'https://a/p.png'}},
  {'wm-id': 2, 'wm-property': 'repost-of', 'wm-source': 'https://s/2', author: {name: 'Bea', url: 'https://b'}},
  {
    'wm-id': 3,
    'wm-property': 'in-reply-to',
    'wm-source': 'https://s/3',
    url: 'https://s/3',
    author: {name: 'Cid', url: 'https://c'},
    content: {text: 'Great post'},
    published: '2026-09-02T10:22:05Z',
  },
];

const render = (props) => renderToStaticMarkup(createElement(Webmentions, {
  targets: ['https://example.com/post'],
  initialMentions: mentions,
  ...props,
}));

describe('<Webmentions>', () => {
  it('renders a facepile and a thread list', () => {
    const html = render();

    assert.match(html, /<aside class="webmentions"/);
    assert.match(html, /<h2 id="webmentions-title-heading"/);
    assert.equal(html.match(/webmention-facepile-item/g).length, 2);
    assert.equal(html.match(/class="h-cite webmention"/g).length, 1);
    assert.match(html, /Great post/);
  });

  it('wraps the content in innerClassName when asked', () => {
    assert.match(render({innerClassName: 'container'}), /<aside class="webmentions"[^>]*><div class="container">/);
    assert.doesNotMatch(render(), /<div class="container">/);
  });

  it('renders nothing when there are no mentions', () => {
    assert.equal(render({initialMentions: []}), '');
  });

  it('uses the initial character when an author has no photo', () => {
    const html = render();

    assert.match(html, /<span class="webmention-facepile-photo is-initial" aria-hidden="true"[^>]*>B<\/span>/);
  });

  // A thread row without an avatar has a different layout from one with it, and
  // an h-card with no `photo` is common enough that the gap would be the norm.
  it('gives a thread mention an avatar even when its author has no photo', () => {
    assert.match(render(), /<span class="webmention-photo is-initial" aria-hidden="true"[^>]*>C<\/span>/);
  });

  it('carries a per-author hue on the fallback avatar', () => {
    const html = render();
    const hues = [...html.matchAll(/--webmention-avatar-hue:(\d+)/g)].map(([, hue]) => hue);

    assert.equal(hues.length, 2);
    assert.notEqual(hues[0], hues[1]);
  });
});

describe('<Webmentions> with a build-time snapshot', () => {
  const snapshot = {
    mentions: [
      {'wm-id': 7, 'wm-target': 'https://example.com/post/', 'wm-property': 'like-of', 'wm-source': 'https://s/7', author: {name: 'Eve'}},
      {'wm-id': 8, 'wm-target': 'https://example.com/elsewhere', 'wm-property': 'like-of', 'wm-source': 'https://s/8', author: {name: 'Mal'}},
    ],
  };

  it('renders the page\'s own mentions without touching the network', () => {
    let fetched = false;
    const html = renderToStaticMarkup(createElement(Webmentions, {
      targets: ['https://example.com/post'],
      snapshot,
      fetch: () => {
        fetched = true;

        throw new Error('should not be called');
      },
    }));

    assert.match(html, /webmention-facepile-item/);
    assert.equal(html.match(/webmention-facepile-item/g).length, 1, 'only this page\'s mention');
    assert.equal(fetched, false);
  });

  it('renders nothing when the snapshot has nothing for this page', () => {
    const html = renderToStaticMarkup(createElement(Webmentions, {
      targets: ['https://example.com/untouched'],
      snapshot,
    }));

    assert.equal(html, '');
  });
});

describe('snapshot freshness line', () => {
  // Deliberately old: a fixture inside the relative-time window would make the
  // assertion depend on when the suite runs.
  const snapshot = {
    generatedAt: '2026-01-15T06:00:00Z',
    mentions: [
      {'wm-id': 7, 'wm-target': 'https://example.com/post', 'wm-property': 'like-of', 'wm-source': 'https://s/7', author: {name: 'Eve'}},
    ],
  };
  const targets = ['https://example.com/post'];

  it('dates the snapshot when a label is supplied', () => {
    const html = renderToStaticMarkup(createElement(Webmentions, {
      targets,
      snapshot,
      locale: 'en',
      labels: {updated: 'Updated'},
    }));

    // React's static renderer emits `dateTime`; HTML attribute names are
    // case-insensitive, so the browser reads it as `datetime` either way.
    assert.match(html, /class="webmentions-updated">Updated <time dateTime="2026-01-15T06:00:00Z"[^>]*>Jan 15, 2026<\/time>/i);
    assert.doesNotMatch(html, /role="button"/, 'an old snapshot needs no toggle');
  });

  it('stays quiet without a label, and on a live fetch', () => {
    assert.doesNotMatch(
      renderToStaticMarkup(createElement(Webmentions, {targets, snapshot})),
      /webmentions-updated/,
    );

    // initialMentions stands in for freshly fetched data: no snapshot date.
    assert.doesNotMatch(
      renderToStaticMarkup(createElement(Webmentions, {
        targets,
        initialMentions: snapshot.mentions,
        labels: {updated: 'Updated'},
      })),
      /webmentions-updated/,
    );
  });

  it('shows a recent snapshot as relative time, clickable for the exact moment', () => {
    const html = renderToStaticMarkup(createElement(Webmentions, {
      targets,
      snapshot: {...snapshot, generatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()},
      locale: 'en',
      labels: {updated: 'Updated'},
    }));

    assert.match(html, /hours ago<\/time>/);
    assert.match(html, /role="button"/);
    assert.match(html, /title="[^"]+"/, 'exact moment available on hover');
  });

  it('renders bilingual labels and honours renderUpdated', () => {
    const bilingual = renderToStaticMarkup(createElement(Webmentions, {
      targets,
      snapshot,
      labels: {updated: {en: 'Updated', es: 'Actualizado'}},
    }));

    assert.match(bilingual, /<span class="i18n-en" lang="en">Updated<\/span>/);
    assert.match(bilingual, /<span class="i18n-es" lang="es">Actualizado<\/span>/);

    const custom = renderToStaticMarkup(createElement(Webmentions, {
      targets,
      snapshot,
      renderUpdated: (iso, formatted) => `refreshed ${formatted}`,
    }));

    assert.match(custom, /refreshed/);
  });
});
