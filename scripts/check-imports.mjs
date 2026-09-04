/* ==================================================================
   ATLAS — check every import resolves, before the build starts

   Rollup stops at the FIRST unresolved import and names only that one.
   When several files are missing from the repo you get one build
   failure per file, which is a slow way to find out.

   This walks every file under src/, finds every relative import, and
   reports ALL the missing ones at once. It runs before vite, so a
   broken repo fails in a second with a complete list instead of
   failing six times in a row.

   Exits 0 when everything resolves.
   ================================================================== */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, dirname, resolve, relative } from 'path'

const ROOT = 'src'
const EXTS = ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx']

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(path)
  }
  return out
}

function resolves(from, spec) {
  const base = resolve(dirname(from), spec)
  return EXTS.some(e => existsSync(base + e))
}

if (!existsSync(ROOT)) {
  console.error(`\n  No ${ROOT}/ directory. Is this the right folder?\n`)
  process.exit(1)
}

const files = walk(ROOT)
const missing = []

for (const file of files) {
  const src = readFileSync(file, 'utf8')

  // import x from './y'   |   import './y'   |   from '../y'
  const specs = [
    ...src.matchAll(/from\s+['"](\.[^'"]+)['"]/g),
    ...src.matchAll(/import\s+['"](\.[^'"]+)['"]/g)
  ].map(m => m[1])

  for (const spec of [...new Set(specs)]) {
    if (!resolves(file, spec)) {
      missing.push({
        file: relative('.', file),
        spec,
        expected: relative('.', resolve(dirname(file), spec)) + '.jsx'
      })
    }
  }
}

if (!missing.length) {
  console.log(`  imports ok — ${files.length} files checked`)
  process.exit(0)
}

console.error('\n  MISSING FILES — the build cannot run until these exist:\n')

const byExpected = new Map()
for (const m of missing) {
  if (!byExpected.has(m.expected)) byExpected.set(m.expected, [])
  byExpected.get(m.expected).push(m.file)
}

for (const [expected, importers] of byExpected) {
  console.error(`    ${expected}`)
  console.error(`      imported by ${importers.join(', ')}`)
}

console.error(`\n  ${byExpected.size} file${byExpected.size > 1 ? 's' : ''} missing.`)
console.error('  Add them to the repo, then push again.\n')
process.exit(1)
