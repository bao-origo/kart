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

## Routes between two rooms

The **Fra** / **Til** fields in the panel draw the walk from one room to the other on
the plan. Moving over a room in either list — with the pointer or with the arrow keys —
lights that room's pill on the plan, so you can see where a room is before picking it.
**Nullstill** empties both ends.

That is why neither field is a `<select>`. A native option list is drawn by the OS,
outside the page, and nothing there can see the pointer move over it — `appearance:
base-select` fixes that in Chrome and Edge, and nowhere else. So each field is a
`role="combobox"` button opening a `popover` `role="listbox"`, which puts the rooms in
the page where they can be hovered. The `popover` attribute carries the top layer, the
light dismiss and Escape; `wirePicker()` in `index.html` carries everything a `<select>`
would otherwise have given for free — the arrows, `Home`/`End`, `PageUp`/`PageDown`,
type-ahead, `Tab` and `Enter` to commit, `aria-activedescendant`, and scrolling the
active row into view. Focus stays on the button the whole time, so there is no focus to
move in and out of the list.

Type-ahead matches anywhere in a row rather than only at its start, because people know
room numbers: typing `372` finds N 372. Rooms on a floor other than the one on screen
light nothing — the plan shows one floor at a time — which is the same as hovering a
room row in the panel.

The corridors the walk follows are the `CORRIDORS` list in `index.html`: a handful
of axis-aligned segments in the same 0–1 coordinates `rooms.json` uses. Every floor is
the same drawing at the same size, so one skeleton serves all six. Each room joins it
at the nearest point on the nearest corridor, and the shortest way through is what gets
drawn.

Two floors means two walks with a ride or a climb between them: the three shafts left
of the middle are the lifts and the room below them is the stair, both serving floors
3–8. **Via** picks between them. Its other two options take the same shaft but stop at
the coffee machine on the eighth on the way, which turns the walk into three stops and
two rides — worth picking even when both rooms are on one floor. The map shows one
floor at a time, so it draws the legs for the floor you are on and the line under the
fields says which floors the rest is on. Where a floor carries two legs, the way back
retraces the way out, so each is drawn a little to the right of its own direction of
travel: two lanes rather than one line hiding another.

The walk is in the link, after the floor and the room the older links already carried:

```
…/kart/#3/N372?fra=3/N372&til=7/S751&via=trapp
```

`via` is left out when it is the lift. A `#3/N372` from before the fields existed still
means exactly what it did.

The skeleton is traced off the drawing by eye — enough to say which way round the
building to walk, not a survey. If the plans are ever redrawn, retrace it: overlay the
segments on `plan-3.png` and look.

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
npm i jsdom && node check.mjs   # smoke test: floors, search, filters, routes, deep links, zoom
```

## Licence

Public domain, [Unlicense](UNLICENSE).

## Hosting

GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main`.
Set **Settings → Pages → Source** to **GitHub Actions** once, or the workflow has
nothing to publish to.

All paths are relative, so it works from a project subpath. Deep links look like
`…/kart/#3/N372`, or `…/kart/#3?fra=3/N372&til=7/S751` for a walk, and are safe to
paste into Slack.
