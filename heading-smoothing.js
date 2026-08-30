(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HeadingSmoothing = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function shortestAngleDelta(from, to) {
    return ((to - from + 540) % 360) - 180;
  }

  function createAngleSmoother({
    initialAngle = 0,
    deadZoneDegrees = 1.5,
    timeConstantMs = 220,
    snapDegrees = 0.05,
  } = {}) {
    let angle = Number(initialAngle);
    let target = angle;

    return {
      setTarget(nextAngle) {
        const delta = shortestAngleDelta(target, Number(nextAngle));
        if (Math.abs(delta) < deadZoneDegrees) return target;
        target += delta;
        return target;
      },
      step(elapsedMs) {
        const delta = shortestAngleDelta(angle, target);
        if (Math.abs(delta) <= snapDegrees) {
          angle = target;
          return angle;
        }
        const alpha = 1 - Math.exp(-Math.max(0, Number(elapsedMs)) / timeConstantMs);
        angle += delta * alpha;
        return angle;
      },
      getAngle() { return angle; },
      getTarget() { return target; },
      isSettled() { return Math.abs(shortestAngleDelta(angle, target)) <= snapDegrees; },
      reset(nextAngle = 0) {
        angle = Number(nextAngle);
        target = angle;
        return angle;
      },
    };
  }

  return { createAngleSmoother, shortestAngleDelta };
});
