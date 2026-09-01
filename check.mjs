// Smoke test for index.html: renders the page in jsdom against the real
// rooms.json and exercises floor switching, search, filters, deep links, zoom.
//
//   npm i jsdom && node check.mjs
//
// Run it after changing index.html or the extraction rules in build.py.

import { JSDOM } from "jsdom";
import fs from "node:fs";
import assert from "node:assert/strict";

const root = import.meta.dirname;
const rooms = JSON.parse(fs.readFileSync(`${root}/rooms.json`, "utf8"));
const count = (floor, type) =>
  rooms[floor].filter(r => !type || r.type === type).length;

const dom = new JSDOM(fs.readFileSync(`${root}/index.html`, "utf8"), {
  runScripts: "outside-only",   // run the page script ourselves, once fetch is stubbed
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const w = dom.window;
const d = w.document;

// jsdom has no fetch, no matchMedia and no layout, so stub them, then run the
// page's own scripts. matchMedia reporting no dark preference means the theme
// checks below start from "follow the system, which says light".
w.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(`${root}/${url}`, "utf8")) });
w.matchMedia = (media) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} });
w.Element.prototype.scrollIntoView = () => {};
for (const script of d.querySelectorAll("script")) w.eval(script.textContent);
await new Promise(r => setTimeout(r, 50));

const markers = () => d.querySelectorAll(".marker");
const listed = () => d.querySelectorAll(".rooms button");
const current = () => d.querySelector('.marker[aria-current="true"]');
const plan = () => d.getElementById("plan");
const search = (text) => {
  d.querySelector("#q").value = text;
  d.querySelector("#q").oninput();
  return [...listed()];
};
const floorButton = (f) => [...d.querySelectorAll(".floors button")].find(b => b.textContent === f + ".");
const typeFilter = (t) => [...d.querySelectorAll(".type")].find(b => b.textContent.startsWith(t));

// Opens on floor 3 with every room both mapped and listed.
assert.equal(markers().length, count("3"));
assert.equal(listed().length, count("3"));
assert.match(d.querySelector("#planimg").src, /plan-3\.png$/);

// Floor switching swaps plan and markers together.
floorButton("7").click();
assert.equal(markers().length, count("7"));
assert.match(d.querySelector("#planimg").src, /plan-7\.png$/);

// A search on a floor with no hits moves the plan to the floor that has them.
search("857");
assert.match(d.querySelector("#planimg").src, /plan-8\.png$/);

// The numberless coffee machine wears a cup instead of the dot every other
// unnumbered room gets.
assert.deepEqual(
  [...markers()].filter(m => m.dataset.type === "Kaffemaskiner").map(m => m.textContent),
  ["☕"],
);

// Search reaches other floors, and picking a hit travels there.
const hits = search("372");
assert.equal(hits.length, 1);
assert.match(hits[0].textContent, /N 372/);
assert.match(hits[0].querySelector(".floor").textContent, /^3\./);
hits[0].click();
assert.equal(w.location.hash, "#3/N372");
assert.equal(current().textContent, "N 372");

// The group headings are the type filters: clicking one hides that type's markers
// and its rows, and the heading stays behind as the way back.
search("");
typeFilter("Multirom").click();
assert.equal(markers().length, count("3") - count("3", "Multirom"));
assert.equal(listed().length, count("3") - count("3", "Multirom"));
assert.equal(typeFilter("Multirom").getAttribute("aria-pressed"), "false");
typeFilter("Multirom").click();
assert.equal(markers().length, count("3"));
assert.equal(listed().length, count("3"));

// Hovering the panel points at the plan: a type's heading lights every pill of that
// type, a room row lights just its own, and leaving the panel clears it.
const hot = () => [...markers()].filter(m => m.classList.contains("hot"));
const hover = (element, type = "mouseover") =>
  element.dispatchEvent(new w.MouseEvent(type, { bubbles: true }));

const pointing = () => plan().classList.contains("pointing");
hover(typeFilter("Møterom"));
assert.equal(hot().length, count("3", "Møterom"));
assert.ok(pointing(), "the pills that are not lit fade back");
hover(typeFilter("Møterom"), "mouseout");
assert.equal(hot().length, 0);
assert.equal(pointing(), false);

