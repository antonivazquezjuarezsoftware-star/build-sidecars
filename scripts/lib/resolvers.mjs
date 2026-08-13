// scripts/lib/resolvers.mjs — sources whose URL is not knowable ahead of time.
//
// Most artifacts have a stable download URL. libmpv does not: the publisher
// tags each build with a date and git hash, so the asset has to be discovered.
// Keeping that here means the config stays declarative.

import { getJson, getText, githubHeaders } from './http.mjs'

const MPV_DEV_ASSET = /^mpv-dev-x86_64-(\d{8})-git-([0-9a-f]+)\.7z$/
const SHINCHIRO_LATEST =
  'https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest'
const SOURCEFORGE_RSS =
  'https://sourceforge.net/projects/mpv-player-windows/rss?path=/libmpv'

/** Resolves a dynamic source to `{ url, assetVersion }`. */
export async function resolveDynamicSource(resolver) {
  if (resolver === 'shinchiro-libmpv') return resolveLibmpv()
  throw new Error(`unknown dynamic source resolver: ${resolver}`)
}

async function resolveLibmpv() {
  const errors = []
  for (const attempt of [fromGithub, fromSourceforge]) {
    try {
      return await attempt()
    } catch (error) {
      errors.push(error.message)
    }
  }
  throw new Error(`could not resolve a libmpv asset: ${errors.join(' | ')}`)
}

async function fromGithub() {
  const release = await getJson(SHINCHIRO_LATEST, githubHeaders())
  const asset = (release?.assets ?? []).find((candidate) =>
    MPV_DEV_ASSET.test(candidate?.name ?? ''),
  )
  if (!asset) throw new Error('no asset in the latest release matches the mpv-dev pattern')
  return { url: asset.browser_download_url, assetVersion: assetVersionOf(asset.name) }
}

async function fromSourceforge() {
  const feed = await getText(SOURCEFORGE_RSS, { accept: 'application/rss+xml' })
  const links = [...feed.matchAll(/<link>([^<]+)<\/link>/g)].map((match) => match[1])
  const match = links
    .map((link) => ({ link, name: decodeURIComponent(link).split('/').filter(Boolean).pop() }))
    .find((entry) => MPV_DEV_ASSET.test(entry.name ?? ''))
  if (!match) throw new Error('the SourceForge feed contains no mpv-dev archive')
  return { url: match.link, assetVersion: assetVersionOf(match.name) }
}

function assetVersionOf(name) {
  const parsed = MPV_DEV_ASSET.exec(name)
  return parsed ? `${parsed[1]}-git${parsed[2]}` : null
}
