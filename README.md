# build-sidecars

Pinned, checksummed mirror of the third-party binaries that `home-flix`,
`media-downloader` and the other desktop projects bundle.

## Why this exists

Two problems, and the second is the one that bites.

**Availability.** Several sidecars come from single-maintainer hosts —
`evermeet.cx`, `gyan.dev`, `johnvansickle.com`, SourceForge. If one goes away,
builds for that platform stop working.

**Reproducibility.** The URLs are mutable. `releases/download/latest` is a
pointer, not a version: two builds a month apart bundle different ffmpeg, and
nothing records which. And because the fetch scripts validate only magic bytes,
a truncated or substituted binary passes.

So the mirror is manifest-first. `manifest.json` is committed and records, per
artifact: the resolved upstream version, `sha256`, size, the executable format
and CPU architecture read from the file's own header, the source URL, and the
licence. The binaries themselves live in GitHub Releases, never in git.

## Prerequisites

- Node.js 20+
- `gh` (GitHub CLI), authenticated — only for `publish`
- `unzip` and `tar` — present on macOS, Linux and Windows 10+
- `7zz` / `7z` / `7za` — only to mirror `libmpv-2.dll`, which is optional

## Usage

```bash
npm run fetch                                        # everything, into vendor/
npm run fetch -- --platforms win32-x64 --only ffmpeg # a subset
npm run verify                                       # vendor/ against manifest.json
npm run publish                                      # upload to a GitHub Release
npm run emit                                         # regenerate THIRD-PARTY.md + consumer tables
```

`npm run emit` is part of publishing, not an afterthought: it rewrites
[`THIRD-PARTY.md`](THIRD-PARTY.md) (the source offer this repository owes for
the GPL binaries it now conveys publicly) and the generated
`scripts/sidecar-mirror.mjs` in each consumer. `npm run emit:check` fails when
either is stale.

Then, from a consuming project:

```bash
node scripts/restore.mjs --platform win32-x64 --dest ../home-flix/src-tauri/binaries
node scripts/restore.mjs --platform win32-x64 --only ffmpeg --naming triple \
  --dest ../media-downloader/src-tauri/binaries
```

`restore` refuses to install anything whose `sha256` does not match the
manifest. That check is the point: without it this is just another unverified
download.

### Naming

Assets are `<id>-<version>-<platform>[.exe]`. On restore, two conventions:

| `--naming` | Produces | For |
|---|---|---|
| `plain` (default) | `ffmpeg.exe` | a `bundle.resources` entry (`home-flix`) |
| `triple` | `ffmpeg-x86_64-pc-windows-msvc.exe` | Tauri `externalBin` (`media-downloader`) |

## What is mirrored

| Artifact | Platforms | Upstream | Licence |
|---|---|---|---|
| `ffmpeg` | darwin arm64/x64, linux x64/arm64, win32 x64 | BtbN, evermeet, johnvansickle, gyan, ffmpeg-static | GPL-3.0-or-later |
| `ffprobe` | same | BtbN, evermeet, johnvansickle, gyan | GPL-3.0-or-later |
| `yt-dlp` | same | yt-dlp releases | Unlicense |
| `libmpv-2.dll` | win32-x64 | shinchiro/mpv-winbuild-cmake, SourceForge | LGPL-2.1-or-later |

Deliberately **not** mirrored: npm packages (`@lydell/node-pty`,
`@anthropic-ai/claude-agent-sdk`, `sqlite3`, `onnxruntime-node`) and Node.js
distributions. Those are versioned registries with their own integrity
checking; mirroring them would add roughly a gigabyte for no availability gain.

## How consumers use it

Two mechanisms, for two different situations.

**`scripts/sidecar-mirror.mjs`** — generated into each consumer by
`npm run emit` and **committed there**. It is a plain table of
`{ url, sha256, version }`, so a consumer's existing fetcher tries this mirror
first and falls back to its upstream providers if anything about it fails. This
is the path that works inside a build container, which mounts only the one
project and cannot reach this repository at all.

**`scripts/restore.mjs`** — for pulling binaries into a checkout by hand, when
this repository *is* present.

Both verify `sha256` before installing anything. A mirror without that check is
just another unverified download, and the failure it catches — a truncated or
substituted binary — produces an installer that looks complete and does not
work.

Set `SIDECAR_MIRROR=0` in a consumer to skip the mirror entirely. That is how
you check whether the upstream providers still work before relying on them
again.

## Licensing

This repository is **public**, which means it *conveys* the binaries it
republishes. The ffmpeg/ffprobe builds are **GPL-3.0-or-later** and libmpv is
**LGPL-2.1-or-later**, so the corresponding-source offer lives in
[`THIRD-PARTY.md`](THIRD-PARTY.md), generated from `manifest.json` so it cannot
drift from what is actually published.

Nothing here is built from source: every asset is byte-for-byte what its
upstream provider published, which is why pointing at the upstream source is
sufficient. One rough edge worth knowing: BtbN assets are snapshots of ffmpeg
`master` (`master-YYYYMMDD`), so identifying the exact revision means going
through the upstream release recorded in each entry's `sourceUrl` rather than
reading a version tag.

## Known upstream quirks

Recorded rather than hidden — `fetch` and `verify` report them on every run,
and they land in `manifest.json` as `matchesPlatform: false`:

- **`ffprobe` for `darwin-arm64` is an x86_64 build.** No provider publishes a
  native arm64 macOS ffprobe; it runs under Rosetta 2.
- **`evermeet.cx` serves one architecture.** A consumer that asks it for both
  macOS slices gets the same file twice.
- **BtbN's `latest` tag is rebuilt in place**, so its version here is derived
  from the release's publish date (`master-YYYYMMDD`), not from a tag.
