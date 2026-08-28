#!/usr/bin/env node
// Version-bump gate for PRs to main.
//
// Usage: node scripts/check-version-bump.mjs <base-package.json> <head-package.json>
//
// Fails (exit 1) unless the head version is strictly greater than the base
// version, so every merge to main carries a real version bump.
import { readFile } from 'node:fs/promises'

const [, , basePath, headPath] = process.argv
if (!basePath || !headPath) {
  console.error('usage: node scripts/check-version-bump.mjs <base-package.json> <head-package.json>')
  process.exit(2)
}

function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v).trim())
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] }
}

// Return >0 if a > b, <0 if a < b, 0 if equal (numeric core; prerelease treated
// as below the same core release, matching semver).
function compare(a, b) {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (!a.pre && !b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  return a.pre === b.pre ? 0 : (a.pre < b.pre ? -1 : 1)
}

const baseVer = parseSemver(JSON.parse(await readFile(basePath, 'utf8')).version)
const headVer = parseSemver(JSON.parse(await readFile(headPath, 'utf8')).version)
if (!baseVer) { console.error(`Base version in ${basePath} is not semver`); process.exit(1) }
if (!headVer) { console.error(`Head version in ${headPath} is not semver`); process.exit(1) }

if (compare(headVer, baseVer) > 0) {
  console.log(`PASS: version bumped ${baseVer.major}.${baseVer.minor}.${baseVer.patch} -> ${headVer.major}.${headVer.minor}.${headVer.patch}`)
} else {
  console.error(
    `FAIL: version NOT bumped (base ${baseVer.major}.${baseVer.minor}.${baseVer.patch}, head ${headVer.major}.${headVer.minor}.${headVer.patch}). ` +
    `Bump package.json "version" (e.g. npm version patch --no-git-tag-version) before merging to main.`
  )
  process.exit(1)
}
