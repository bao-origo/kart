# Kart – Grensesvingen 6

Static site that turns the architect's floor plan PDFs into a browsable map of the
meeting rooms on floors 3–8. Pick a floor, search for a room number, see where it is.

No backend and no build server: `index.html` is a single self-contained file that
reads two JSON files at runtime.

## Layout

| File | |
|---|---|
| `N. etasje i 2024.pdf` | source drawings from Romlaboratoriet, the only thing to replace when the floors change |
| `build.py` | renders each PDF to `plan-N.png` and extracts room positions into `rooms.json` |
| `index.html` | the whole site — markup, styles and script |
| `names.json` | hand-edited `{"N 381": "Bjørvika"}` map, merged in at runtime |
| `plan-N.png`, `rooms.json` | generated, committed so the site works straight off GitHub Pages |
| `manifest.webmanifest`, `sw.js` | make it installable and usable offline |
| `icon.svg`, `icon-*.png`, `apple-touch-icon.png` | app icons; the PNGs are rendered from the SVG |
| `check.mjs` | smoke test for `index.html` |

## Rebuilding after new drawings

Drop the new PDFs in (named `<floor>. …pdf`) and run:

```sh
uv run build.py
```

It prints a line per floor and flags any room whose number it could not read off the
drawing — those rooms still appear on the map, just without a number.

Room positions come from the room labels in the PDF text layer: each `Møterom` /
`Multirom` / … label is paired with the nearest room number below it. If a drawing
ever labels rooms differently, the patterns to adjust are `ROOM_TYPE` and `ROOM_CODE`
in `build.py`.

## Naming rooms

The drawings carry numbers and almost no names. To show real names, add them to
`names.json`:

```json
{ "N 381": "Bjørvika", "S 353": "Sognsvann" }
```

Runtime only — no rebuild needed, and it overrides anything the drawing named. The
one thing the drawing does name is the accessible toilet: it is a `WC` like the rest,
so it sits in their group and on their colour, and carries `"name": "HC-WC"` to say
which one it is. `LABEL_ALIAS` in `build.py` is where that pairing lives.

## Installing it as an app

The site is a PWA: Chrome and Edge offer "Install" in the address bar, Android
offers "Add to home screen", and on iOS it is Share → "Add to Home Screen". Installed,
it opens without browser chrome and the layout reaches under the notch.

`sw.js` caches the shell — `index.html`, `rooms.json`, `names.json`, the icons — on
install, and each `plan-N.png` the first time that floor is opened, so every floor you
have looked at once still works with no network. The plans are ~500 kB each, which is
why they are not all pulled down up front.

Caching is stale-while-revalidate: a visit serves the cached copy and fetches a fresh
one for next time, so a deploy shows up on the second load, not the first. **Bump
`CACHE` in `sw.js`** whenever the shell file list changes, or the old cache sticks
around.

The icons are rendered from `icon.svg`:

```sh
for s in 192 512; do rsvg-convert -w $s -h $s icon.svg -o icon-$s.png; done
rsvg-convert -w 180 -h 180 icon.svg -o apple-touch-icon.png   # iOS ignores SVG
```

## Local preview and tests

```sh
python3 -m http.server 8000     # then open http://localhost:8000
npm i jsdom && node check.mjs   # smoke test: floors, search, filters, deep links, zoom
```

## Licence

Public domain, [Unlicense](UNLICENSE).

## Hosting

GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main`.
Set **Settings → Pages → Source** to **GitHub Actions** once, or the workflow has
nothing to publish to.

All paths are relative, so it works from a project subpath. Deep links look like
`…/kart/#3/N372` and are safe to paste into Slack.
