# Changelog

All notable changes are documented here. Versions follow [semver](https://semver.org/).

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
