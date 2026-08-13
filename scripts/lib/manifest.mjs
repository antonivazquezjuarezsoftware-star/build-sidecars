// scripts/lib/manifest.mjs — the lockfile.
//
// manifest.json is committed; vendor/ is not. The manifest is what makes the
// mirror worth having: it is the only record of which upstream build a given
// release shipped, and the only way a consumer can tell a good download from a
// truncated or substituted one.

import { createHash } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { MANIFEST_FILE } from '../../sidecars.config.mjs'

export const SCHEMA_VERSION = 1

export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

export function readManifest(path = MANIFEST_FILE) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `${path}: schemaVersion ${parsed.schemaVersion}, this tool understands ${SCHEMA_VERSION}`,
    )
  }
  return parsed
}

export function writeManifest(manifest, path = MANIFEST_FILE) {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** Sorted so a re-fetch that changes nothing produces no diff. */
export function buildManifest(entries, { tag }) {
  const artifacts = [...entries].sort(
    (left, right) =>
      left.id.localeCompare(right.id) || left.platform.localeCompare(right.platform),
  )
  return { schemaVersion: SCHEMA_VERSION, tag, generatedAt: new Date().toISOString(), artifacts }
}

/**
 * Folds freshly fetched entries into the previous manifest, replacing matches
 * by (id, platform) and keeping the rest.
 *
 * A filtered fetch — one platform, one artifact — must not erase the entries it
 * did not touch: the manifest is the only record of what a published release
 * contains, and rewriting it from a partial run would orphan every asset the
 * run skipped.
 */
export function mergeEntries(previous, fresh) {
  const merged = new Map()
  for (const entry of previous) merged.set(`${entry.id}\u0000${entry.platform}`, entry)
  for (const entry of fresh) merged.set(`${entry.id}\u0000${entry.platform}`, entry)
  return [...merged.values()]
}

export function findEntry(manifest, id, platform) {
  return manifest.artifacts.find((entry) => entry.id === id && entry.platform === platform)
}
