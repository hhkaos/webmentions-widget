# @hhkaos/webmentions-widget

Fetch and render [webmention.io](https://webmention.io) mentions for the current page.

Dependency-free, buildless ES modules. One implementation shared by every site
instead of a copy per repo — see [#1](https://github.com/hhkaos/webmentions-widget/issues/1)
for the history.

## Why it exists

Three sites had grown three near-identical copies of "query `mentions.jf2`, dedupe,
render a facepile and a reply list". When webmention.io started returning
intermittent `502`s in September 2026, every copy had the same flaw: a single
un-retried `fetch`, and a widget that hides itself on failure. The 502 comes from
nginx with **no `Access-Control-Allow-Origin` header**, so in a browser it surfaces
as an opaque `Failed to fetch` — and the section silently vanished on all three
sites at once.

So this package builds the fixes in once:

- **Retries with exponential backoff** on network errors and 5xx.
- **Automatic fallback** from `/api/mentions.jf2` to the older `/api/mentions.json`,
  reshaped into the same entry format.
- **`error` is distinct from empty**, so a caller can keep server-rendered markup
  on screen during an outage instead of blanking the section.
- **Target URL variants** — `www`/no-`www`, trailing slash or not, locale prefixes.
  webmention.io matches targets by exact string, so this is the single most common
  cause of "the mention exists but does not show up".

## Install

```sh
npm install @hhkaos/webmentions-widget
```

Or load it straight from a CDN — **always pin the version**, never `@latest`:

```html
<script type="module">
  import {renderWebmentions} from 'https://esm.sh/@hhkaos/webmentions-widget@0.1.0/render';
</script>
```

## Vanilla usage

```html
<section class="webmentions h-feed" id="webmentions" hidden>
  <h2>Mentions</h2>
  <div class="webmentions__facepile" id="webmentions-facepile" hidden></div>
  <ol class="webmentions__list" id="webmentions-list"></ol>
</section>

<script type="module">
  import {renderWebmentions} from '@hhkaos/webmentions-widget/render';

  renderWebmentions({
    container: '#webmentions',
    facepile: '#webmentions-facepile',
    list: '#webmentions-list',
    // targets default to <link rel="canonical"> expanded into every variant
    facepileMode: 'grouped',
    labels: {
      'like-of': {en: 'like', es: 'me gusta'},
      'in-reply-to': {en: 'replied', es: 'respondió'},
      viewSource: {en: 'View source', es: 'Ver original'},
    },
    onError: (error) => console.warn('[webmentions]', error),
  });
</script>
```

A label can be a plain string, or a `{en, es}` map — which renders one
`<span class="i18n-en">` / `<span class="i18n-es">` per language, for sites that
ship both and toggle with CSS.

`facepileMode: 'grouped'` renders a separate like / repost / bookmark group with a
count and a glyph. `'flat'` (the default) renders one merged pile.

## React / Docusaurus usage

```jsx
import {getCanonicalTargets} from '@hhkaos/webmentions-widget';
import {Webmentions} from '@hhkaos/webmentions-widget/react';
import {useLocation} from '@docusaurus/router';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

export default function SiteWebmentions() {
  const {pathname} = useLocation();
  const {siteConfig} = useDocusaurusContext();
  const targets = getCanonicalTargets({
    siteUrl: siteConfig.url,
    pathname,
    i18n: siteConfig.i18n,
  });

  return <Webmentions targets={targets} locale="es" />;
}
```

`useWebmentions(targets, options)` is exported separately if you want the data
without the markup. It returns `{status, groups, error}` where `status` is
`idle | loading | success | error`.

## Build-time snapshot (recommended)

By default the widget fetches in the browser, which costs webmention.io one
request per visitor per page view — and leaves the section empty whenever their
API is down. A snapshot inverts that: fetch once per day in CI, commit the
result, and serve it as data.

```sh
npx webmentions-snapshot --domain example.com --out src/data/webmentions.json
```

Domain-wide queries need an API token (webmention.io → Settings → API Key),
read from `WEBMENTION_IO_TOKEN`. The command fetches only what is new since the
last run (`since_id`), waits between pages, and leaves the existing file
untouched if the API errors — a bad fetch never replaces good data.

Then hand the snapshot to the component:

```jsx
import snapshot from '@site/src/data/webmentions.json';

<Webmentions targets={targets} snapshot={snapshot} />
```

The component narrows the whole-site snapshot to the current page locally and
renders with **no network request at all**. Pass `revalidate` to opt back into
a live fetch on top (the snapshot renders first either way, and a failed
revalidation never blanks a section the snapshot could fill).

Two things this buys beyond politeness: the section survives a webmention.io
outage, and the committed JSON is a durable copy of your mentions if the
service ever disappears.

### Saying how fresh it is

A snapshot is by definition a little behind. Pass an `updated` label and the
widget dates what it is showing:

```jsx
<Webmentions
  targets={targets}
  snapshot={snapshot}
  locale="es"
  labels={{updated: {en: 'Updated', es: 'Actualizado'}}}
/>
```

It renders only when the mentions came from a snapshot and there is at least one
to qualify — on a live fetch the data is current and dating it would mislead.
`renderUpdated={(iso, formatted) => …}` takes over the wording entirely.

The widget owns this because it is the only layer that knows which source the
mentions came from; the host owns the copy.

## API

### `fetchWebmentions(options)`

| Option | Default | Notes |
| --- | --- | --- |
| `targets` | from `<link rel="canonical">` | array of exact target URLs |
| `apiUrl` | `.../api/mentions.jf2` | |
| `jsonApiUrl` | `.../api/mentions.json` | used only for the fallback |
| `perPage` | `20` | |
| `sortBy` / `sortDir` | `published` / `down` | |
| `retries` | `2` | extra attempts *per endpoint* |
| `retryDelayMs` | `400` | doubles each attempt |
| `fallbackToJson` | `true` | |
| `signal` | — | `AbortSignal`; aborts are never retried |
| `fetch` | `globalThis.fetch` | injectable, for tests or a proxy |

Resolves to an array of jf2 entries. Rejects with a `WebmentionFetchError`
(carrying `.status` and `.attempts`) once every attempt is spent. A `4xx` is not
retried — it will not fix itself — but the fallback endpoint is still tried.

### `getCanonicalTargets({siteUrl, pathname, i18n, localePrefixes})`

Expands one page into every target string webmention.io might have stored it under.

### `groupWebmentions(mentions)`

Returns `{interactions, threads, byProperty, counts, total}`. Facepile entries are
deduped per author *per property*, so one person's like and repost both survive.
Duplicate `wm-id`s from overlapping target queries are dropped.

### `getMentionContent(mention, {maxLength, parseHTML})`

Finds the anchor in the source page that points back at you and quotes the
sentence around it, rather than excerpting from the top of the post. Falls back to
`content.text`. Pass `parseHTML` to run outside a browser.

### `getMentionSourceUrl(mention, content)`

Appends a `#:~:text=` fragment so the source link lands on the quoted sentence.

### `renderWebmentions(options)` / `renderGroups(groups, options)`

Imperative DOM rendering. `renderGroups` paints an already-fetched feed, so a site
can hydrate from a build-time snapshot without touching the network.

Every remote string is written with `textContent`. Nothing in this package ever
assigns remote HTML.

## Notes on webmention.io quirks

- The jf2 feed says `mention-of`; some payloads say `mention`. `normalizeProperty`
  folds them together, so only ever branch on `mention-of`.
- Bridgy mangles emoji into runs of `?` and `U+FFFD` when extracting plain text.
  `stripMojibake` removes the debris — the emoji is not recoverable.

## Development

```sh
npm test
```

No dependencies, no build step. Tests run on `node:test` against a ~90-line fake
DOM in `test/fake-dom.js`.

## License

MIT
