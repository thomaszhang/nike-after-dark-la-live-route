(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CourseElevation = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const samples = [[0.0,8],[214.4,8],[428.7,15],[643.1,22],[857.5,27],[1071.9,25],[1286.2,20],[1500.6,3],[1715.0,10],[1929.3,13],[2143.7,15],[2358.1,19],[2572.4,21],[2786.8,4],[3001.2,18],[3215.6,14],[3429.9,12],[3644.3,10],[3858.7,4],[4073.0,6],[4287.4,9],[4501.8,16],[4716.2,21],[4930.5,30],[5144.9,18],[5359.3,65],[5573.6,51],[5788.0,47],[6002.4,16],[6216.8,18],[6431.1,14],[6645.5,16],[6859.9,16],[7074.2,18],[7288.6,19],[7503.0,20],[7717.3,21],[7931.7,19],[8146.1,21],[8360.5,24],[8574.8,25],[8789.2,26],[9003.6,26],[9217.9,25],[9432.3,22],[9646.7,21],[9861.1,19],[10075.4,19],[10289.8,19],[10504.2,22],[10718.5,18],[10932.9,6],[11147.3,14],[11361.6,10],[11576.0,12],[11790.4,14],[12004.8,21],[12219.1,21],[12433.5,21],[12647.9,19],[12862.2,21],[13076.6,23],[13291.0,20],[13505.4,25],[13719.7,25],[13934.1,22],[14148.5,19],[14362.8,11],[14577.2,6],[14791.6,11],[15005.9,14],[15220.3,21],[15434.7,24],[15649.1,14],[15863.4,12],[16077.8,6],[16292.2,6],[16506.5,6],[16720.9,6],[16935.3,6],[17149.7,5],[17364.0,9],[17578.4,6],[17792.8,7],[18007.1,7],[18221.5,7],[18435.9,7],[18650.3,7],[18864.6,7],[19079.0,5],[19293.4,4],[19507.7,5],[19722.1,5],[19936.5,6],[20150.8,4],[20365.2,5],[20579.6,4],[20794.0,6],[21008.3,6],[21222.7,5],[21437.1,4]];
  const source = {
    provider: "Open-Meteo Elevation API",
    dataset: "Copernicus DEM 2021 GLO-90",
    resolutionMeters: 90,
    sampledOn: "2026-08-30",
    url: "https://open-meteo.com/en/docs/elevation-api",
    doi: "https://doi.org/10.5270/ESA-c5d3d65",
  };

  function elevationAtDistance(profile, meters) {
    if (!profile.length) return null;
    const target = Math.max(profile[0][0], Math.min(profile.at(-1)[0], Number(meters) || 0));
    let high = profile.findIndex(sample => sample[0] >= target);
    if (high <= 0) return profile[0][1];
    const low = high - 1;
    const span = profile[high][0] - profile[low][0];
    const ratio = span ? (target - profile[low][0]) / span : 0;
    return profile[low][1] + ratio * (profile[high][1] - profile[low][1]);
  }

  function distanceFromPointer(clientX, left, width, totalMeters) {
    const ratio = width > 0 ? Math.max(0, Math.min(1, (clientX - left) / width)) : 0;
    return ratio * totalMeters;
  }

  return { samples, source, elevationAtDistance, distanceFromPointer };
});
