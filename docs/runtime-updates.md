# Runtime updates for sidecars

**Status:** proposal — nothing here is implemented yet.

This document describes how an *installed* consumer app (`media-downloader`
first) could replace a bundled sidecar with a newer one without shipping a new
installer, and how this repository would act as the source of those updates.

## The problem: the mirror only acts at build time

Today a sidecar reaches a user through one path:

```
build-sidecars release  →  consumer's scripts/sidecar-mirror.mjs (generated, committed)
                        →  npm run tools:fetch (build time)
                        →  installer  →  user's machine, frozen
```

The binary is frozen inside the installer. For ffmpeg that is fine. For
**yt-dlp** it is not: sites rotate their player clients every few weeks, and an
old yt-dlp parses the page correctly but gets `403 Forbidden` on every format.
`media-downloader` surfaces this as its `forbidden` error code. Today the only
remedy is: republish this repository → regenerate `sidecar-mirror.mjs` → cut an
app release → the user reinstalls. Users see `forbidden` for that whole time.

Two numbers show how often this happens:

| | Cadence |
|---|---|
| yt-dlp upstream stable releases | roughly weekly, sometimes several a month |
| This mirror, today | only when someone runs `npm run publish` by hand (no CI) |

On 2026-09-30, `manifest.json` pinned `yt-dlp 2026.07.04` (88 days old) under tag
`vendor-2026-08-13`. That is past the 30-day ceiling in `media-downloader`'s
`fetch-tools.mjs`, so its builds currently skip the mirror for yt-dlp and bundle
upstream `latest`, with no pinned version.

## Scope

**Only yt-dlp is updated at run time.** The other artifacts are not:

- **ffmpeg / ffprobe** do not go stale against websites. They only remux, and a
  version change is a behaviour change that should go through a tested release.
  They are also 80–150 MB each.
- **libmpv** is linked into `home-flix`'s player. Swapping it under a running
  app means ABI risk with no matching benefit.

Eligibility is declared per artifact (`runtimeUpdate: true` in
`sidecars.config.mjs`), so this is a config decision, not a hard-coded list.

> This is a deliberate change of scope. `CLAUDE.md` currently says this
> repository "is not a dependency of any project at run time". When this is
> implemented, update that sentence: build-time mirroring stays as it is, and
> the runtime channel becomes a second, opt-in role.

## Design overview

Three pieces:

1. **A runtime channel**: one small signed JSON document at a URL that never
   changes, saying "for artifact X on platform Y, the current version is V, at
   URL U, with sha256 H".
2. **Automated publishing**: a scheduled GitHub Actions workflow in this
   repository that mirrors each new yt-dlp release and updates the channel.
   Without it, the problem just moves: apps would "update" to an equally stale
   version.
3. **A consumer-side updater**: inside each app. It reads the channel, verifies
   it, downloads to the app-data directory, and activates the new binary. If
   anything fails, the app falls back to the bundled binary.

```
upstream yt-dlp ──(daily CI check)──▶ build-sidecars
                                       ├─ release  yt-dlp-<version>   (binaries)
                                       └─ release  runtime-channel    (channel.json + channel.json.sig)
                                                         ▲
installed app ──(≤ 1×/day, or after `forbidden`)─────────┘
   └─ verify signature → verify sha256 → smoke test → activate in app-data dir
```

## 1. The channel

### Where it lives (source options)

**Recommendation: GitHub Releases, on a fixed tag dedicated to the channel.**

```
https://github.com/<REPO_SLUG>/releases/download/runtime-channel/channel.json
https://github.com/<REPO_SLUG>/releases/download/runtime-channel/channel.json.sig
```

`runtime-channel` is one release whose two assets get overwritten
(`gh release upload --clobber`) on every publish. Its URL is the only one baked
into the apps, and it never changes. The binaries themselves stay in their own
immutable, versioned releases, same as today.

Why this source and not the others:

