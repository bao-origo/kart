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
const typeFilter = (t) => [...d.querySelectorAll(".filters label")].find(l => l.textContent.includes(t)).querySelector("input");
const toggle = (input, on) => { input.checked = on; input.onchange(); };

// Opens on floor 3 with every room both mapped and listed.
assert.equal(markers().length, count("3"));
assert.equal(listed().length, count("3"));
assert.match(d.querySelector("#planimg").src, /plan-3\.png$/);

// Floor switching swaps plan and markers together.
floorButton("7").click();
assert.equal(markers().length, count("7"));
assert.match(d.querySelector("#planimg").src, /plan-7\.png$/);

// Search reaches other floors, and picking a hit travels there.
const hits = search("372");
assert.equal(hits.length, 1);
assert.match(hits[0].textContent, /N 372/);
assert.match(hits[0].querySelector(".floor").textContent, /^3\./);
hits[0].click();
assert.equal(w.location.hash, "#3/N372");
assert.equal(current().textContent, "N372");

// Type filters hide markers.
search("");
toggle(typeFilter("Multirom"), false);
assert.equal(markers().length, count("3") - count("3", "Multirom"));
toggle(typeFilter("Multirom"), true);
assert.equal(markers().length, count("3"));

// Deep link selects a room on load.
w.location.hash = "#8/N857";
w.onhashchange();
assert.match(d.querySelector("#planimg").src, /plan-8\.png$/);
assert.equal(current().textContent, "N857");

// Zoom drives the plan width. Pills keep their room number at every zoom.
d.getElementById("fit").click();
assert.equal(plan().style.width, "100%");
assert.equal(current().textContent, "N857");
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

console.log(`all checks passed (${Object.values(rooms).flat().length} rooms)`);