const row = [...listed()].find(b => b.textContent.includes("N 372"));
hover(row);
assert.deepEqual(hot().map(m => m.textContent), ["N 372"]);
assert.ok(pointing());
hover(row, "mouseout");
assert.equal(hot().length, 0);

// A row for a room on another floor lights nothing, so nothing may fade either. The
// search stays on floor 3 because it has hits of its own here.
const elsewhere = search("møterom").find(b =>
  !b.querySelector(".floor").textContent.startsWith("3.") && /\d/.test(b.querySelector(".code").textContent));
hover(elsewhere);
assert.equal(hot().length, 0);
assert.equal(pointing(), false);
hover(elsewhere, "mouseout");
search("");

// Deep link selects a room on load.
w.location.hash = "#8/N857";
w.onhashchange();
assert.match(d.querySelector("#planimg").src, /plan-8\.png$/);
assert.equal(current().textContent, "N 857");

// Zoom drives the plan width. Pills keep their room number at every zoom.
d.getElementById("fit").click();
assert.equal(plan().style.width, "100%");
assert.equal(current().textContent, "N 857");
d.getElementById("in").click();
d.getElementById("in").click();
assert.equal(plan().style.width, "200%");

// Trackpad pinch (ctrl + wheel) zooms and stays inside the slider's range.
const viewport = d.getElementById("viewport");
const zoomValue = () => Number(d.getElementById("zoom").value);
const wheel = (deltaY, ctrlKey = true) => viewport.dispatchEvent(
  new w.WheelEvent("wheel", { deltaY, ctrlKey, bubbles: true, cancelable: true }));

d.getElementById("fit").click();
wheel(-3);                                   // a trackpad pinch tick is tiny
assert.ok(zoomValue() > 100, "small pinch ticks still move the zoom");
for (let i = 0; i < 400; i++) wheel(-3);
assert.equal(zoomValue(), 450);
for (let i = 0; i < 800; i++) wheel(3);
assert.equal(zoomValue(), 100);
assert.ok(wheel(0) === false, "pinch is preventDefault-ed, so the page doesn't zoom too");

// A plain two-finger scroll pans instead, and is ours too: leaving it to native
// scrolling would fight the zoom anchoring over the same scroll offset.
const zoomBeforePan = zoomValue();
assert.ok(wheel(120, false) === false, "pan is preventDefault-ed as well");
assert.equal(zoomValue(), zoomBeforePan, "panning must not change the zoom");

// Mouse panning runs on the same pointer stream as touch, and a native image drag
// would cancel it the moment the mouse moves, so the plan must not be draggable.
assert.equal(d.querySelector("#planimg").draggable, false);

// Two fingers spreading apart doubles the zoom.
const pointer = (type, id, x, target = w) =>
  target.dispatchEvent(new w.PointerEvent(type, { pointerId: id, clientX: x, clientY: 100, button: 0, bubbles: true }));
pointer("pointerdown", 1, 100, viewport);
pointer("pointerdown", 2, 200, viewport);
pointer("pointermove", 1, 100);   // establishes the baseline spread of 100px
pointer("pointermove", 1, 0);     // now 200px apart
assert.equal(zoomValue(), 200);

// A drag or pinch that ends on a marker must not select it.
pointer("pointerup", 1);
pointer("pointerup", 2);
const selected = () => current()?.textContent ?? null;
const wasSelected = selected();
[...markers()].find(m => m.textContent !== wasSelected).click();
assert.equal(selected(), wasSelected, "the gesture's own click is swallowed");

// Only that click, though. A later one — keyboard Enter on a marker, which sends
// no pointer events at all — has to get through.
pointer("pointerdown", 1, 100, viewport);
pointer("pointermove", 1, 300);
pointer("pointerup", 1);
await new Promise(r => setTimeout(r, 350));
const wanted = [...markers()].find(m => m.textContent !== selected());
const wantedCode = wanted.textContent;
wanted.click();
assert.equal(selected(), wantedCode, "a click well after a drag selects");

