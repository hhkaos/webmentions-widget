# Changelog

All notable changes are documented here. Versions follow [semver](https://semver.org/).

## 0.4.0

### Fixed

- webmention.io sometimes serves **invalid JSON**: its serializer copies source
  content into string literals without escaping it, so a mention whose content
  contains a backslash (a shell example ending in `\`) or a raw newline yields a
  payload `JSON.parse` rejects outright. Such a mention was invisible — not
  because the API was down, but because its response could not be read at all.
  Responses are now parsed with `parseWebmentionJson`, which repairs only what
  will not parse and leaves valid payloads byte-identical.

  Found on `links.rauljimenez.info`, where the single mention had never been
  displayable for this reason, independently of the ongoing 502s.

### Added

- `repairJson` and `parseWebmentionJson` exported from core.

## 0.3.0

### Added

- Optional freshness line: pass an `updated` label and the widget dates the
  snapshot it is showing. Rendered only when the mentions came from a snapshot
  and there is at least one — on a live fetch the data is current and dating it
  would mislead. `renderUpdated` overrides the wording; the vanilla renderer
  takes `updatedAt` plus an `updated` element.
- `useWebmentions` now reports `source` (`'snapshot' | 'network'`) and
  `generatedAt`, so a host can tell where what it is rendering came from.

## 0.2.0

### Added

- Build-time snapshots. `webmentions-snapshot` (new bin) queries webmention.io
  once for a whole domain, incrementally via `since_id`, and writes a JSON file
  to commit. Pass it to `<Webmentions snapshot={...}>` and the component renders
  with no network request at all — a page view stops costing webmention.io a
  request, the section survives an outage, and the committed file is a durable
  copy of the mentions.
- `filterMentionsByTargets`, `getSnapshotMentions` and `mergeSnapshot` in core.
- `revalidate` on the React hook, to opt back into a live fetch on top of a
  snapshot. A failed revalidation never blanks a section the snapshot could fill.

### Fixed

- `useWebmentions` seeded its state in a `useState` initializer, which only runs
  once — on a client-side route change the targets changed but the mentions did
  not. Groups are now derived from the current targets.

## 0.1.1

### Added

- `innerClassName` on `<Webmentions>` — renders a wrapper element inside the
  `<aside>`, for hosts whose layout CSS keys off a width-constraining element
  (Docusaurus's `.container`). Without it, `hhkaos.github.io` would have lost its
  820px cap on migrating.
- React render tests, using `initialMentions` to seed state synchronously so the
  component's real markup can be asserted from a server render.

## 0.1.0

Initial release. Extracts the three near-duplicate webmention.io widgets
(`hhkaos.github.io`, `littlelink`, `posts.rauljimenez.info`) into one
dependency-free, buildless package.

### Added

- `fetchWebmentions` with retries and exponential backoff, automatic fallback
  from `/api/mentions.jf2` to `/api/mentions.json`, and a typed
  `WebmentionFetchError` so callers can tell "no mentions" from "could not load".
- `renderWebmentions` / `renderGroups` — imperative DOM rendering; leaves existing
  markup untouched when the API is unreachable.
- React entry point (`/react`) with `useWebmentions` and `<Webmentions>`, written
  with `createElement` so the package needs no build step.
- Per-property facepile groups with counts, bilingual `{en, es}` labels,
  mojibake stripping, and author name falling back to the source host.

### Fixed

- The trailing-slash target variant was only generated when the path already
  ended in a slash, so a page served at `/post` never queried
  `https://example.com/post/`. This was live in all three original copies and is
  the most common cause of a stored mention never being displayed.
- `wm-property` is `mention-of` in the jf2 feed but `mention` in some payloads;
  `normalizeProperty` now folds them together.
- Facepile deduping is per author **per property**, so one person's like and
  repost no longer collapse into one.
