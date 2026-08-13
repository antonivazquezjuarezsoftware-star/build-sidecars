// scripts/lib/versions.mjs — resolves an upstream identifier for each artifact.
//
// This is the point of the whole mirror. `releases/download/latest` is a
// pointer, not a version: two builds a month apart bundle different ffmpeg and
// nothing records which. Every source here either names its version or gets a
// content-derived one, so a manifest entry always identifies exactly one file.

import { getJson, githubHeaders } from './http.mjs'

const EVERMEET_INFO = 'https://evermeet.cx/ffmpeg/info'
const CONTENT_VERSION_HASH_CHARS = 8

/** `d20260813-1a2b3c4d` — used when upstream publishes no version string at all. */
export function contentVersion(sha256, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10).replaceAll('-', '')
  return `d${stamp}-${sha256.slice(0, CONTENT_VERSION_HASH_CHARS)}`
}

/**
 * Resolves the version for a `versionFrom` key, before the download happens
 * where possible. Returns `null` when it can only be derived from content, in
 * which case the caller falls back to `contentVersion`.
 *
 * A resolver failing is never fatal: an unreachable metadata endpoint should
 * degrade the version label, not block mirroring the binary itself.
 */
export async function resolveVersion(versionFrom, context = {}) {
  try {
    if (!versionFrom || versionFrom === 'content') return null

    // A source that ships a fixed, tagged build states its version outright;
    // deriving one from content would hide that it is pinned.
    if (versionFrom.startsWith('literal:')) return versionFrom.slice('literal:'.length)

    if (versionFrom.startsWith('evermeet:')) {
      const tool = versionFrom.slice('evermeet:'.length)
      const info = await getJson(`${EVERMEET_INFO}/${tool}/release`)
      return info?.version ?? null
    }

    if (versionFrom.startsWith('github:')) {
      const slug = versionFrom.slice('github:'.length)
      const release = await getJson(
        `https://api.github.com/repos/${slug}/releases/latest`,
        githubHeaders(),
      )
      return release?.tag_name ?? null
    }

    if (versionFrom === 'btbn') {
      // BtbN's `latest` tag is rebuilt in place, so the release's own
      // publish date is the only thing that distinguishes two snapshots.
      const release = await getJson(
        'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest',
        githubHeaders(),
      )
      const published = release?.published_at
      return published ? `master-${published.slice(0, 10).replaceAll('-', '')}` : null
    }

    if (versionFrom === 'asset-name') {
      return context.assetVersion ?? null
    }

    return null
  } catch {
    return null
  }
}

/** Anything unsafe for a filename or a release asset name becomes a dash. */
export function slugifyVersion(version) {
  return String(version).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}
