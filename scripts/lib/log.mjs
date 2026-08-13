// scripts/lib/log.mjs — one place for the output prefix, so every script reads the same.

const SYMBOLS = { info: '·', ok: '✓', warn: '!', fail: '✗' }

function emit(level, scope, message) {
  const line = `${SYMBOLS[level]} [${scope}] ${message}`
  if (level === 'fail' || level === 'warn') console.error(line)
  else console.log(line)
}

export function logger(scope) {
  return {
    info: (message) => emit('info', scope, message),
    ok: (message) => emit('ok', scope, message),
    warn: (message) => emit('warn', scope, message),
    fail: (message) => emit('fail', scope, message),
  }
}

/** Minimal `--flag value` / `--flag=value` / `--bool` parser, so no dependency is needed. */
export function parseArgs(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const [name, inlineValue] = token.slice(2).split('=')
    if (inlineValue !== undefined) {
      flags[name] = inlineValue
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      flags[name] = next
      index += 1
    } else {
      flags[name] = true
    }
  }
  return flags
}

/** Splits a comma-separated flag into a trimmed list; `undefined` stays undefined. */
export function parseList(value) {
  if (value === undefined || value === true) return undefined
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}
