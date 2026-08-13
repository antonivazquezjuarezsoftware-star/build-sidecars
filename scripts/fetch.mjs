#!/usr/bin/env node
// scripts/fetch.mjs
//
// Downloads every declared sidecar into vendor/, records what actually landed
// in manifest.json, and leaves the upload to scripts/publish.mjs.
//
//   node scripts/fetch.mjs
//   node scripts/fetch.mjs --platforms win32-x64,linux-x64 --only ffmpeg
//   node scripts/fetch.mjs --tag vendor-2026-08-13
//
// A filtered run merges into the existing manifest rather than replacing it;
// --prune drops entries this run did not fetch.
//
// Nothing here mutates a consuming project: vendor/ is a staging area.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

import { ALL_PLATFORMS, VENDOR_DIR, enumerateTargets } from '../sidecars.config.mjs'
import { detectArchive, extractArchive, findMember } from './lib/archive.mjs'
import { checkAgainstPlatform, inspectExecutable } from './lib/binfmt.mjs'
import { downloadBuffer } from './lib/http.mjs'
import { buildManifest, mergeEntries, readManifest, sha256, writeManifest } from './lib/manifest.mjs'
import { logger, parseArgs, parseList } from './lib/log.mjs'
import { resolveDynamicSource } from './lib/resolvers.mjs'
import { contentVersion, resolveVersion, slugifyVersion } from './lib/versions.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const MIN_BINARY_BYTES = 1024
const log = logger('fetch')

/** `ffmpeg-7.1-win32-x64.exe` — id, version, platform, then the platform's extension. */
function assetName({ id, version, platform }) {
  const base = id.replace(/\.dll$/i, '')
  const extension = platform.startsWith('win32') ? (id.endsWith('.dll') ? '.dll' : '.exe') : ''
  return `${base}-${slugifyVersion(version)}-${platform}${extension}`
}

async function materialize(target, workDir) {
  const attempts = []
  for (const source of target.sources) {
    try {
      const { url, member, assetVersion } = await expand(source)
      log.info(`${target.id} ${target.platform} ← ${url}`)
      const payload = await downloadBuffer(url)
      const archiveKind = detectArchive(payload)

      if (!archiveKind) {
        if (payload.length < MIN_BINARY_BYTES) {
          throw new Error(`payload is ${payload.length} bytes — not a binary`)
        }
        return { bytes: payload, url, assetVersion }
      }

      const archivePath = join(workDir, 'download.archive')
      const extractDir = join(workDir, 'extracted')
      mkdirSync(extractDir, { recursive: true })
      writeFileSync(archivePath, payload)
      extractArchive(archivePath, extractDir, archiveKind)

      const found = findMember(extractDir, member ?? target.id)
      if (!found) throw new Error(`archive does not contain ${member ?? target.id}`)
      return { bytes: readFileSync(found), url, assetVersion }
    } catch (error) {
      attempts.push(`${source.url ?? source.resolver}: ${error.message}`)
    }
  }
  throw new Error(`every source failed:\n    - ${attempts.join('\n    - ')}`)
}

async function expand(source) {
  if (source.kind !== 'dynamic') return { url: source.url, member: source.member }
  const resolved = await resolveDynamicSource(source.resolver)
  return { url: resolved.url, member: source.member, assetVersion: resolved.assetVersion }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const platforms = parseList(flags.platforms) ?? ALL_PLATFORMS
  const ids = parseList(flags.only)
  const tag = flags.tag === undefined || flags.tag === true
    ? `vendor-${new Date().toISOString().slice(0, 10)}`
    : String(flags.tag)

  const vendorDir = join(ROOT, VENDOR_DIR)
  mkdirSync(vendorDir, { recursive: true })

  const targets = enumerateTargets({ platforms, ids })
  log.info(`${targets.length} artifact/platform pairs, tag ${tag}`)

  const entries = []
  const failures = []

  for (const target of targets) {
    const workDir = mkdtempSync(join(tmpdir(), 'build-sidecars-'))
    try {
      const { bytes, url, assetVersion } = await materialize(target, workDir)
      const digest = sha256(bytes)
      const version =
        (await resolveVersion(target.versionFrom, { assetVersion })) ?? contentVersion(digest)

      const header = inspectExecutable(bytes)
      const archCheck = checkAgainstPlatform(header, target.platform)
      if (!archCheck.ok) {
        log.warn(`${target.id} ${target.platform}: ${archCheck.reason}`)
      }

      const asset = assetName({ id: target.id, version, platform: target.platform })
      writeFileSync(join(vendorDir, asset), bytes)

      entries.push({
        id: target.id,
        platform: target.platform,
        triple: target.triple,
        asset,
        version,
        sha256: digest,
        size: bytes.length,
        format: header.format,
        detectedArch: header.arch,
        matchesPlatform: archCheck.ok,
        archNote: archCheck.reason,
        sourceUrl: url,
        license: target.license,
        consumers: target.consumers,
        fetchedAt: new Date().toISOString(),
      })
      log.ok(`${asset}  ${(bytes.length / 1e6).toFixed(1)} MB  ${digest.slice(0, 12)}`)
    } catch (error) {
      const message = `${target.id} ${target.platform}: ${error.message}`
      if (target.optional) log.warn(`skipped (optional) ${message}`)
      else {
        log.fail(message)
        failures.push(message)
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  }

  if (entries.length > 0) {
    const manifestPath = join(ROOT, 'manifest.json')
    const previous = existsSync(manifestPath) ? readManifest(manifestPath).artifacts : []
    const merged = flags.prune === true ? entries : mergeEntries(previous, entries)
    writeManifest(buildManifest(merged, { tag }), manifestPath)
    log.ok(`manifest.json — ${merged.length} entries (${entries.length} fetched this run)`)
  }

  const mismatched = entries.filter((entry) => !entry.matchesPlatform)
  if (mismatched.length > 0) {
    log.warn(
      `${mismatched.length} artifact(s) do not match the platform they are filed under — see manifest.json`,
    )
  }

  if (failures.length > 0) {
    log.fail(`${failures.length} required artifact(s) failed`)
    process.exit(1)
  }
}

main().catch((error) => {
  log.fail(error.stack ?? error.message)
  process.exit(1)
})
