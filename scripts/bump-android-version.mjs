#!/usr/bin/env node
// Bumps android/version.properties so each test build gets a strictly-increasing versionCode
// (required for Android to allow installing over a previously-sideloaded copy) and a readable
// versionName. android/app/build.gradle reads this file at build time. Run via `npm run
// android:bump`, or as part of `npm run android:build`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const propsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'android', 'version.properties');

function parseProps(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_.]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const existing = existsSync(propsPath) ? parseProps(readFileSync(propsPath, 'utf8')) : {};
const nextCode = (parseInt(existing.versionCode, 10) || 0) + 1;

// versionName used to be hardcoded to `1.0.${versionCode}`, which tied the marketing version to the
// build counter and made a minor bump impossible to express — the eleventh build could only ever be
// called 1.0.11, even when it carried a feature. Pass one explicitly for a feature release:
//   node scripts/bump-android-version.mjs 1.1.0
// With no argument it keeps the previous name's major.minor and advances the patch, so plain test
// builds still just tick over.
const arg = process.argv[2];
if (arg && !/^\d+\.\d+\.\d+$/.test(arg)) {
  console.error(`versionName must look like 1.2.3 (got "${arg}")`);
  process.exit(1);
}
const prev = /^(\d+)\.(\d+)\.(\d+)$/.exec(existing.versionName ?? '');
const nextName = arg ?? (prev ? `${prev[1]}.${prev[2]}.${Number(prev[3]) + 1}` : `1.0.${nextCode}`);

const content = `# Auto-managed by scripts/bump-android-version.mjs — do not hand-edit versionCode.
# versionCode must strictly increase for Android to allow installing over a previous copy.
versionCode=${nextCode}
versionName=${nextName}
`;
writeFileSync(propsPath, content);
console.log(`Bumped Android version -> versionCode ${nextCode}, versionName ${nextName}`);