| Source | Verdict |
|---|---|
| **Fixed-tag GitHub Release** (recommended) | Already the store for this repository. Free. Public, which it has to be anyway (see `THIRD-PARTY.md`). Download URLs are **not** subject to the REST API's 60 req/h unauthenticated limit. Rollback is just re-uploading an older channel. |
| `releases/latest/download/channel.json` | Works, but couples the channel to GitHub's "latest release" heuristic. A partial or ffmpeg-only publish would move what apps see. Rejected. |
| `api.github.com/repos/.../releases/latest` | Rate-limited to 60 req/h per IP without a token. Shared NATs (offices, CGNAT) would hit it. Rejected. |
| `raw.githubusercontent.com` (channel committed to git) | Works, but adds a bot commit for every yt-dlp release, and raw content is cached ~5 min with no guarantees. No advantage over releases. |
| Own domain (Cloudflare R2/Pages, S3 + CDN) | **Worth it if a domain is available.** The channel URL baked into an installed app is permanent. A domain you control (`sidecars.<domain>/channel.json`, even if it only redirects to GitHub) lets hosting move later without shipping a new app. |
| yt-dlp upstream directly (`releases/latest` + `SHA2-256SUMS`) | What `yoinks` does. No control over which version users get, and no way to hold back or roll back a bad release. Acceptable only as an opt-in "bleeding edge" setting. |
| `yt-dlp -U` (self-update) | Rejected. It writes next to itself, which is not writable for an MSI install in `Program Files`. It bypasses our hash and signature checks. On macOS it produces a binary that needs ad-hoc re-signing (the dyld hang documented in `media-downloader`). |

Apps should accept a **list** of channel URLs, tried in order: for example the
own domain first and the GitHub URL as fallback. Then a hosting move is a config
change on the server side, not a client release.

### Format

`channel.json` is generated from `manifest.json`, the same way `emit-mirror.mjs`
generates the consumer tables. It is never written by hand.

```json
{
  "schemaVersion": 1,
  "sequence": 17,
  "publishedAt": "2026-10-04T06:12:00.000Z",
  "artifacts": {
    "yt-dlp": {
      "version": "2026.10.02",
      "license": "Unlicense",
      "minAppVersion": { "media-downloader": "0.0.0" },
      "platforms": {
        "win32-x64": {
          "url": "https://github.com/<REPO_SLUG>/releases/download/yt-dlp-2026.10.02/yt-dlp-2026.10.02-win32-x64.exe",
          "sha256": "…",
          "size": 18226085
        },
        "darwin-arm64": { "url": "…", "sha256": "…", "size": 38256544 },
        "darwin-x64":   { "url": "…", "sha256": "…", "size": 38256544 },
        "linux-x64":    { "url": "…", "sha256": "…", "size": 39924536 },
        "linux-arm64":  { "url": "…", "sha256": "…", "size": 39675904 }
      }
    }
  }
}
```

- **`sequence`**: a monotonically increasing integer. Apps reject a channel
  whose `sequence` is lower than the last one they accepted. This blocks
  *replay*: re-serving an old, validly signed channel to pin users on a
  vulnerable version. A rollback is a **new** channel (higher `sequence`) that
  points at the older version, never a re-upload of an old document.
- **`minAppVersion`** (optional, per consumer): lets a channel hold back an
  artifact from app versions that cannot handle it, for example if a future
  yt-dlp needs a flag only newer app builds pass. Apps below it ignore the entry
  and keep their bundled binary.
- Only artifacts with `runtimeUpdate: true` appear in the channel.

### Signing

`sha256` in the channel protects against a truncated or corrupted download. It
does **not** protect against whoever can modify the channel, because the hash
sits in the same document. The app is going to *execute* what it downloads, so
the channel must be signed, and the public key must be compiled into the app.

- **Algorithm: Ed25519.** Node signs it with the built-in `crypto.sign(null, …)`,
  so the zero-dependency rule holds. Rust verifies it with `ed25519-dalek`
  (`verify_strict`).
