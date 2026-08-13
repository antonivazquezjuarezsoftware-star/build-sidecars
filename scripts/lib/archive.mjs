// scripts/lib/archive.mjs — archive extraction that picks the tool by content,
// not by host.
//
// GNU tar (Linux) cannot read a zip, unlike the bsdtar a macOS or Windows 10+
// developer has. Choosing by magic bytes is what makes this work identically
// in a container and on a laptop.

import { execFileSync } from 'child_process'
import { readdirSync, readFileSync, statSync } from 'fs'
import { basename, join } from 'path'

const ZIP_MAGIC = ['PK', 'PK', 'PK']
const SEVEN_ZIP_MAGIC = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
const XZ_MAGIC = Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b])

/** Identifies an archive from its first bytes: 'zip' | '7z' | 'tar' | null. */
export function detectArchive(buffer) {
  const head = buffer.subarray(0, 6)
  if (ZIP_MAGIC.includes(buffer.toString('latin1', 0, 4))) return 'zip'
  if (head.equals(SEVEN_ZIP_MAGIC)) return '7z'
  if (head.equals(XZ_MAGIC)) return 'tar'
  if (head.subarray(0, 2).equals(GZIP_MAGIC)) return 'tar'
  return null
}

function firstAvailable(candidates) {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  for (const candidate of candidates) {
    try {
      execFileSync(probe, [candidate], { stdio: 'ignore' })
      return candidate
    } catch {
      // keep looking
    }
  }
  return null
}

/**
 * Extracts `archivePath` into `destDir`. Throws naming the missing tool rather
 * than failing with a cryptic message from the extractor itself.
 */
export function extractArchive(archivePath, destDir, kind) {
  if (kind === 'zip') {
    const unzip = firstAvailable(['unzip'])
    if (unzip) {
      execFileSync(unzip, ['-q', '-o', archivePath, '-d', destDir], { stdio: 'inherit' })
      return
    }
    // bsdtar reads zip; GNU tar does not, and will fail loudly if it is what we get.
    execFileSync('tar', ['-xf', archivePath, '-C', destDir], { stdio: 'inherit' })
    return
  }

  if (kind === '7z') {
    const sevenZip = firstAvailable(['7zz', '7z', '7za'])
    if (!sevenZip) {
      throw new Error(
        'no 7-Zip binary found (tried 7zz, 7z, 7za) — install p7zip to mirror this artifact',
      )
    }
    execFileSync(sevenZip, ['x', '-y', `-o${destDir}`, archivePath], { stdio: 'inherit' })
    return
  }

  execFileSync('tar', ['-xf', archivePath, '-C', destDir], { stdio: 'inherit' })
}

/**
 * Finds a file by basename anywhere under `root`. Matching on basename means an
 * archive's leading directory (`ffmpeg-master-latest-win64-gpl/bin/...`) does
 * not have to be spelled out in the config, where it would be one more thing
 * that silently drifts when upstream renames it.
 */
export function findMember(root, member) {
  const wanted = member.toLowerCase()
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      const stats = statSync(full)
      if (stats.isDirectory()) stack.push(full)
      else if (basename(full).toLowerCase() === wanted) return full
    }
  }
  return null
}

export const readHead = (path, bytes = 4096) => readFileSync(path).subarray(0, bytes)
