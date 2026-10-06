# Re-shooting the guide images

`capture.mjs` drives the dev server with Playwright at phone size (390×844, 3×, touch) and writes
every image in `docs/img/`. It is tooling only: nothing here is imported by the app or the build.

```sh
npm run dev                                   # terminal 1
FFMPEG=/path/to/ffmpeg BASE_URL=http://localhost:5173/ node docs/capture/capture.mjs          # all pages
node docs/capture/capture.mjs stats tags      # just some
```

- **Browser:** Playwright's Chromium (`npx playwright install chromium`), or set `BROWSER_CHANNEL=msedge`
  to drive an installed Edge instead.
- **ffmpeg** is needed for the GIFs. Any build works; `npm install ffmpeg-static` in a scratch folder
  outside the repo is the no-admin route.
- **Demo data:** captures run against a persistent profile in `docs/capture/.work/` (gitignored, or
  `CAPTURE_WORK`). Before the first run, import `demo-fit.txt` (the Hurricane Fleet Issue every page
  uses) and `demo-links.txt` (the Damnation for the fleet page) through ☰ → Import Fit → From EFT, then
  launch the Hurricane's five Acolyte IIs on its Drones tab. The `import` page uses its own throwaway
  profile so it never duplicates the demo fit.
- The tags page creates and re-creates a `kiting` tag, and the fleet page adds the Damnation as a
  command fit and removes it again, so a re-run starts from the same state.

The abyssal and pyfa-import pages are shot by hand against real data and are not in the script.
