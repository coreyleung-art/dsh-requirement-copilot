#!/usr/bin/env node
/**
 * Build the public distribution package for Say It For Me (帮我说).
 *
 * The source package already uses the public name `dsh-requirement-copilot`;
 * this script stages a clean copy (without tests/evals/docs), optionally strips
 * dev scripts, and runs `npm pack`.
 *
 *   node scripts/build-dist.mjs
 *   node scripts/build-dist.mjs --pack
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = sourcePackage.version
const publicName = 'dsh-requirement-copilot'
const distRoot = path.join(root, 'dist')
const outDir = path.join(distRoot, publicName)
const pack = process.argv.includes('--pack')

const COPY = [
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'icon.svg',
  'README.md',
  'CHANGELOG.md',
  'LICENSE'
]
const COPY_DIRS = ['locale']

function fail(message) {
  console.error('[dist] ' + message)
  process.exit(1)
}

function replaceInFile(file, from, to) {
  const text = fs.readFileSync(file, 'utf8')
  if (!text.includes(from)) return
  fs.writeFileSync(file, text.split(from).join(to), 'utf8')
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

for (const file of COPY) {
  const source = path.join(root, file)
  if (!fs.existsSync(source)) fail('missing file: ' + file)
  fs.copyFileSync(source, path.join(outDir, file))
}
for (const dir of COPY_DIRS) {
  fs.cpSync(path.join(root, dir), path.join(outDir, dir), { recursive: true })
}

// Public package identity: bundle row and client module id must follow the
// published name. The local repo keeps @local for the linked dev install.
replaceInFile(path.join(outDir, 'cordis.patch.yml'), "name: '@local/requirement-copilot'", "name: 'dsh-requirement-copilot'")
replaceInFile(path.join(outDir, 'client.js'), "id: '@local/requirement-copilot'", "id: 'dsh-requirement-copilot'")
replaceInFile(path.join(outDir, 'README.md'), '@local/requirement-copilot', 'dsh-requirement-copilot')

const publicPackage = {
  name: publicName,
  version,
  type: 'module',
  description: 'Say It For Me (帮我说): turn rough, incomplete requirement notes into a validated, agent-ready prompt with gaps, bilingual output and a confirmation gate — right inside the DeepSeek Harness composer.',
  license: 'MIT',
  author: sourcePackage.author,
  keywords: sourcePackage.keywords,
  repository: sourcePackage.repository,
  homepage: sourcePackage.homepage,
  bugs: sourcePackage.bugs,
  engines: sourcePackage.engines,
  exports: sourcePackage.exports,
  files: [
    'index.js',
    'client.js',
    'cordis.patch.yml',
    'locale/*.json',
    'icon.svg',
    'README.md',
    'CHANGELOG.md',
    'LICENSE'
  ],
  dsh: sourcePackage.dsh,
  publishConfig: {
    access: 'public',
    registry: 'https://registry.npmjs.org/'
  }
}
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(publicPackage, null, 2) + '\n', 'utf8')

console.log('[dist] staged ' + publicName + '@' + version)
console.log('[dist] output: ' + path.relative(root, outDir))

if (pack) {
  console.log('[dist] running npm pack')
  try {
    const output = process.platform === 'win32'
      ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm pack'], {
          cwd: outDir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'inherit']
        })
      : execFileSync('npm', ['pack'], { cwd: outDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
    process.stdout.write(output)
    const produced = path.join(outDir, publicName + '-' + version + '.tgz')
    if (!fs.existsSync(produced)) fail('npm pack did not produce ' + produced)
    fs.renameSync(produced, path.join(distRoot, path.basename(produced)))
    console.log('[dist] tarball: ' + path.relative(root, path.join(distRoot, path.basename(produced))))
  } catch (error) {
    fail('npm pack failed: ' + (error instanceof Error ? error.message : String(error)))
  }
}
