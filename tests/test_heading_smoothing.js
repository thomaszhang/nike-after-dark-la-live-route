"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAngleSmoother, shortestAngleDelta } = require("../heading-smoothing.js");

test("ignores small compass jitter around a stable heading", () => {
  const smoother = createAngleSmoother({ initialAngle: -90, deadZoneDegrees: 1.5 });

  for (const noisyTarget of [-89.4, -90.7, -89.1, -90.5, -89.8]) {
    smoother.setTarget(noisyTarget);
    smoother.step(50);
  }

  assert.equal(smoother.getTarget(), -90);
  assert.equal(smoother.getAngle(), -90);
});

test("follows a real turn gradually and converges", () => {
  const smoother = createAngleSmoother({ initialAngle: -20, timeConstantMs: 220 });

  smoother.setTarget(-80);
  const firstFrame = smoother.step(16);
  assert.ok(firstFrame < -20 && firstFrame > -30, `first frame was ${firstFrame}`);

  for (let elapsed = 0; elapsed < 1500; elapsed += 16) smoother.step(16);
  assert.ok(Math.abs(shortestAngleDelta(smoother.getAngle(), -80)) < 0.2);
});

test("crosses north using the shortest angle", () => {
  const smoother = createAngleSmoother({ initialAngle: -359, deadZoneDegrees: 0 });

  smoother.setTarget(-1);
  assert.equal(shortestAngleDelta(-359, smoother.getTarget()), -2);
  const firstFrame = smoother.step(16);
  assert.ok(firstFrame < -359, `expected a short negative turn, got ${firstFrame}`);
});

test("smoothing is consistent across frame rates", () => {
  const run = frameMs => {
    const smoother = createAngleSmoother({ initialAngle: 0, timeConstantMs: 220 });
    smoother.setTarget(-90);
    for (let elapsed = 0; elapsed < 480; elapsed += frameMs) smoother.step(frameMs);
    return smoother.getAngle();
  };

  assert.ok(Math.abs(run(16) - run(48)) < 0.6);
});
