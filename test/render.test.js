import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {groupWebmentions} from '../src/core.js';
import {renderGroups, renderWebmentions} from '../src/render.js';
import {createFakeDocument, FakeNode} from './fake-dom.js';

function setup() {
  const doc = createFakeDocument();
  const container = new FakeNode('section', doc);
  const facepile = new FakeNode('div', doc);
  const list = new FakeNode('ol', doc);

  container.appendChild(facepile);
  container.appendChild(list);

  return {doc, container, facepile, list};
}

const feed = [
  {'wm-id': 1, 'wm-property': 'like-of', 'wm-source': 'https://s/1', author: {name: 'Ana', url: 'https://a'}},
  {'wm-id': 2, 'wm-property': 'like-of', 'wm-source': 'https://s/2', author: {name: 'Bea', url: 'https://b'}},
  {'wm-id': 3, 'wm-property': 'repost-of', 'wm-source': 'https://s/3', author: {name: 'Cid', url: 'https://c'}},
  {
    'wm-id': 4,
    'wm-property': 'in-reply-to',
    'wm-source': 'https://s/4',
    url: 'https://s/4',
    author: {name: 'Dan', url: 'https://d'},
    content: {text: 'Nice write-up'},
    published: '2026-09-02T10:22:05Z',
  },
];

describe('renderGroups', () => {
  it('renders a flat facepile by default', () => {
    const {doc, container, facepile, list} = setup();

    renderGroups(groupWebmentions(feed), {container, facepile, list, document: doc});

    assert.equal(facepile.children.length, 3);
    assert.equal(list.children.length, 1);
    assert.equal(container.hidden, false);
    assert.equal(container.getAttribute('aria-hidden'), 'false');
  });

  it('renders one group per property in grouped mode, with counts', () => {
    const {doc, container, facepile, list} = setup();

    renderGroups(groupWebmentions(feed), {
      container,
      facepile,
      list,
      facepileMode: 'grouped',
      document: doc,
      labels: {'like-of': 'me gusta', 'repost-of': 'compartido'},
    });

    assert.equal(facepile.children.length, 2);
    assert.equal(facepile.children[0].getAttribute('aria-label'), '2 me gusta');
    assert.equal(facepile.children[1].getAttribute('aria-label'), '1 compartido');
  });

  it('hides the container when there is nothing to show', () => {
    const {doc, container, facepile, list} = setup();

    renderGroups(groupWebmentions([]), {container, facepile, list, document: doc});

    assert.equal(container.hidden, true);
    assert.equal(facepile.hidden, true);
    assert.equal(list.children.length, 0);
  });

  it('renders bilingual labels as per-language spans', () => {
    const {doc, container, facepile, list} = setup();

    renderGroups(groupWebmentions(feed), {
      container,
      facepile,
      list,
      document: doc,
      labels: {'in-reply-to': {en: 'replied', es: 'respondió'}},
    });

    const spans = list.flatten().filter((node) => node.className.startsWith('i18n-'));

    assert.deepEqual(spans.map((span) => span.className), ['i18n-en', 'i18n-es']);
    assert.deepEqual(spans.map((span) => span.textContent), ['replied', 'respondió']);
  });

  it('never assigns remote markup as HTML', () => {
    const {doc, container, facepile, list} = setup();
    const hostile = [{
      'wm-id': 9,
      'wm-property': 'in-reply-to',
      'wm-source': 'https://s/9',
      url: 'https://s/9',
      author: {name: '<img src=x onerror=alert(1)>'},
      content: {text: '<script>alert(1)</script>'},
    }];

    renderGroups(groupWebmentions(hostile), {container, facepile, list, document: doc});

    const rendered = list.flatten();

    assert.ok(rendered.some((node) => node.textContent === '<script>alert(1)</script>'));
    assert.ok(rendered.every((node) => node.innerHTML === undefined));
  });
});

describe('renderWebmentions', () => {
  const response = (status, body) => ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(body),
  });

  it('leaves existing markup alone and reports the error when the API is down', async () => {
    const {doc, container, facepile, list} = setup();
    const marker = new FakeNode('li', doc);
    list.appendChild(marker);

    const errors = [];
    const result = await renderWebmentions({
      container,
      facepile,
      list,
      targets: ['https://example.com/post'],
      retries: 0,
      retryDelayMs: 0,
      document: doc,
      onError: (error) => errors.push(error),
      fetch: async () => response(502),
    });

    assert.equal(result.status, 'error');
    assert.equal(errors.length, 1);
    assert.equal(list.children.length, 1, 'existing markup survives an outage');
  });
});
