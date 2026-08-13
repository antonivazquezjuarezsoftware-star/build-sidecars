// scripts/lib/http.mjs — HTTP with retries.
//
// Single-maintainer hosts throttle datacenter IPs and have been observed
// returning an HTML error page with HTTP 200, so every caller validates the
// payload afterwards rather than trusting the status code alone.

const ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 1500
const USER_AGENT = 'build-sidecars/0.1 (+mirror)'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function request(url, headers) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT, ...headers },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`)
  }
  return response
}

async function withRetries(url, run) {
  let lastError
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      lastError = error
      if (attempt < ATTEMPTS) await sleep(RETRY_BASE_DELAY_MS * attempt)
    }
  }
  throw new Error(`${url}: ${lastError.message}`)
}

export function downloadBuffer(url, headers = {}) {
  return withRetries(url, async () => {
    const response = await request(url, headers)
    return Buffer.from(await response.arrayBuffer())
  })
}

export function getJson(url, headers = {}) {
  return withRetries(url, async () => {
    const response = await request(url, { accept: 'application/json', ...headers })
    return response.json()
  })
}

export function getText(url, headers = {}) {
  return withRetries(url, async () => (await request(url, headers)).text())
}

/** GitHub API auth, when a token is available. Anonymous requests are rate-limited to 60/h. */
export function githubHeaders() {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  return token ? { authorization: `Bearer ${token}` } : {}
}
