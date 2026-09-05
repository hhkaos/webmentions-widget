# Releasing

## Cutting a release

```sh
npm test
npm version patch      # or minor / major
git push --follow-tags
```

Pushing the tag triggers `.github/workflows/release.yml`, which verifies the tag
matches `package.json`, runs the tests, publishes to npm, and opens a GitHub
release with generated notes. Nothing is published from a laptop.

Add the change to `CHANGELOG.md` before tagging.

## One-time npm setup

Publishing uses **npm Trusted Publishing** (OIDC): GitHub Actions authenticates
to npm with a short-lived token minted per run. There is no `NPM_TOKEN` secret in
this repo, nothing to rotate, and npm attaches a signed provenance attestation
linking each published tarball to the exact workflow run that built it.

A trusted publisher can only be attached to a package that already exists, so the
very first version has to go out by hand:

1. `npm login` (as the `hhkaos` account, which owns the `@hhkaos` scope).
2. `npm publish --access public` from a clean checkout of the tag.
3. On npmjs.com → the package → **Settings** → **Trusted Publisher**, add:
   - Provider: GitHub Actions
   - Organization / user: `hhkaos`
   - Repository: `webmentions-widget`
   - Workflow filename: `release.yml`
   - Environment: `npm`
4. Optional but recommended: set the package's publishing access to
   **"Require two-factor authentication or a trusted publisher"**, which stops
   any long-lived token from publishing it afterwards.

From then on every release goes through the workflow.

The `npm` environment referenced by the workflow also gives you a place to add a
required reviewer if you ever want a human gate before a publish.

## Propagating to the sites

- **`hhkaos.github.io`** and any other npm consumer: Dependabot opens a bump PR
  automatically once the new version is on the registry.
- **`littlelink`**: it loads the module from a pinned CDN URL rather than
  `package.json`, so its own `bump-webmentions-widget.yml` workflow checks the
  registry daily and opens a PR rewriting the pinned version.

Both are PRs, not silent updates — the sites still deploy on merge.
