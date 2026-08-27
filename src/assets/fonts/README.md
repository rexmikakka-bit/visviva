# Bundled fonts

**Saira** — Omnibus-Type, SIL Open Font License 1.1 (see `OFL.txt`).
Source: <https://github.com/Omnibus-Type/Saira>, via Google Fonts v23.

`saira-latin.woff2` is Google's own **latin** subset (`U+0000-00FF` plus common punctuation and
symbols) of the **variable** face. Because it is variable, that one 33 KB file covers the entire
100–900 weight axis — which is why `index.css` declares `font-weight: 100 900` rather than shipping a
file per weight. Two weights are actually used (600 for hull names, 700 for the wordmark).

It is committed rather than linked from `fonts.googleapis.com` on purpose: the app is offline-capable
by design (item art is bundled for the same reason), and a linked font either FOUTs or fails outright
with no network. It also means no third-party request on launch.

To refresh it, take the `latin` block's URL from

    https://fonts.googleapis.com/css2?family=Saira:wght@600;700&display=swap

requested with a modern browser User-Agent — Google serves the same variable file for both weights.
Verify the replacement still has an `fvar` table: `index.css` sets a weight *range*, and `:root` sets
`font-synthesis: none`, so a static file would silently render 600 and 700 both at 400.
