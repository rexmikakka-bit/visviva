# Shipping a release (Android + iOS)

> Referenced from the top-level `CLAUDE.md`. Read this when cutting a release. Reminder of the
> standing rules from project memory: don't bump the minor version unasked, and every release ships
> both platforms.

Releases come off `main` unless you are deliberately cutting a device build of an unmerged branch
(see the iOS `--ref` note). Always `npm run verify` first — CI runs the same suite on PRs, but the
release path itself is not gated.

## Version numbering

`android/version.properties` is the source of truth **for Android only**, and is **auto-managed** —
never hand-edit `versionCode`.

⚠️ **It is not the source of truth for iOS, and it lies about it.** iOS takes its marketing version
from a workflow *input*, which is written down nowhere in this repo — so every iOS-only release
leaves `version.properties` stranded at whatever Android last shipped. The two platforms share a
marketing version only when a release actually ships both, and that has already drifted eight
patch versions (Android 1.19.10 / TestFlight 1.19.18) and cost a burned build number, because
trusting `version.properties` cut an iOS build labelled *lower* than the one already out.

Read the last iOS marketing version from the workflow history instead:

```bash
gh run list --workflow=ios-testflight.yml -L 5 --json databaseId,number \
  -q '.[] | "\(.number) \(.databaseId)"'          # run number IS the iOS build number
gh run view <databaseId> --log | grep -o "MARKETING_VERSION: [0-9.]*" | head -1
```

Feature work gets a minor bump (1.2.0 -> 1.3.0); fix-only gets a patch (1.3.0 -> 1.3.1).

## Android

```bash
npm run cap:sync                             # vite build + cap sync
node scripts/bump-android-version.mjs 1.3.0  # PASS THE VERSION EXPLICITLY
node scripts/gradle-assemble.mjs
```

**`npm run android:build` is not the release path.** It runs `android:bump` with *no argument*,
which only advances the patch digit — so a feature release built that way silently ships as
1.2.2 instead of 1.3.0. Bump explicitly, then assemble.

Verify the APK rather than trusting the bump script's own output — the two have disagreed before:

```bash
"$LOCALAPPDATA"/Android/Sdk/build-tools/*/aapt2.exe dump badging android/app/build/outputs/apk/debug/app-debug.apk | head -1
```

Then commit `android/version.properties` alone as `Release 1.3.0: versionCode 14`, push, and attach
the APK (`android/app/build/outputs/apk/debug/app-debug.apk`, ~16 MB) to a GitHub release tagged
`android-1.3.0`. The release notes are what testers actually read — write them in terms of what
changed for the user, not the commit log.

### Google Play (signed AAB — a different artifact from the GitHub release)

The GitHub release ships a **debug-signed APK**, which is right for sideloading and wrong for Play.
Play needs a **signed AAB**, built by a separate task:

```bash
node scripts/bump-android-version.mjs 1.7.0   # explicit, same as the APK path
npm run android:bundle                        # → android/app/build/outputs/bundle/release/app-release.aab
```

`android:bundle` deliberately does **not** bump, for the same reason `android:build` doing an
implicit bump is a trap (above). Bump first, explicitly.

Signing is driven by **`android/key.properties`**, which is gitignored (it holds three passwords in
plaintext and this repo is public). Its absence is the normal case and does not break anything — the
project still configures, `assembleDebug` still works, and `bundleRelease` still succeeds but emits
an **unsigned** AAB that Play rejects loudly. If an upload is refused for signing, check that this
file exists before suspecting the Gradle config. Format:

```properties
storeFile=C:/Users/owen_/keys/axis-upload.jks
storePassword=...
keyAlias=axis-upload
keyPassword=...
```

`storeFile` resolves against `android/`; an absolute path outside the repo is preferred. **Use
forward slashes** — in a Java `.properties` file a backslash is an escape character, so a pasted
Windows path fails with a confusing "keystore not found".

Play App Signing means Google holds the real distribution key and this is only the *upload* key, so
losing it is recoverable through Play support — unlike the old pre-2021 model. Back it up anyway.

## iOS

**Manual dispatch only, on purpose** — it publishes to testers and burns a build number that can
never be reused:

```bash
gh workflow run ios-testflight.yml -f marketing_version=1.3.1 -f upload=true
gh run watch <run-id> --exit-status
```

- Add `--ref <branch>` to build a testable device copy of an unmerged branch. That is the right
  move when the point of the build is to exercise something that cannot be tested on a desktop
  (ESI login, deep links, WKWebView behaviour) — it avoids merging device-untested work.
- `upload=false` gives a signing dry run that produces only an `.ipa` artifact.
- The build number is `github.run_number`: monotonic, never resets, never reuse a marketing version
  with an old build number.
- `ios/` is deliberately NOT committed — it is regenerated every run, so a stale native project
  cannot drift from the web code. Anything you would otherwise hand-edit in Xcode belongs in
  `scripts/patch-ios-project.sh`.
- Roughly 3-20 minutes to build, then another 5-15 for App Store Connect to process before it
  reaches testers. Grep the run log for `UPLOAD SUCCEEDED`.
- No Mac required: the repo is public, so macOS runners are free. One-time signing/secret setup is
  in `IOS_RELEASE.md`.

### ⚠️ The app is iPhone-only, and that is what makes the portrait lock legal

Capacitor generates a **universal** (`TARGETED_DEVICE_FAMILY = "1,2"`) project. App Store Connect
rejects any iPad-capable bundle whose `UISupportedInterfaceOrientations~ipad` does not list **all
four** orientations — error **90474**, "to support iPad multitasking". `UIRequiresFullScreen` used to
exempt you; it is **ignored as of the iOS 26 SDK**, which is what CI builds against, so that escape
hatch is gone. Portrait-locking a universal build is therefore an automatic rejection.

`patch-ios-project.sh` seds the target down to `"1"` (iPhone) and **deletes** the `~ipad` key rather
than setting it. Both halves matter: a portrait-only `~ipad` key is the exact thing the validator
looks at.

The failure costs a build number and ~15 minutes, because it happens inside Apple's validator
*after* a successful archive and export — the archive itself is perfectly happy. That is why the
script `grep`s its own sed and exits non-zero if the setting ever moves, rather than letting a
universal build sail through to the upload step. If the app ever grows a genuine wide layout,
revisit this: the fix is to go universal again and give the iPad all four orientations.
