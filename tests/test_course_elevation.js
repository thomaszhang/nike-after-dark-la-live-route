"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { elevationAtDistance, distanceFromPointer } = require("../course-elevation.js");

test("interpolates elevation between neighboring course samples", () => {
  const samples = [[0, 10], [100, 30], [250, 20]];
  assert.equal(elevationAtDistance(samples, 50), 20);
  assert.equal(elevationAtDistance(samples, 175), 25);
});

test("clamps elevation lookup to the sampled course", () => {
  const samples = [[0, 10], [100, 30]];
  assert.equal(elevationAtDistance(samples, -20), 10);
  assert.equal(elevationAtDistance(samples, 140), 30);
});

test("maps a pointer across the profile to course distance", () => {
  assert.equal(distanceFromPointer(100, 100, 300, 1000), 0);
  assert.equal(distanceFromPointer(250, 100, 300, 1000), 500);
  assert.equal(distanceFromPointer(400, 100, 300, 1000), 1000);
  assert.equal(distanceFromPointer(20, 100, 300, 1000), 0);
  assert.equal(distanceFromPointer(500, 100, 300, 1000), 1000);
});
