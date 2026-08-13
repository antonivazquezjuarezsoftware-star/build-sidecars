#!/usr/bin/env node
// scripts/publish.mjs
//
// Uploads vendor/ plus manifest.json to a GitHub Release, which is the store:
// assets stay out of the git history (so updating a binary does not grow the
// clone forever) while each one keeps a direct, stable URL under its tag.
//
//   node scripts/publish.mjs
//   node scripts/publish.mjs --tag vendor-2026-08-13 --clobber
//
// Requires the `gh` CLI, authenticated. Verification runs first: publishing a
// file that does not match the manifest would break every consumer.

import { execFileSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

import { REPO_SLUG, VENDOR_DIR } from '../sidecars.config.mjs'
import { readManifest } from './lib/manifest.mjs'
import { logger, parseArgs } from './lib/log.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const log = logger('publish')

function gh(args, options = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...options })
}

function releaseExists(tag) {
  try {
    gh(['release', 'view', tag, '--repo', REPO_SLUG], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function notesFor(manifest) {
  const rows = manifest.artifacts.map(
    (entry) =>
      `| \`${entry.id}\` | ${entry.platform} | ${entry.version} | ${entry.sha256.slice(0, 16)} | ${entry.license} |`,
  )
  const mismatched = manifest.artifacts.filter((entry) => !entry.matchesPlatform)
  const warning = mismatched.length
    ? `\n> **Note** — ${mismatched.length} artifact(s) do not match the platform they are filed under:\n${mismatched
        .map((entry) => `> - \`${entry.asset}\`: ${entry.archNote}`)
        .join('\n')}\n`
    : ''
  return [
    `Mirror snapshot generated ${manifest.generatedAt}.`,
    '',
    'Verify any download against `manifest.json` before use — see `scripts/restore.mjs`.',
    warning,
    '| Artifact | Platform | Version | sha256 | License |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

function main() {
  const flags = parseArgs(process.argv.slice(2))
  const manifest = readManifest(join(ROOT, 'manifest.json'))
  const tag = flags.tag && flags.tag !== true ? String(flags.tag) : manifest.tag
  const vendorDir = join(ROOT, VENDOR_DIR)

  if (!existsSync(vendorDir)) throw new Error(`${vendorDir} does not exist — run fetch first`)

  execFileSync(process.execPath, [join(ROOT, 'scripts', 'verify.mjs')], { stdio: 'inherit' })

  const assets = manifest.artifacts.map((entry) => join(vendorDir, entry.asset))
  const stray = readdirSync(vendorDir).filter(
    (name) => !manifest.artifacts.some((entry) => entry.asset === name),
  )
  // vendor/ accumulates across fetches, so an old snapshot's files are still
  // sitting there. Uploading by manifest rather than by glob is what keeps a
  // previous version out of this release.
  if (stray.length > 0) log.info(`ignoring ${stray.length} file(s) in vendor/ not in the manifest`)

  const uploads = [...assets, join(ROOT, 'manifest.json')]

  if (releaseExists(tag)) {
    log.info(`release ${tag} exists — uploading assets`)
    gh([
      'release',
      'upload',
      tag,
      ...uploads,
      '--repo',
      REPO_SLUG,
      ...(flags.clobber ? ['--clobber'] : []),
    ], { stdio: 'inherit' })
  } else {
    log.info(`creating release ${tag}`)
    gh([
      'release',
      'create',
      tag,
      ...uploads,
      '--repo',
      REPO_SLUG,
      '--title',
      `Sidecar mirror ${tag}`,
      '--notes',
      notesFor(manifest),
    ], { stdio: 'inherit' })
  }

  log.ok(`published ${uploads.length} file(s) to ${REPO_SLUG} @ ${tag}`)
}

try {
  main()
} catch (error) {
  log.fail(error.message)
  process.exit(1)
}
