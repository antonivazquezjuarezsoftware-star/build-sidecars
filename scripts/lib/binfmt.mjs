// scripts/lib/binfmt.mjs — executable format and CPU architecture, read from the
// file's own header.
//
// This is what turns the manifest from "a list of files we downloaded" into
// something that can catch a provider quietly serving the wrong build. A
// mirror that stores an x86_64 binary under an arm64 name is worse than no
// mirror, because the mistake is then reproducible.

const MACHO_64_LE = 0xfeedfacf
const MACHO_FAT_BE = 0xcafebabe
const ELF_MAGIC = 0x7f454c46
const PE_DOS_MAGIC = 0x5a4d // 'MZ', little-endian u16

const MACHO_CPU = { 0x01000007: 'x64', 0x0100000c: 'arm64' }
const ELF_MACHINE = { 0x3e: 'x64', 0xb7: 'arm64' }
const PE_MACHINE = { 0x8664: 'x64', 0xaa64: 'arm64' }

/**
 * Returns `{ format, arch }` for a buffer holding an executable.
 * `arch` is `null` when the format is known but the architecture is not
 * (a Mach-O fat binary carries several).
 */
export function inspectExecutable(buffer) {
  if (buffer.length < 8) return { format: 'unknown', arch: null }

  if (buffer.readUInt32LE(0) === MACHO_64_LE) {
    return { format: 'macho', arch: MACHO_CPU[buffer.readUInt32LE(4)] ?? null }
  }
  if (buffer.readUInt32BE(0) === MACHO_FAT_BE) {
    return { format: 'macho-universal', arch: null }
  }
  if (buffer.readUInt32BE(0) === ELF_MAGIC) {
    return { format: 'elf', arch: ELF_MACHINE[buffer.readUInt16LE(18)] ?? null }
  }
  if (buffer.readUInt16LE(0) === PE_DOS_MAGIC) {
    return { format: 'pe', arch: readPeMachine(buffer) }
  }
  return { format: 'unknown', arch: null }
}

function readPeMachine(buffer) {
  const PE_HEADER_OFFSET_AT = 0x3c
  if (buffer.length < PE_HEADER_OFFSET_AT + 4) return null
  const peOffset = buffer.readUInt32LE(PE_HEADER_OFFSET_AT)
  if (buffer.length < peOffset + 6) return null
  if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') return null
  return PE_MACHINE[buffer.readUInt16LE(peOffset + 4)] ?? null
}

/** The executable format a given `<platform>-<arch>` key is expected to produce. */
export function expectedFormat(platform) {
  if (platform.startsWith('win32')) return 'pe'
  if (platform.startsWith('darwin')) return 'macho'
  return 'elf'
}

/**
 * Compares a detected header against the platform key it was filed under.
 * Returns `{ ok, reason }`; `reason` is null when it matches.
 */
export function checkAgainstPlatform({ format, arch }, platform) {
  const [, expectedArch] = platform.split('-')
  const wanted = expectedFormat(platform)

  if (format === 'macho-universal' && wanted === 'macho') {
    return { ok: true, reason: null }
  }
  if (format !== wanted) {
    return { ok: false, reason: `format ${format}, expected ${wanted}` }
  }
  if (arch !== null && arch !== expectedArch) {
    return { ok: false, reason: `arch ${arch}, expected ${expectedArch}` }
  }
  return { ok: true, reason: null }
}
