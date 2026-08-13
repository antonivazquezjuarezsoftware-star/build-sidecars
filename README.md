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
```

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

## Licensing

The ffmpeg builds are **GPL**. Redistributing them publicly carries an
obligation to offer corresponding sources, which is why this repository is
expected to stay **private**. If it is ever made public, link the upstream
source releases from here first.

## Known upstream quirks

Recorded rather than hidden — `fetch` and `verify` report them on every run,
and they land in `manifest.json` as `matchesPlatform: false`:

- **`ffprobe` for `darwin-arm64` is an x86_64 build.** No provider publishes a
  native arm64 macOS ffprobe; it runs under Rosetta 2.
- **`evermeet.cx` serves one architecture.** A consumer that asks it for both
  macOS slices gets the same file twice.
- **BtbN's `latest` tag is rebuilt in place**, so its version here is derived
  from the release's publish date (`master-YYYYMMDD`), not from a tag.