- **What is signed: the exact bytes of `channel.json`.** The app verifies the
  bytes it downloaded and only then parses them. It never re-serializes before
  verifying.
- **`channel.json.sig`** holds the base64 of the 64-byte signature.
- **Private key**: a GitHub Actions secret (`CHANNEL_SIGNING_KEY`, PKCS#8 PEM),
  plus an offline backup. It never lives in the repository.
- **Public key**: compiled into each consumer (for example `config.rs` in
  `media-downloader`) as a **list**, so a key can be rotated: ship a release
  that trusts old + new, switch signing to the new key, and later drop the old
  one.
- A new `scripts/keygen.mjs` generates the pair and prints the public key in the
  form consumers paste into their config.

Alternative considered: minisign, the format the Tauri updater uses. It is a
good fit if the apps adopt the Tauri updater as well, because then one tool
could cover both. It needs either a dependency or a hand-written implementation
of minisign's prehashed format in Node. Raw Ed25519 is simpler and enough.

## 2. Publishing automation in this repository

A new workflow, `.github/workflows/refresh-yt-dlp.yml`:

- **Trigger**: `schedule` daily (for example `0 6 * * *`), plus
  `workflow_dispatch` for an urgent manual run.
- **Steps**:
  1. Resolve upstream's current stable version: one request to
     `yt-dlp/yt-dlp/releases/latest`, following the redirect to the tag. If it
     equals the channel's current version, **stop**. Most days end here, at the
     cost of one request.
  2. `node scripts/fetch.mjs --only yt-dlp --tag yt-dlp-<version>`
  3. Check every downloaded file against upstream's `SHA2-256SUMS` from the same
     release. This catches a corrupted or substituted download before it is
     mirrored. Optionally also verify `SHA2-256SUMS.sig` with yt-dlp's GPG key.
  4. Smoke test: run `yt-dlp --version` for the runner's own platform and check
     it prints `<version>`. Network tests against real sites are deliberately
     left out: CI IPs get bot-walled, and the results would be noise.
  5. `npm run publish -- --only yt-dlp --tag yt-dlp-<version>`
  6. `node scripts/emit-channel.mjs --sign`, then upload `channel.json` and
     `channel.json.sig` to `runtime-channel` with `--clobber`.
  7. Commit `manifest.json` back to `main` as a bot commit, so the lockfile
     records what was published.
- **No soak period by default.** A new yt-dlp usually *is* the fix for a
  `forbidden` wave, so delaying it costs more than an occasional regression.
  Regressions are handled by rollback, i.e. a new `sequence` pointing at the
  previous version.

This is the same automation the build-time path needs. Once it runs, the
consumers' 30-day staleness guard should stop firing, and the mirror becomes the
primary source again.

### Changes this needs in existing scripts

| File | Change | Why |
|---|---|---|
| `sidecars.config.mjs` | `runtimeUpdate: true` on `yt-dlp` | Decides what goes into the channel |
| `manifest.json` / `scripts/lib/manifest.mjs` | Per-entry `releaseTag` (defaults to the top-level `tag` for existing entries) | A yt-dlp-only release lives under a different tag than the last full snapshot. Today the single top-level `tag` assumes every asset is in one release. |
| `scripts/publish.mjs` | `--only <ids>`: upload only the matching entries, and skip verifying the others in `vendor/` | A CI runner has no ffmpeg files in `vendor/`. Uploading every manifest entry would fail `verify`, or re-upload ~700 MB of unchanged binaries. |
| `scripts/emit-mirror.mjs` | Build each URL from `entry.releaseTag` | Same reason as `releaseTag` |
| `scripts/emit-channel.mjs` (new) | Generate `channel.json` from the manifest, bump `sequence`, sign with `--sign` | The channel is generated, never hand-written. Same rule as the consumer tables. |
| `scripts/keygen.mjs` (new) | Generate the Ed25519 pair | |
| `.github/workflows/refresh-yt-dlp.yml` (new) | The workflow above | |

Regenerating each consumer's `sidecar-mirror.mjs` stays manual (`npm run emit`).
CI only checks out this repository, not the sibling projects. With runtime
updates in place, a slightly old build-time pin matters much less: it is only
what a fresh install starts with.

## 3. The consumer-side updater (contract for apps)

Generic contract first, then what it means for `media-downloader`.

### When to check

- At startup, **at most once per 24 h** (`lastCheckedAt` in the state file), in
  the background. Startup never waits on it.
- **On demand, after a `forbidden` failure**: at most once per hour, so a burst
  of failed downloads does not mean a burst of checks.
- **Manually**, from a "Check for updates" button next to the tool version.
- Never when the user has disabled automatic updates. Default: enabled.

Offline, a DNS failure or a 5xx are logged and ignored. The next trigger tries
again.

### Steps

1. **Fetch** `channel.json` and `channel.json.sig` (first URL that answers, from
   the configured list). Use a short timeout and a size cap (e.g. 64 KB) on the
   channel.
2. **Verify** the signature over the raw bytes against any trusted public key.
   On failure: reject, log, stop.
3. **Parse** the channel. Reject if `schemaVersion` is unknown or `sequence` is
   lower than the stored `lastSequence`.
4. **Select** the entry for this artifact and platform. Skip it if
   `minAppVersion` excludes this app.
5. **Compare versions**: channel version vs the currently active one (bundled or
   previously downloaded). yt-dlp versions are dotted dates (`2026.10.02`,
   sometimes with a trailing `.N`). Compare them numerically, segment by
   segment. Proceed only if the channel is **newer**. Never downgrade below the
   bundled version.
6. **Download** to `<app-data>/sidecars/yt-dlp/<version>/yt-dlp[.exe].part`,
   streaming, with the size cap equal to `size`.
7. **Check** `size` and `sha256`. On mismatch: delete the file and stop.
8. **Prepare the binary**:
   - Unix: `chmod 0755`.
   - macOS: ad-hoc re-sign with `codesign --force --sign -`. This is the same
     fix `media-downloader`'s `fetch-tools.mjs` applies at build time for the
     dyld/AMFI hang, and `/usr/bin/codesign` ships with the OS.
9. **Smoke test**: run `<binary> --version` with a timeout. The output must equal
   the channel version.
10. **Activate**: rename `.part` → final name, then atomically rewrite
    `state.json` (temp + rename):
    ```json
    { "active": "2026.10.02", "previous": "2026.09.20", "lastSequence": 17, "lastCheckedAt": "…" }
    ```
11. **Garbage-collect**: keep `active` and `previous`, and delete older version
    directories. Do not delete a directory a running process may still be
    executing from. Doing GC at startup, before any download starts, is the
    simple way to get that.

Every failure in steps 1–10 leaves the app exactly as it was. **The bundled
binary is always the floor.**

### Resolution order

When the app looks for yt-dlp:

1. The **activated runtime copy**, if `state.json` names a version newer than
   the bundled one, the file exists, and it has not been marked broken.
2. The **bundled sidecar**, as today.
3. `PATH`, as today.

If the runtime copy fails to start (`--version` times out or errors), mark it
broken in `state.json` and fall back to the bundled one. A bad update must
never leave the app worse off than a fresh install.

A fresh install whose bundled yt-dlp is newer than the runtime copy uses the
bundled one, and the stale directory gets GC'd.

### Concurrency

The new binary goes into a **new directory**. The running binary is never
overwritten: Windows cannot replace an executable that is running, and a
download in progress must finish on the binary it started with. New processes
pick up `state.json`; running ones are left alone.

### Platform notes

- **Never write to the install directory.** It is not writable for MSI installs
  in `Program Files`, and on macOS writing into the `.app` invalidates the
  bundle's signature. Use the OS app-data directory.
- **Windows**: a file written by the app through an HTTP client does not get the
  Mark-of-the-Web, so SmartScreen does not prompt. Antivirus software may still
  scan the first execution; the smoke test absorbs that delay.
- **macOS**: `reqwest` does not set `com.apple.quarantine`, so Gatekeeper does
  not block the binary. The ad-hoc re-sign in step 8 is still required.
- **Linux**: no special handling beyond `chmod`.

### Mapping to `media-downloader`

This follows its own layered architecture (see its `CLAUDE.md`):

| Layer | Piece |
|---|---|
| Gateway | `SidecarUpdater` trait: `check_and_update(tool) -> UpdateOutcome` |
| Adapter | `adapters/sidecars/channel_updater.rs`: the steps above over the shared `reqwest` client. It spawns through `hidden_command()` for the smoke test. |
| Adapter change | `BinaryLocator` (`adapters/ytdlp/binary.rs`) gains the runtime copy as the first candidate |
| Business | `SettingsActions` / `DownloadsActions` trigger a check: at startup, after a `forbidden`, or manually |
| Config | `config.rs`: `SIDECAR_CHANNEL_URLS`, `SIDECAR_CHANNEL_PUBLIC_KEYS`, `SIDECAR_CHECK_INTERVAL`, `SIDECAR_FORBIDDEN_RECHECK_INTERVAL` |
| Domain | `ToolingReport` gains where the active yt-dlp came from (`bundled` / `updated` / `path`), mirrored in `src/domain/tooling.ts` |
| UI | `ToolingBanner` shows the version and its source, plus a "Check for updates" button. `AppSettings` gets an "update yt-dlp automatically" toggle. |
| Errors | `forbidden` copy in `errors.ts` can say "updating yt-dlp…" while the triggered check runs |

## Threat model, briefly

| Threat | Mitigation |
|---|---|
| Corrupted or truncated download | `size` + `sha256` from the signed channel |
| Upstream serves a substituted binary | CI checks against upstream `SHA2-256SUMS` before mirroring |
| Someone with write access to the channel location (compromised GitHub token, hosting move) | Ed25519 signature with a key that is not stored with the channel |
| Replay of an old channel | `sequence` must not decrease |
| Signing key leak | Key list in the app plus rotation. Revoking needs an app release, which is the accepted cost. |
| Update bricks yt-dlp | Smoke test before activation, "broken" marking, fallback to bundled |
| Privacy | The check is one anonymous GET of a static file. It sends no identifiers and no URLs the user is downloading. |

## Relation to a full app auto-update

The Tauri updater (a full app update) is complementary, not an alternative. It
ships a whole new installer, which is the right tool for app changes, and far
too heavy to push for every yt-dlp release. If both exist, they can share
infrastructure: a static signed JSON on GitHub Releases is exactly what the
Tauri updater consumes as well.

## Rollout

1. **This repository**: `releaseTag` per entry, `publish --only`,
   `emit-channel.mjs`, `keygen.mjs`, the workflow. Run it once manually and
   confirm `runtime-channel` serves a valid, signed channel.
2. **media-downloader**: updater behind the settings toggle, defaulting to
   **off** for one release while it is verified on all three OSes, then
   defaulting to on.
3. **Docs**: update this repository's `README.md`/`CLAUDE.md`, and the consumer's
   `CLAUDE.md`, which today says there is no auto-update of sidecars for an
   installed app.

## Open decisions

- **Own domain or GitHub only** for the channel URL. Decide before the first
  app release that embeds it, because the URL is permanent.
- **Upstream GPG verification** in CI: worth it, but it adds a key to manage.
- **Check frequency**: daily is proposed; anything from 6 h to weekly is
  defensible.
- **Nightly channel**: yt-dlp also publishes nightlies, which often fix a site
  days before stable. This could be a second channel (`channel-nightly.json`)
  behind an advanced setting. It is not proposed for the first version.
