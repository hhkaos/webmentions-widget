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

    assert.match(html, /<span aria-hidden="true">B<\/span>/);
  });
});
