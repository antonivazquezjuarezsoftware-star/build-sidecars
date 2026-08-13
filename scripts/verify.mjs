#!/usr/bin/env node
// scripts/verify.mjs
//
// Checks vendor/ against the committed manifest.json. Run it after a fetch and
// before a publish: uploading a file whose hash does not match the manifest
// would make every consumer's integrity check fail, and the manifest is the
// only thing consumers trust.
//
//   node scripts/verify.mjs
//   node scripts/verify.mjs --dir path/to/downloads

import { existsSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

import { VENDOR_DIR } from '../sidecars.config.mjs'
import { checkAgainstPlatform, inspectExecutable } from './lib/binfmt.mjs'
import { readManifest, sha256 } from './lib/manifest.mjs'
import { logger, parseArgs } from './lib/log.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const log = logger('verify')

function main() {
  const flags = parseArgs(process.argv.slice(2))
  const dir = flags.dir && flags.dir !== true ? resolve(String(flags.dir)) : join(ROOT, VENDOR_DIR)
  const manifest = readManifest(join(ROOT, 'manifest.json'))

  log.info(`${manifest.artifacts.length} entries, tag ${manifest.tag}, against ${dir}`)

  const problems = []
  const notes = []

  for (const entry of manifest.artifacts) {
    const path = join(dir, entry.asset)
    if (!existsSync(path)) {
      problems.push(`${entry.asset}: missing`)
      continue
    }

    const size = statSync(path).size
    if (size !== entry.size) {
      problems.push(`${entry.asset}: ${size} bytes, manifest says ${entry.size}`)
      continue
    }

    const bytes = readFileSync(path)
    const digest = sha256(bytes)
    if (digest !== entry.sha256) {
      problems.push(`${entry.asset}: sha256 ${digest.slice(0, 12)} != ${entry.sha256.slice(0, 12)}`)
      continue
    }

    const check = checkAgainstPlatform(inspectExecutable(bytes), entry.platform)
    if (!check.ok) notes.push(`${entry.asset}: ${check.reason}`)

    log.ok(`${entry.asset}  ${entry.version}`)
  }

  // An architecture mismatch is upstream's doing, not corruption: it is
  // reported every run so it stays visible, but it does not fail the check.
  for (const note of notes) log.warn(note)
  for (const problem of problems) log.fail(problem)

  if (problems.length > 0) {
    log.fail(`${problems.length} problem(s)`)
    process.exit(1)
  }
  log.ok(`all ${manifest.artifacts.length} artifacts verified`)
}

main()
