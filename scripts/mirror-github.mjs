#!/usr/bin/env node
/**
 * Mirror this repository to a public GitHub repo through the Git Data API.
 * Useful when direct `git push github` is blocked by network policy.
 *
 *   GITHUB_TOKEN=... node scripts/mirror-github.mjs
 *   GITHUB_TOKEN=... node scripts/mirror-github.mjs --owner coreyleung-art --repo dsh-requirement-copilot --tag
 *
 * Token is read from the environment only; never write it to a file.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const args = process.argv.slice(2)
function arg(name, fallback) {
  const index = args.indexOf('--' + name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const owner = arg('owner', 'coreyleung-art')
const repo = arg('repo', 'dsh-requirement-copilot')
const makeTag = args.includes('--tag')
const token = process.env.GITHUB_TOKEN
if (!token) throw new Error('GITHUB_TOKEN is required')
const base = 'https://api.github.com/repos/' + owner + '/' + repo
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: 'token ' + token,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-requirement-copilot-mirror'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await response.text()
  let parsed
  try { parsed = text === '' ? null : JSON.parse(text) } catch { parsed = text }
  if (!response.ok) throw new Error(method + ' ' + url + ' -> ' + response.status + ' ' + text.slice(0, 300))
  return parsed
}

async function walk(dir, prefix) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'dist' || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    const rel = prefix === '' ? entry.name : prefix + '/' + entry.name
    if (entry.isDirectory()) out.push(...await walk(full, rel))
    else if (entry.isFile()) out.push({ full, rel })
  }
  return out
}

const files = await walk(root, '')
console.log('[mirror] files=' + files.length)

let parentSha = null
try {
  const ref = await api('GET', base + '/git/ref/heads/main')
  parentSha = ref.object.sha
  console.log('[mirror] existing main=' + parentSha)
} catch {
  console.log('[mirror] empty repository; seeding main')
  await api('PUT', base + '/contents/README.md', {
    message: 'Initialize public mirror',
    content: Buffer.from('# ' + repo + '\n\nInitializing the public mirror.\n', 'utf8').toString('base64'),
    branch: 'main'
  })
  const ref = await api('GET', base + '/git/ref/heads/main')
  parentSha = ref.object.sha
}

const entries = []
for (const file of files) {
  const content = await fs.readFile(file.full)
  const blob = await api('POST', base + '/git/blobs', {
    content: content.toString('base64'),
    encoding: 'base64'
  })
  entries.push({ path: file.rel, mode: '100644', type: 'blob', sha: blob.sha })
}
const tree = await api('POST', base + '/git/trees', { tree: entries })
const commit = await api('POST', base + '/git/commits', {
  message: 'Public mirror: ' + pkg.name + ' ' + pkg.version,
  tree: tree.sha,
  parents: parentSha === null ? [] : [parentSha]
})
await api('PATCH', base + '/git/refs/heads/main', { sha: commit.sha, force: true })
console.log('[mirror] commit=' + commit.sha)

if (makeTag) {
  try {
    await api('POST', base + '/git/refs', { ref: 'refs/tags/v' + pkg.version, sha: commit.sha })
    console.log('[mirror] tag v' + pkg.version + ' created')
  } catch (error) {
    console.log('[mirror] tag skipped: ' + error.message.slice(0, 200))
  }
}
await api('PATCH', base, { default_branch: 'main' })
const final = await api('GET', base)
console.log('[mirror] repo=' + final.full_name + ' private=' + final.private + ' default=' + final.default_branch)
