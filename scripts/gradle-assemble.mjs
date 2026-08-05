#!/usr/bin/env node
// Runs the Android Gradle wrapper, from any shell.
//
// The npm script used to be `cd android && gradlew.bat assembleDebug`. That only works when npm
// hands the script to cmd.exe: run the same command from Git Bash and you get
// "'gradlew.bat' is not recognized", because the wrapper is in the current directory and POSIX
// shells do not search there. Spawning the wrapper by absolute path sidesteps the shell entirely.
//
// It also finds a JDK. Gradle needs JAVA_HOME (or java on PATH), and a machine with Android Studio
// installed often has neither — the JDK is bundled inside Studio and never exported.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(root, 'android');
const wrapper = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
if (!existsSync(wrapper)) {
  console.error(`No Gradle wrapper at ${wrapper} — run \`npx cap add android\` first.`);
  process.exit(1);
}

// Candidate JDKs, in order of preference: whatever the environment already says, then the JetBrains
// Runtime that ships inside Android Studio.
const candidates = [
  process.env.JAVA_HOME,
  'C:/Program Files/Android/Android Studio/jbr',
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  path.join(process.env.HOME ?? '', 'Android/Studio/jbr'),
].filter(Boolean);
const javaHome = candidates.find((dir) => existsSync(path.join(dir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')));
if (javaHome && javaHome !== process.env.JAVA_HOME) console.log(`Using JDK: ${javaHome}`);
if (!javaHome) console.warn('No JDK found — falling back to whatever `java` is on PATH.');

const task = process.argv[2] ?? 'assembleDebug';
// Windows needs the wrapper run THROUGH cmd. Node refuses to spawn a .bat/.cmd directly without a
// shell (EINVAL, since the fix for CVE-2024-27980), and spawnSync reports that on `res.error`
// rather than throwing — so without the check below it exits quietly and you are left staring at a
// stale APK wondering why nothing changed.
const [cmd, args] = process.platform === 'win32'
  ? ['cmd.exe', ['/c', wrapper, task]]
  : [wrapper, [task]];
const res = spawnSync(cmd, args, {
  cwd: androidDir,
  stdio: 'inherit',
  env: javaHome ? { ...process.env, JAVA_HOME: javaHome } : process.env,
});
if (res.error) {
  console.error(`Could not run the Gradle wrapper: ${res.error.code} — ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status ?? 1);