// The theme button cycles system -> light -> dark -> system and remembers the pick.
const themeButton = d.getElementById("theme");
const theme = () => d.documentElement.dataset.theme;
assert.equal(theme(), "light", "jsdom reports no dark preference, so we follow it to light");
assert.equal(w.localStorage.theme, undefined, "following the system stores nothing");
themeButton.click();
assert.equal(theme(), "light");
assert.equal(w.localStorage.theme, "light");
themeButton.click();
assert.equal(theme(), "dark");
assert.equal(w.localStorage.theme, "dark");
assert.match(themeButton.getAttribute("aria-label"), /mørkt/);
themeButton.click();
assert.equal(theme(), "light", "back to following the system");
assert.equal(w.localStorage.theme, undefined);

// The panel collapses out of the layout and back, and its toggle — which floats on
// the plan, not in the panel — is the way back.
const collapse = d.getElementById("collapse");
const panel = d.getElementById("panel");
assert.equal(panel.hidden, false);
collapse.click();
assert.equal(panel.hidden, true);
assert.equal(collapse.getAttribute("aria-expanded"), "false");
assert.match(collapse.getAttribute("aria-label"), /Vis/);
collapse.click();
assert.equal(panel.hidden, false);
assert.equal(collapse.getAttribute("aria-expanded"), "true");
assert.equal(d.querySelector("h1").closest("aside"), null, "the heading outlives a collapse");

// On a phone the panel is a sheet: its grip toggles on a tap, and a drag snaps by
// direction — up opens it, down shuts it, a short one leaves it as it was. (Only the
// stylesheet knows this is a phone; the behaviour is the same wherever it runs.)
const grip = d.getElementById("grip");
const open = () => panel.classList.contains("open");
const drag = (dy) => {
  pointer("pointerdown", 9, 0, grip);          // the helper starts every one at y 100
  for (const type of ["pointermove", "pointerup"]) {
    w.dispatchEvent(new w.PointerEvent(type, { pointerId: 9, clientY: 100 - dy, bubbles: true }));
  }
};

assert.equal(open(), false, "the sheet starts as the bar");
grip.click();
assert.ok(open());
assert.equal(grip.getAttribute("aria-expanded"), "true");
grip.click();
assert.equal(open(), false);

drag(60);
assert.ok(open(), "dragged up");
assert.equal(panel.style.height, "", "the snap hands the height back to the stylesheet");
drag(-60);
assert.equal(open(), false, "dragged down");
drag(10);
assert.equal(open(), false, "too short to snap the other way");

// Each end of a walk opens a listbox of every room. It is not a <select>, so the rest
// of this section is what a <select> would have done for free: opening, the arrows,
// type-ahead, committing — and the one thing it would not, lighting the room under the
// pointer on the plan.
const from = d.getElementById("from");
const to = d.getElementById("to");
const clear = d.getElementById("clear");
const line = () => d.querySelector("#route-line .line")?.getAttribute("d") ?? null;
const points = () => line().slice(1).split(" L").map(p => p.split(" ").map(Number));
const note = () => d.getElementById("route-note").textContent;

// jsdom has no top layer, so the popover is stubbed down to a hidden flag. What is
// under test is the listbox behaviour, not the browser's own popover.
for (const box of d.querySelectorAll(".picker")) {
  let shown = false;
  const toggle = (newState) => box.dispatchEvent(Object.assign(new w.Event("toggle"), { newState }));
  box.showPopover = () => { shown = true; toggle("open"); };
  box.hidePopover = () => { shown = false; toggle("closed"); };
  box.matches = (selector) => selector === ":popover-open"
    ? shown
    : w.Element.prototype.matches.call(box, selector);
}
const listFor = (end) => d.getElementById(end.id + "-list");
const optionFor = (end, ref) => listFor(end).querySelector(`[data-ref="${ref}"]`);
const active = (end) => listFor(end).querySelector(".picker-option.active");
const key = (end, k) => end.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const openList = (end) => { end.dispatchEvent(new w.PointerEvent("pointerdown", { bubbles: true })); end.click(); };
const travel = (a, b) => {
  openList(from);
  optionFor(from, a).click();
  openList(to);
  optionFor(to, b).click();
};

const total = Object.values(rooms).flat().length;
assert.equal(listFor(from).querySelectorAll('[role="option"]').length, total, "every room");
assert.equal(listFor(from).querySelectorAll('[role="group"]').length, 6, "grouped by floor");
assert.equal(line(), null, "nothing to draw until both ends are picked");
assert.equal(clear.hidden, true, "nothing to clear either");
assert.match(from.textContent, /Velg rom/);

