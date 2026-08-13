# CLAUDE.md

## Purpose

A pinned, checksummed mirror of the third-party binaries the sibling desktop
and extension projects bundle at build time. It exists to remove two risks: a
single-maintainer upstream disappearing, and floating `latest` URLs making
builds unreproducible with no record of what was shipped.

It builds nothing and is not a dependency of any project at run time. It is a
staging area plus a lockfile.

## Tech stack

- Node.js 20+, ESM (`.mjs`), zero runtime dependencies — the scripts must run
  identically on macOS, Linux and inside a Linux build container
- `gh` (GitHub CLI) for publishing; GitHub Releases as the object store
- `unzip` / `tar` for extraction, `7zz` / `7z` / `7za` only for libmpv

## Commands

- `npm run fetch` — download every declared artifact into `vendor/`, write `manifest.json`
- `npm run verify` — check `vendor/` against `manifest.json`
- `npm run publish` — verify, then upload assets + manifest to a GitHub Release
- `node scripts/restore.mjs --platform <p> --dest <dir>` — consumer side

## Architecture

- `sidecars.config.mjs` — the declarative table: which artifacts, which
  platforms, which upstream URLs, which version resolver. The only file that
  changes when an artifact is added.
- `scripts/lib/http.mjs` — fetch with retries. Callers validate the payload
  afterwards; single-maintainer hosts have returned HTML with HTTP 200.
- `scripts/lib/archive.mjs` — extraction chosen by magic bytes, not by host.
- `scripts/lib/binfmt.mjs` — executable format and CPU architecture read from
  the Mach-O / ELF / PE header.
- `scripts/lib/versions.mjs` — resolves an upstream version per source
  (`evermeet:`, `github:`, `btbn`, `asset-name`), falling back to a
  content-derived `d<date>-<sha8>`.
- `scripts/lib/resolvers.mjs` — sources whose URL is not knowable ahead of
  time (libmpv's dated, git-hashed asset).
- `scripts/lib/manifest.mjs` — the lockfile: read, write, hash.

## Key conventions

- **`manifest.json` is committed; `vendor/` is not.** Binaries in git would
  grow the clone forever, since updating one adds rather than replaces.
- **A release asset name carries its version** (`ffmpeg-7.1-win32-x64.exe`).
  Where upstream publishes no version string, it is content-derived, so an
  asset name always identifies exactly one file.
- **Architecture is read from the binary's own header and recorded**, then
  compared against the platform key it was filed under. A mismatch is a warning
  in `fetch`/`verify` and `matchesPlatform: false` in the manifest — never a
  silent pass. This is what catches a provider quietly serving the wrong build;
  a mirror that stores the wrong architecture is worse than no mirror, because
  the mistake becomes reproducible.
- **An architecture mismatch does not fail the run; a checksum mismatch does.**
  The first is upstream's doing and is documented in the README's "Known
  upstream quirks"; the second means the bytes are not what the manifest
  describes.
- **`restore` verifies `sha256` before writing.** A mirror without verification
  is just another unverified download.
- **`publish` uploads by manifest, never by globbing `vendor/`.** `vendor/`
  accumulates across fetches, so a glob would ship a previous snapshot's files.
- **`publish` runs `verify` first.** Uploading a file that does not match the
  manifest would break every consumer's integrity check.
- **An optional artifact's failure is reported and skipped**, not fatal —
  `libmpv-2.dll` needs a 7-Zip binary the others do not, and a missing
  extractor must not block mirroring everything else.
- **npm packages and Node.js distributions are out of scope.** Versioned
  registries with their own integrity checking; mirroring them would add ~1 GB
  for no availability gain.
- **The ffmpeg builds are GPL**, so this repository stays private unless the
  corresponding sources are linked from it.
