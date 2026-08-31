#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pymupdf"]
# ///
"""Turn the architect's floor plan PDFs into plan-N.png + rooms.json.

Run with `uv run build.py` after new PDFs land in this directory.
"""

import glob
import json
import math
import os
import re

import pymupdf

# The drawing frame, without the title block and revision table at the bottom, and
# without the INNHOLD legend column down the left edge.
# 680 is just under the lowest wall on any floor (674 on the 8th), so the map ends
# where the building does instead of on a band of empty sheet. 183 is in the gutter
# between the widest legend block (floor 4) and the leftmost wall.
CLIP = pymupdf.Rect(183, 25, 1140, 680)
DPI = 200

ROOM_TYPE = re.compile(
    r"^(Møterom|Multirom|Prosjektrom|Hvilerom|Stillerom|Pod ?1p|Web-?rom|Datarom|Sosial sone"
    r"|Podcast webrom|HC ?-?WC|WC|Print ?/ ?[Kk]opi|Print|Kopi)$"
)
ROOM_CODE = re.compile(r"^[NS]?\s?\d{3}$")

# The accessible toilet — "HCWC" on most floors, "HC-WC" on the fourth — is a WC like
# the rest and groups with them; the name is what says which one it is.
# The print room is labelled "Print/Kopi" on one floor, "Print" or "Kopi" on the next.
# They are the same room type, so they answer to the one name the legend tallies them
# under.
LABEL_ALIAS = {
    "HCWC": ("WC", "HC-WC"),
    "HC-WC": ("WC", "HC-WC"),
    "Print/Kopi": ("Print/kopi", None),
    "Print": ("Print/kopi", None),
    "Kopi": ("Print/kopi", None),
}

# Codes sit right below their label, so weight vertical distance heavier.
MATCH_RADIUS = 60

# Rooms the drawings leave ambiguous, keyed by floor and position. Without these the
# nearest-code match reaches past the room's own walls and lands on a neighbour, and
# every rebuild would quietly undo the correction.
FIXUPS = {
    # The pod has no number of its own; N 302 belongs to the corridor next to it.
    ("3", 0.5177, 0.284): {"code": None},
    # 406 is the anteroom in front of the toilets, not this meeting room.
    ("4", 0.6538, 0.405): {"code": None},
}


def lines(page):
    """Yield (text, centre x, centre y) for every text line in the drawing area.

    A block that holds more than one line is also yielded joined, so a label the
    drawing wraps ("Podcast" / "webrom") is seen as the one name it reads as.
    """
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        found = [
            ("".join(span["text"] for span in line["spans"]).strip(), line["bbox"])
            for line in block["lines"]
        ]
        if len(found) > 1:
            found.append((" ".join(text for text, _ in found), block["bbox"]))
        for text, (x0, y0, x1, y1) in found:
            x, y = (x0 + x1) / 2, (y0 + y1) / 2
            if x < 190 and y < 330:
                continue  # INNHOLD legend: "Multirom: 7" is a tally, not a room
            if y > 700:
                continue  # title block
            yield text, x, y


def rooms_on(page, floor):
    labels, codes = [], []
    for text, x, y in lines(page):
        if ROOM_TYPE.match(text):
            labels.append((*LABEL_ALIAS.get(text, (text, None)), x, y))
        elif ROOM_CODE.match(text):
            codes.append([text, x, y, False])

    out = []
    for kind, name, x, y in labels:
        nearest, best = None, math.inf
        for code in codes:
            if code[3]:
                continue
            dist = math.hypot(code[1] - x, (code[2] - y) * 1.4)
            if dist < best:
                nearest, best = code, dist
        if nearest and best < MATCH_RADIUS:
            nearest[3] = True
        else:
            nearest = None
        room = {
            "type": kind,
            "code": " ".join(nearest[0].split()) if nearest else None,
            "x": round((x - CLIP.x0) / CLIP.width, 4),
            "y": round((y - CLIP.y0) / CLIP.height, 4),
        }
        if name:
            room["name"] = name
        room.update(FIXUPS.get((floor, room["x"], room["y"]), {}))
        out.append(room)
    out.sort(key=lambda r: (r["type"], r["code"] or "zzz"))
    return out


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    floors = {}
    for path in sorted(glob.glob(os.path.join(here, "*.pdf"))):
        name = os.path.basename(path)
        floor = name[0]
        page = pymupdf.open(path)[0]

        # The sheet's own "Plan N" caption sits above the building, inside the frame
        # we render. Paint it out in paper white: the app inverts the whole image in
        # dark mode, so a white patch stays invisible in both themes.
        caption = page.search_for(f"Plan {floor}")
        if not caption:
            print(f"floor {floor}: no 'Plan {floor}' caption found")
        for rect in caption:
            page.draw_rect(rect, color=None, fill=(1, 1, 1))

        pixmap = page.get_pixmap(dpi=DPI, clip=CLIP)
        pixmap.save(os.path.join(here, f"plan-{floor}.png"))

        rooms = floors[floor] = rooms_on(page, floor)
        unnamed = [r["type"] for r in rooms if not r["code"]]
        print(
            f"floor {floor}: {len(rooms)} rooms, {pixmap.width}x{pixmap.height} px"
            + (f", {len(unnamed)} without a code: {', '.join(unnamed)}" if unnamed else "")
        )

    with open(os.path.join(here, "rooms.json"), "w", encoding="utf-8") as f:
        json.dump(floors, f, ensure_ascii=False, indent=1)
    print(f"total: {sum(len(r) for r in floors.values())} rooms across {len(floors)} floors")


if __name__ == "__main__":
    main()
