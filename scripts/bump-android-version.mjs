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
const nextName = `1.0.${nextCode}`;

const content = `# Auto-managed by scripts/bump-android-version.mjs — do not hand-edit versionCode.
# versionCode must strictly increase for Android to allow installing over a previous copy.
versionCode=${nextCode}
versionName=${nextName}
`;
writeFileSync(propsPath, content);
console.log(`Bumped Android version -> versionCode ${nextCode}, versionName ${nextName}`);
