# Møteromskart – Grensesvingen 6

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

The drawings only carry numbers. To show real names, add them to `names.json`:

```json
{ "N 381": "Bjørvika", "S 353": "Sognsvann" }
```

Runtime only — no rebuild needed.

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
