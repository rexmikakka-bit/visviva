# Shipping to TestFlight without a Mac

`.github/workflows/ios-testflight.yml` builds a signed iOS release on a GitHub-hosted Mac and
uploads it to TestFlight. This repo is public, so macOS runners cost nothing. **No Mac is
required at any point** — including for the signing certificate, which people usually assume
needs Keychain Access.

Everything below is a **one-time setup**. After it, shipping a build is: Actions → iOS TestFlight
→ Run workflow.

---

## A. Apple Developer Program

Enroll at [developer.apple.com/programs](https://developer.apple.com/programs/) — $99/year.
Usually approved within hours, occasionally a couple of days. Nothing else here works without it.

Once in, note your **Team ID**: Account → Membership details. Ten characters, e.g. `A1B2C3D4E5`.

---

## B. The signing certificate (run these on Windows)

A distribution certificate is just an RSA key plus Apple's signature over a Certificate Signing
Request. `openssl` produces a CSR exactly as well as a Mac's Keychain Access does.

Run these in **Git Bash** from any scratch directory:

```bash
# 1. Private key — this file is the thing that must never leak.
openssl genrsa -out ios_distribution.key 2048

# 2. Certificate Signing Request.
#    MSYS_NO_PATHCONV=1 is required in Git Bash. Without it, Git Bash rewrites the leading "/" of
#    -subj into a Windows path and destroys the subject. Doubling the slash ("//emailAddress")
#    also stops the mangling, but OpenSSL then reads the attribute name as "/emailAddress" and
#    SKIPS it — the field vanishes with only a warning on stderr. On macOS/Linux drop the prefix.
MSYS_NO_PATHCONV=1 openssl req -new -key ios_distribution.key -out ios_distribution.csr \
  -subj "/emailAddress=you@example.com/CN=Your Name/C=US"

# Read the subject back. "It produced a file" is not the same as "it produced the right file" —
# a missing emailAddress means the escaping did not take.
openssl req -in ios_distribution.csr -noout -subject
```

Apple does not use the CSR's subject: the certificate it issues is named from your developer
account (`Apple Distribution: Your Name (TEAMID)`), so the email here does not have to match the
one on the account. Getting it right is still worth doing — a mangled `-subj` is a reliable sign
the shell is eating your arguments.

Then, in the browser: **developer.apple.com → Certificates, IDs & Profiles → Certificates → +**
→ **Apple Distribution** → upload `ios_distribution.csr` → download `distribution.cer`.

Back in Git Bash, in the same directory as the `.cer`:

```bash
# 3. Apple hands back DER; PKCS#12 wants PEM.
openssl x509 -inform DER -in distribution.cer -out distribution.pem

# 4. Bundle the key and the certificate into a .p12.
#    -legacy IS REQUIRED on OpenSSL 3.x. Without it you get AES-256-CBC + SHA-256, which macOS's
#    `security import` refuses; -legacy produces the RC2/SHA-1 form it accepts. (If you are on
#    OpenSSL 1.x the flag does not exist — drop it, the default is already the old form.)
openssl pkcs12 -export -legacy \
  -inkey ios_distribution.key -in distribution.pem \
  -out distribution.p12 -name "Apple Distribution"
```

Pick a password when prompted — you will need it again in step E.

Verify it round-trips before going further:

```bash
openssl pkcs12 -in distribution.p12 -info -nokeys -legacy | grep -i "MAC:\|PKCS7"
# want: "MAC: sha1" and "pbeWithSHA1And40BitRC2-CBC"
# if you see "sha256" / "AES-256-CBC", -legacy did not take and the runner will fail to import it
```

---

## C. Bundle ID and provisioning profile

Still under **Certificates, IDs & Profiles**:

1. **Identifiers → +** → App IDs → App. Description: `Axis`. Bundle ID: **Explicit**,
   `com.rexmikakka.visviva` — this must match `appId` in `capacitor.config.json` exactly. No
   capabilities need enabling. **The bundle ID deliberately still says `visviva`**: the app was
   renamed Visviva → Axis, but a bundle ID is permanent — changing it orphans the App Store Connect
   record, the provisioning profile and every TestFlight tester, and forces Android users to
   uninstall/reinstall. It is never shown to a user. Do not "tidy" it.
2. **Profiles → +** → Distribution → **App Store Connect** → select that App ID → select the
   certificate from step B → name it something you will recognise (e.g. `Axis App Store`) →
   download the `.mobileprovision`.

The workflow reads the profile's name and UUID out of the file itself, so there is nothing to
copy down here.

---

## D. App Store Connect

1. **appstoreconnect.apple.com → Apps → +** → New App. Platform iOS, the same bundle ID,
   SKU anything (e.g. `axis`), name `Axis`. **The app record must exist before the first
   upload** — the upload fails otherwise.

   If the record already exists under the old name `Vis Viva`, rename it in **App Store Connect →
   your app → App Information → Name**. That field, not the bundle ID, is what users see on the
   App Store; it takes effect with the next submitted version.
2. **Users and Access → Integrations → App Store Connect API → Team Keys → +**. Name it
   `GitHub Actions`, role **App Manager**. Download `AuthKey_XXXXXXXXXX.p8` — Apple lets you
   download it exactly once. Note the **Key ID** (in the filename) and the **Issuer ID** (shown
   above the key list, a UUID).

---

## E. GitHub secrets

Settings → Secrets and variables → Actions → New repository secret, for each of:

| Secret | Value |
| --- | --- |
| `IOS_DIST_CERT_P12_BASE64` | `base64 -w0 distribution.p12` |
| `IOS_DIST_CERT_PASSWORD` | the password you chose in step B |
| `IOS_PROVISIONING_PROFILE_BASE64` | `base64 -w0 <your>.mobileprovision` |
| `IOS_TEAM_ID` | your ten-character Team ID from step A |
| `ASC_KEY_ID` | the Key ID from step D (the `XXXXXXXXXX` in the filename) |
| `ASC_ISSUER_ID` | the Issuer ID UUID from step D |
| `ASC_KEY_P8_BASE64` | `base64 -w0 AuthKey_XXXXXXXXXX.p8` |

`base64 -w0` prints one unbroken line with no trailing newline — paste the whole thing. The
workflow checks all seven are non-empty before it does anything expensive.

Once the secrets are in, **delete the local `.p12`, `.key` and `.p8`** or move them somewhere
you actually back up. Losing the `.p8` means generating a new API key; losing the `.key` means
revoking and reissuing the certificate.

---

## F. Run it

**Do a dry run first.** Actions → iOS TestFlight → Run workflow → set **upload** to `false`.
That exercises every step including signing and produces a downloadable `.ipa` artifact, but
publishes nothing and burns no build number in App Store Connect. If it goes green, signing is
correct and the only thing left untested is the upload itself.

Then run it again with **upload** `true`.

- **Version** is what testers see (`1.0.0`). Change it when you want to.
- **Build number** is the workflow run number, so it always increases. App Store Connect rejects
  a duplicate build number permanently, which is why this is not something you type.

Processing in App Store Connect takes 5–15 minutes after the upload succeeds.

---

## G. TestFlight

App Store Connect → your app → **TestFlight**.

- **Internal Testing** — up to 100 testers on your own team, **no review**, installable within
  minutes of processing. This is what you want for yourself.
- **External Testing** — up to 10,000 testers, requires a Beta App Review (usually a day or two).
  Before doing this, read `MOBILE_SETUP.md` §9: CCP's developer license is non-commercial, and
  the IP disclaimer already in Settings → footer needs mirroring in the listing.

Testers install via the TestFlight app on iOS.

### If a build processes but never reaches a device

Seen on 1.4.0 (build 21), 2026-08-09: `UPLOAD SUCCEEDED`, App Store Connect showed the version
green, and it still did not appear in the TestFlight app after ~8 hours — no tester email either.
**Opening the build in App Store Connect released it immediately.**

Nothing was wrong with the binary, and nothing is wrong with the workflow, but note that the
workflow **stops at `altool --upload-app`**: it never assigns the build to a tester group. So
"processed" and "distributed" are two different things, and only the second produces an email or a
TestFlight entry. When a build seems to be missing:

1. Check your Apple ID mail for a processing-failure notice (arrives within ~20 min if the binary
   was rejected — that is a different failure and names its own cause).
2. Open App Store Connect → TestFlight → the build. If it is listed and green, poke it; that alone
   has been enough.
3. Check the internal group's **Automatically distribute builds** setting.

If this recurs, the durable fix is a post-upload step that assigns the build to the internal group
through the App Store Connect API — the workflow's existing key has the rights for it. It is not
there today, deliberately: it needs the group's exact name, and it is worth a dry run rather than
being discovered mid-release.

---

## What the workflow does, and where it can fail

| Step | Fails when |
| --- | --- |
| Check required secrets | One of the seven is missing or empty. Names them explicitly. |
| Generate the native iOS project | `npx cap add ios` — needs `capacitor.config.json` and a successful `npm run build` first. |
| Generate app icons | Sources are `assets/logo.svg` etc. |
| Verify the app icon | No 1024pt icon produced, or it has an alpha channel — Apple rejects alpha at upload, so this catches it in two minutes rather than after a 20-minute archive. |
| Apply iOS project settings | `scripts/patch-ios-project.sh` — the `eveauth-visviva://` URL scheme for ESI login and the export-compliance flag. Regenerated every run because `ios/` is not committed. |
| Install the signing certificate | The `.p12` was built without `-legacy` (see step B), or the password secret is wrong. |
| Install the provisioning profile | Explicitly checks the profile's bundle ID against `capacitor.config.json` — a mismatch otherwise fails deep inside `codesign` with an unhelpful message. |
| Archive / Export | Certificate, profile and Team ID have to agree with each other. |
| Verify the Xcode toolchain | The runner's iOS SDK is below Apple's floor. Apple raises this roughly annually and enforces it **at upload**, so this check exists to fail in seconds rather than after a full archive. Fix by bumping both `runs-on:` and `MIN_IOS_SDK_MAJOR` — see below. |
| Upload to TestFlight | The app record does not exist yet (step D), the build number was already used, or the API key lacks App Manager. |

### When Apple raises the SDK floor

Uploads start failing with a 409: *"This app was built with the iOS X SDK. All iOS and iPadOS
apps must be built with the iOS Y SDK or later."* The build itself is fine — the runner image
just ships an older Xcode. Fix both together in `.github/workflows/ios-testflight.yml`:

1. `runs-on:` → the newest `macos-*` image (check which Xcode it carries in
   [actions/runner-images](https://github.com/actions/runner-images/tree/main/images/macos)).
2. `MIN_IOS_SDK_MAJOR:` → the new floor.


---

## Still outstanding, unrelated to signing

**ESI login does not work in these builds.** `ESI_CLIENT_ID` in `src/esi-config.js` is empty.
Register the application at [developers.eveonline.com](https://developers.eveonline.com/) —
Authentication & API Access, public client / PKCE — with **both** callback URLs (the web origin
and `eveauth-visviva://auth-callback`), paste the Client ID in, and ship a new build. The iOS URL scheme
is already wired up by `patch-ios-project.sh`; everything downstream of a successful login is
fixture-verified (see CLAUDE.md's ESI section).