// Opening lands on the first room, and says on the button which row that is.
floorButton("3").click();
openList(from);
assert.equal(from.getAttribute("aria-expanded"), "true");
assert.equal(active(from).dataset.ref, "3/304", "the first room in the list");
assert.equal(from.getAttribute("aria-activedescendant"), active(from).id);

// The arrows walk it, Home and End jump, and every step lights that room on the plan —
// the reason this is a listbox and not a <select>.
key(from, "ArrowDown");
assert.equal(active(from).dataset.ref, "3/361");
assert.deepEqual(hot().map(m => m.textContent), ["361"], "the arrows point at the plan");
assert.ok(pointing());
key(from, "ArrowUp");
assert.equal(active(from).dataset.ref, "3/304");
key(from, "End");
assert.equal(active(from).dataset.ref, "8/Kaffemaskiner-0.3014", "the last room of the last floor");
key(from, "Home");
assert.equal(active(from).dataset.ref, "3/304");

// Type-ahead matches anywhere in the row, so a room number finds its room.
for (const c of "372") key(from, c);
assert.equal(active(from).dataset.ref, "3/N372");
assert.deepEqual(hot().map(m => m.textContent), ["N 372"]);

// The pointer picks the same rows the arrows do.
hover(optionFor(from, "3/N373"));
assert.equal(active(from).dataset.ref, "3/N373");
assert.deepEqual(hot().map(m => m.textContent), ["N 373"]);

// Escape belongs to the popover: the field closes and the plan stops pointing.
listFor(from).hidePopover();
assert.equal(from.getAttribute("aria-expanded"), "false");
assert.equal(hot().length, 0);
assert.equal(pointing(), false);
assert.match(from.textContent, /Velg rom/, "closing without committing picks nothing");

// Enter commits the active row. One end alone already rings its room and travels to
// its floor, without waiting for the other.
openList(from);
for (const c of "570") key(from, c);
key(from, "Enter");
assert.equal(from.getAttribute("aria-expanded"), "false");
assert.match(from.textContent, /N 570 · 5\. et\./);
assert.match(d.querySelector("#planimg").src, /plan-5\.png$/);
assert.deepEqual([...markers()].filter(m => m.classList.contains("via")).map(m => m.textContent),
  ["N 570"]);
assert.equal(line(), null, "one end is not a walk");
assert.equal(clear.hidden, false);

// Reopening starts on the room already picked, not back at the top.
openList(from);
assert.equal(active(from).dataset.ref, "5/N570");
assert.equal(active(from).getAttribute("aria-selected"), "true");
listFor(from).hidePopover();
clear.click();
assert.match(from.textContent, /Velg rom/);

// Both ends on one floor: one path, and the map goes to that floor.
travel("3/N372", "3/S351");
assert.match(d.querySelector("#planimg").src, /plan-3\.png$/);
assert.match(note(), /N 372.*S 351.*3\. etasje/);
assert.ok(d.getElementById("via").disabled, "one floor, so there is no way up to pick");

// It starts at one room and ends at the other, and every leg between runs along a
// corridor — so each is either horizontal or vertical, never a line through walls.
const path = points();
const near = (a, b) => Math.abs(a - b) < 1;
const room = (floor, code) => rooms[floor].find(r => r.code === code);
const onPlan = (r) => [r.x * 2659, r.y * 1820];
assert.ok(near(path.at(0)[0], onPlan(room("3", "N 372"))[0]));
assert.ok(near(path.at(-1)[1], onPlan(room("3", "S 351"))[1]));
for (let i = 1; i < path.length; i++) {
  assert.ok(near(path[i][0], path[i - 1][0]) || near(path[i][1], path[i - 1][1]),
    `leg ${i} runs diagonally, so it is not following a corridor`);
}
// North wing to south wing has to pass the lifts — the only way between them.
assert.ok(path.some(([x, y]) => near(x, 0.372 * 2659) && near(y, 0.542 * 1820)));

