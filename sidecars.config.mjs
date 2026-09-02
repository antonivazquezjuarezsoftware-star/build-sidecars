// sidecars.config.mjs
//
// The single declarative source of truth for the mirror: which third-party
// binaries the consuming projects bundle, for which platforms, and where they
// come from upstream.
//
// Scope is deliberately narrow. Only sources whose *availability* is at risk
// are mirrored: single-maintainer hosts (evermeet.cx, gyan.dev,
// johnvansickle.com, SourceForge) and floating `latest` pointers that make a
// build unreproducible. npm packages and nodejs.org distributions are not
// mirrored — they are versioned registries with their own integrity checks,
// and duplicating them would add ~1 GB for no availability gain.

export const REPO_SLUG =
  process.env.SIDECARS_REPO ?? 'antonivazquezjuarezsoftware-star/build-sidecars'

export const VENDOR_DIR = 'vendor'
export const MANIFEST_FILE = 'manifest.json'

/** Rust target triples, for consumers that name sidecars the way Tauri's `externalBin` does. */
export const TARGET_TRIPLES = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

const BTBN = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
const FFMPEG_STATIC =
  'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1'
const YT_DLP_LATEST = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
const EVERMEET = 'https://evermeet.cx/ffmpeg/getrelease'

// A source is either the executable itself (`binary`) or an archive holding it
// (`archive` + `member`, matched on basename so a leading directory in the
// archive does not have to be spelled out).
const archive = (url, member) => ({ kind: 'archive', url, member })
const binary = (url) => ({ kind: 'binary', url })

