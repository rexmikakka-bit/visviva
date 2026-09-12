# Temporary Axis abyssal promotion

Promotional artwork requested by Owen to celebrate the abyssal/MutaMarket integration.
These are separate promotional copies, not replacements for the permanent Axis icon.

- `axis-abyssal-promo-1024.png`: final master, 1024 x 1024.
- `axis-abyssal-promo-512.png`: smaller export, 512 x 512.

Both files are opaque 24-bit RGB PNGs, square and full bleed, without baked-in
rounded corners or an external border. Artwork was edited with the built-in image
generator to enlarge the red upper-left abyssal flag and inset its white triangle,
while retaining the Axis design; exports were resized and made opaque locally.

No existing assets, native icon configuration, or release settings were changed.
Do not replace permanent icons merely because this folder exists. If Owen requests
using these as temporary launcher icons, generate and visually verify the platform
assets first. In particular, Android adaptive/circular masks can clip the corner
badge and need a separate adaptive layout. Native mask/device verification has not
been performed. These flat PNGs are not a complete adaptive or layered icon set.

## 1.25.2 launcher use

Owen subsequently requested this artwork for both platform launcher icons, then explicitly
selected the original opaque 1024px master for Android as well as iOS. An inset adaptation
was rejected and is not used. Run
`node scripts/build-launcher-icons.mjs` (with sharp installed) to regenerate launcher assets
only. Keep using this script for the promotion: the older `build-icons.mjs` also replaces
splash, favicon and in-app marks, which are intentionally unchanged here. Circle and rounded
square previews were reviewed; physical launcher/device behavior remains device validation.