// Two floors: two walks with a ride between them, and only the one on the floor being
// shown is drawn. The floors in between have nothing to draw and say so.
travel("3/N372", "7/S751");
assert.match(d.querySelector("#planimg").src, /plan-3\.png$/, "it opens where the walk starts");
assert.match(note(), /heisen/);
const leaving = points();
assert.ok(near(leaving.at(-1)[0], 0.327 * 2659), "the first leg ends at the lift");
assert.equal(d.querySelectorAll("#route-line circle").length, 1, "the lift is marked");

floorButton("7").click();
assert.ok(near(points().at(0)[0], 0.327 * 2659), "the second leg starts at the lift");
floorButton("5").click();
assert.equal(line(), null, "a floor the walk only passes has nothing to draw");
assert.match(note(), /Velg 3\. eller 7\. etasje/);

// The stair is the other way between floors, and the walk goes there instead.
floorButton("3").click();
const via = d.getElementById("via");
via.value = "trapp";
via.onchange();
assert.match(note(), /trappen/);
assert.ok(near(points().at(-1)[1], 0.677 * 1820), "the first leg ends at the stair");
via.value = "heis";
via.onchange();
assert.ok(near(points().at(-1)[1], 0.542 * 1820), "and back at the lift");

// The two ends wear a ring of their own, which a passing mouse must not clear.
const ends = () => [...markers()].filter(m => m.classList.contains("via")).map(m => m.textContent);
assert.deepEqual(ends(), ["N 372"]);
hover(typeFilter("Møterom"));
hover(typeFilter("Møterom"), "mouseout");
assert.deepEqual(ends(), ["N 372"], "hovering the panel leaves the route alone");

// The walk is in the link, so it can be pasted to someone else. The floor and the
// room picked on it stay where they were, ahead of the query.
assert.equal(w.location.hash, "#3?fra=3/N372&til=7/S751");
via.value = "trapp";
via.onchange();
assert.equal(w.location.hash, "#3?fra=3/N372&til=7/S751&via=trapp");
[...markers()].find(m => m.textContent === "N 373").click();
assert.equal(w.location.hash, "#3/N373?fra=3/N372&til=7/S751&via=trapp");

// And reading it back restores the walk, the way up and the fields that show them.
w.location.hash = "#7/S751?fra=4/S422&til=6/N672&via=trapp";
w.onhashchange();
assert.match(from.textContent, /S 422 · 4\. et\./);
assert.match(to.textContent, /N 672 · 6\. et\./);
assert.equal(via.value, "trapp");
assert.match(note(), /S 422.*trappen.*N 672/);
assert.equal(line(), null, "floor 7 is neither end of that walk");

// A link from before the route fields existed still means what it did.
w.location.hash = "#8/N857";
w.onhashchange();
assert.equal(current().textContent, "N 857");
assert.match(from.textContent, /Velg rom/, "no walk in the link, no walk on the map");
assert.equal(line(), null);

// Clearing puts both ends back and takes the walk out of the link.
travel("3/N372", "7/S751");
clear.click();
assert.equal(line(), null);
assert.equal(note(), "");
assert.match(to.textContent, /Velg rom/);
assert.equal(w.location.hash.includes("fra="), false);

// PWA shell: the manifest parses, every file it and the service worker name is
// really there, and no path is absolute — the site is served from a subpath.
const manifest = JSON.parse(fs.readFileSync(
  `${root}/${d.querySelector("link[rel=manifest]").getAttribute("href")}`, "utf8"));
const swSource = fs.readFileSync(`${root}/sw.js`, "utf8");
const precached = JSON.parse(swSource.match(/const SHELL = (\[.*?\])/s)[1].replaceAll("'", '"'));

const referenced = [
  ...manifest.icons.map(i => i.src),
  ...precached.map(f => (f === "./" ? "index.html" : f)),
  d.querySelector('link[rel="apple-touch-icon"]').getAttribute("href"),
  "sw.js",
];
for (const path of referenced) {
  assert.ok(!path.startsWith("/"), `${path} must be relative to work from a subpath`);
  assert.ok(fs.existsSync(`${root}/${path}`), `${path} is referenced but missing`);
}
assert.equal(manifest.start_url, ".");
assert.equal(manifest.scope, ".");
assert.ok(manifest.icons.some(i => i.purpose === "maskable"), "Android crops the icon");
assert.ok(precached.includes("rooms.json"), "the map is empty offline without the room data");

console.log(`all checks passed (${Object.values(rooms).flat().length} rooms)`);