export const ARTIFACTS = [
  {
    id: 'ffmpeg',
    license: 'GPL-3.0-or-later',
    consumers: ['home-flix', 'media-downloader'],
    targets: {
      // evermeet publishes an x86_64-only build, and ffmpeg-static does have a
      // native arm64 one — but only at 6.1.1, and no provider has a native
      // arm64 *ffprobe* at all. Pairing the two would ship ffmpeg 6.1.1 next to
      // ffprobe 9.0.1, a skew upstream never produces and which the consumers'
      // playback-compatibility pipeline (one probe feeding one transcode) has
      // no reason to tolerate. The mirror reproduces upstream rather than
      // improving on it: a mirror that changes what gets installed is not a
      // mirror. `detectedArch` in the manifest records that this is the x86_64
      // build, so the Rosetta dependency is written down instead of implied.
      'darwin-arm64': {
        versionFrom: 'evermeet:ffmpeg',
        sources: [
          archive(`${EVERMEET}/ffmpeg/zip`, 'ffmpeg'),
          binary(`${FFMPEG_STATIC}/ffmpeg-darwin-x64`),
        ],
      },
      'darwin-x64': {
        versionFrom: 'evermeet:ffmpeg',
        sources: [
          archive(`${EVERMEET}/ffmpeg/zip`, 'ffmpeg'),
          binary(`${FFMPEG_STATIC}/ffmpeg-darwin-x64`),
        ],
      },
      'linux-x64': {
        versionFrom: 'btbn',
        sources: [
          archive(`${BTBN}/ffmpeg-master-latest-linux64-gpl.tar.xz`, 'ffmpeg'),
          archive(
            'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
            'ffmpeg',
          ),
        ],
      },
      'linux-arm64': {
        versionFrom: 'btbn',
        sources: [
          archive(`${BTBN}/ffmpeg-master-latest-linuxarm64-gpl.tar.xz`, 'ffmpeg'),
          archive(
            'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz',
            'ffmpeg',
          ),
        ],
      },
      'win32-x64': {
        versionFrom: 'btbn',
        sources: [
          archive(`${BTBN}/ffmpeg-master-latest-win64-gpl.zip`, 'ffmpeg.exe'),
          archive(
            'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
            'ffmpeg.exe',
          ),
        ],
      },
    },
  },
  {
    id: 'ffprobe',
    license: 'GPL-3.0-or-later',
    consumers: ['home-flix'],
    targets: {
      // No provider publishes a native arm64 macOS ffprobe, so this is the
      // x86_64 build (which runs under Rosetta 2). Recorded rather than hidden:
      // `verify` reports the arch mismatch on every run.
      'darwin-arm64': {
        versionFrom: 'evermeet:ffprobe',
        sources: [archive(`${EVERMEET}/ffprobe/zip`, 'ffprobe')],
      },
      'darwin-x64': {
        versionFrom: 'evermeet:ffprobe',
        sources: [archive(`${EVERMEET}/ffprobe/zip`, 'ffprobe')],
      },
      'linux-x64': {
        versionFrom: 'btbn',
        sources: [
          archive(`${BTBN}/ffmpeg-master-latest-linux64-gpl.tar.xz`, 'ffprobe'),
          archive(
            'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
            'ffprobe',
          ),
        ],
      },
      'linux-arm64': {
        versionFrom: 'btbn',
        sources: [
          archive(`${BTBN}/ffmpeg-master-latest-linuxarm64-gpl.tar.xz`, 'ffprobe'),
          archive(
            'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz',
            'ffprobe',
          ),
        ],
      },
      'win32-x64': {
        versionFrom: 'btbn',
        sources: [
          archive(`${BTBN}/ffmpeg-master-latest-win64-gpl.zip`, 'ffprobe.exe'),
          archive(
            'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
            'ffprobe.exe',
          ),
        ],
      },
    },
  },
  {
    id: 'yt-dlp',
    license: 'Unlicense',
    consumers: ['media-downloader'],
    targets: {
      'darwin-arm64': {
        versionFrom: 'github:yt-dlp/yt-dlp',
        sources: [binary(`${YT_DLP_LATEST}/yt-dlp_macos`)],
      },
      'darwin-x64': {
        versionFrom: 'github:yt-dlp/yt-dlp',
        sources: [binary(`${YT_DLP_LATEST}/yt-dlp_macos`)],
      },
      'linux-x64': {
        versionFrom: 'github:yt-dlp/yt-dlp',
        sources: [binary(`${YT_DLP_LATEST}/yt-dlp_linux`)],
      },
      'linux-arm64': {
        versionFrom: 'github:yt-dlp/yt-dlp',
        sources: [binary(`${YT_DLP_LATEST}/yt-dlp_linux_aarch64`)],
      },
      'win32-x64': {
        versionFrom: 'github:yt-dlp/yt-dlp',
        sources: [binary(`${YT_DLP_LATEST}/yt-dlp.exe`)],
      },
    },
  },
  {
    id: 'libmpv-2.dll',
    license: 'LGPL-2.1-or-later',
    consumers: ['home-flix'],
    // Optional: the upstream asset is a .7z, which needs a 7-Zip binary the
    // other artifacts do not. A missing extractor must not fail the whole
    // fetch, so this one is reported and skipped instead.
    optional: true,
    targets: {
      'win32-x64': {
        versionFrom: 'asset-name',
        sources: [{ kind: 'dynamic', resolver: 'shinchiro-libmpv', member: 'libmpv-2.dll' }],
      },
    },
  },
]

/** Every platform any artifact declares, in a stable order. */
export const ALL_PLATFORMS = Object.keys(TARGET_TRIPLES)

/** Flattens the table into one entry per (artifact, platform) pair. */
export function enumerateTargets({ platforms, ids } = {}) {
  const entries = []
  for (const artifact of ARTIFACTS) {
    if (ids?.length && !ids.includes(artifact.id)) continue
    for (const [platform, target] of Object.entries(artifact.targets)) {
      if (platforms?.length && !platforms.includes(platform)) continue
      entries.push({
        id: artifact.id,
        license: artifact.license,
        optional: artifact.optional === true,
        consumers: artifact.consumers,
        platform,
        triple: TARGET_TRIPLES[platform],
        ...target,
      })
    }
  }
  return entries
}
