#!/usr/bin/env node
// scripts/restore.mjs
//
// The consumer side: pulls mirrored binaries out of a release and drops them
// where a project expects them, refusing anything whose sha256 does not match
// the manifest.
//
//   node scripts/restore.mjs --platform win32-x64 --dest ../home-flix/src-tauri/binaries
//   node scripts/restore.mjs --platform win32-x64 --only ffmpeg \
//     --dest ../media-downloader/src-tauri/binaries --naming triple
//
// Two naming conventions, because the two consumers differ:
//   plain  (default) — `ffmpeg.exe`, what a `bundle.resources` entry expects
//   triple           — `ffmpeg-x86_64-pc-windows-msvc.exe`, what Tauri's
//                      `externalBin` resolves
//
// The verification is the point. A mirror without it is just another
// unverified download, and the failure it protects against — a truncated or
// substituted binary — produces an installer that looks complete and does not
// work.

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

import { REPO_SLUG } from '../sidecars.config.mjs'
import { downloadBuffer, githubHeaders } from './lib/http.mjs'
import { readManifest, sha256 } from './lib/manifest.mjs'
import { logger, parseArgs, parseList } from './lib/log.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const EXECUTABLE_MODE = 0o755
const log = logger('restore')

function destinationName(entry, naming) {
  const isWindows = entry.platform.startsWith('win32')
  if (entry.id.endsWith('.dll')) return entry.id
  if (naming === 'triple') return `${entry.id}-${entry.triple}${isWindows ? '.exe' : ''}`
  return `${entry.id}${isWindows ? '.exe' : ''}`
}

function assetUrl(tag, asset) {
  return `https://github.com/${REPO_SLUG}/releases/download/${tag}/${encodeURIComponent(asset)}`
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const platforms = parseList(flags.platform ?? flags.platforms)
  const ids = parseList(flags.only)
  const naming = flags.naming === 'triple' ? 'triple' : 'plain'

  if (!flags.dest || flags.dest === true) throw new Error('--dest is required')
  const dest = resolve(String(flags.dest))

  const manifest = readManifest(join(ROOT, 'manifest.json'))
  const tag = flags.tag && flags.tag !== true ? String(flags.tag) : manifest.tag

  const wanted = manifest.artifacts.filter(
    (entry) =>
      (!platforms || platforms.includes(entry.platform)) && (!ids || ids.includes(entry.id)),
  )
  if (wanted.length === 0) throw new Error('no manifest entry matches the given filters')

  mkdirSync(dest, { recursive: true })
  log.info(`${wanted.length} artifact(s) from ${REPO_SLUG} @ ${tag} → ${dest}`)

  for (const entry of wanted) {
    const target = join(dest, destinationName(entry, naming))
    if (existsSync(target) && !flags.force) {
      log.info(`${target} exists — skipping (use --force to overwrite)`)
      continue
    }

    const bytes = await downloadBuffer(assetUrl(tag, entry.asset), githubHeaders())
    const digest = sha256(bytes)
    if (digest !== entry.sha256) {
      throw new Error(
        `${entry.asset}: sha256 ${digest.slice(0, 12)} does not match the manifest ` +
          `(${entry.sha256.slice(0, 12)}) — refusing to install`,
      )
    }

    writeFileSync(target, bytes)
    if (!entry.platform.startsWith('win32')) chmodSync(target, EXECUTABLE_MODE)
    log.ok(`${target}  ${entry.version}`)
  }
}

main().catch((error) => {
  log.fail(error.message)
  process.exit(1)
})
