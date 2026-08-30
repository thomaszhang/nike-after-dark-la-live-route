"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

test("far-off-course navigation hides the card without lowering safety thresholds", () => {
  assert.match(app, /REJOIN_GUIDANCE_MIN_METERS = 30/);
  assert.match(app, /MAX_REJOIN_GUIDANCE_METERS = 100/);
  assert.match(app, /currentNearest\.distance > MAX_REJOIN_GUIDANCE_METERS/);
  assert.match(app, /els\.direction\.hidden = Boolean\(target && target\.paused\)/);
  assert.doesNotMatch(app, /label: "Navigation paused"/);
});

test("normal and safe-rejoin navigation still render after the card is restored", () => {
  assert.match(app, /if \(target && target\.paused\) return;/);
  assert.match(app, /if \(target\.rejoin\)/);
  assert.match(app, /showDirection\(\{ arrow: relativeArrow\(delta\)/);
  assert.match(app, /showDirection\(\{ arrow: maneuverArrow\(next\.delta\)/);
});
