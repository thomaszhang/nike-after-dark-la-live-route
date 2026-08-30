(() => {
  "use strict";
  const route = window.NIKE_ROUTE;
  const elevation = window.CourseElevation;
  const { createAngleSmoother } = window.HeadingSmoothing;
  const points = route.points.map(([lon, lat]) => ({ lon, lat }));
  const R = 6371008.8;
  const toRad = value => value * Math.PI / 180;
  const segmentMeters = (a, b) => {
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + segmentMeters(points[i - 1], points[i]));
  const totalMeters = cumulative.at(-1);
  const REJOIN_GUIDANCE_MIN_METERS = 30;
  const MAX_REJOIN_GUIDANCE_METERS = 100;
  const FINISH_REACHED_METERS = 15;
  const GUIDANCE_LOOKAHEAD_METERS = 50;

  function courseCandidates(lat, lon) {
    const cos = Math.cos(toRad(lat));
    const candidates = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const ax = toRad(a.lon - lon) * R * cos, ay = toRad(a.lat - lat) * R;
      const bx = toRad(b.lon - lon) * R * cos, by = toRad(b.lat - lat) * R;
      const dx = bx - ax, dy = by - ay;
      const denom = dx * dx + dy * dy;
      const t = denom ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denom)) : 0;
      const x = ax + t * dx, y = ay + t * dy, distance = Math.hypot(x, y);
      candidates.push({
        distance,
        along: cumulative[i - 1] + t * (cumulative[i] - cumulative[i - 1]),
        lat: a.lat + t * (b.lat - a.lat),
        lon: a.lon + t * (b.lon - a.lon),
        segment: i - 1,
      });
    }
    return candidates.sort((a, b) => a.distance - b.distance);
  }
  function nearestOnCourse(lat, lon) {
    return courseCandidates(lat, lon)[0];
  }

  const normalizeHeading = value => ((value % 360) + 360) % 360;
  const signedHeading = value => ((value + 540) % 360) - 180;
  function pointAtCourse(meters) {
    const target = Math.max(0, Math.min(totalMeters, meters));
    let high = cumulative.findIndex(value => value >= target);
    if (high <= 0) return { ...points[0], along: 0 };
    const low = high - 1;
    const span = cumulative[high] - cumulative[low];
    const ratio = span ? (target - cumulative[low]) / span : 0;
    return {
      lat: points[low].lat + ratio * (points[high].lat - points[low].lat),
      lon: points[low].lon + ratio * (points[high].lon - points[low].lon),
      along: target,
    };
  }
  function bearingBetween(from, to) {
    const lat1 = toRad(from.lat), lat2 = toRad(to.lat), dLon = toRad(to.lon - from.lon);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return normalizeHeading(Math.atan2(y, x) * 180 / Math.PI);
  }
  function courseBearing(along) {
    return bearingBetween(pointAtCourse(along - 18), pointAtCourse(along + 18));
  }
  function selectCoursePosition(lat, lon, { previousAlong = null, travelHeading = null, speed = 0, accuracy = 10, elapsedSeconds = 1 } = {}) {
    const candidates = courseCandidates(lat, lon);
    const close = candidates.filter(candidate => candidate.distance <= candidates[0].distance + Math.max(12, Number(accuracy || 0)));
    let best = close[0], bestScore = Infinity;
    for (const candidate of close) {
      let score = candidate.distance;
      if (Number.isFinite(travelHeading) && Number(speed || 0) > .5) {
        const headingDifference = Math.abs(signedHeading(courseBearing(candidate.along) - travelHeading));
        score += headingDifference * .28;
        if (headingDifference > 90) score += 180;
      }
      if (Number.isFinite(previousAlong)) {
        const movement = candidate.along - previousAlong;
        const expectedRange = Math.max(65, Number(speed || 0) * Math.max(1, elapsedSeconds) * 3 + Number(accuracy || 0) * 2);
        if (movement < -25) score += 45 + Math.abs(movement) * .08;
        if (Math.abs(movement) > expectedRange) score += (Math.abs(movement) - expectedRange) * .08;
      }
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
    return best;
  }

  function buildManeuvers() {
    const detected = [];
    for (let along = 50; along < totalMeters - 50; along += 10) {
      const incoming = bearingBetween(pointAtCourse(along - 45), pointAtCourse(along - 12));
      const outgoing = bearingBetween(pointAtCourse(along + 12), pointAtCourse(along + 45));
      const delta = signedHeading(outgoing - incoming);
      if (Math.abs(delta) >= 40) detected.push({ along, delta });
    }
    const groups = [];
    for (const item of detected) {
      const group = groups.at(-1);
      if (group && item.along - group.at(-1).along <= 35) group.push(item);
      else groups.push([item]);
    }
    return groups.map(group => group.reduce((best, item) => Math.abs(item.delta) > Math.abs(best.delta) ? item : best));
  }
  const maneuvers = buildManeuvers();

  const map = L.map("map", { zoomControl: false, attributionControl: false, preferCanvas: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
  const appearance = window.matchMedia("(prefers-color-scheme: dark)");
  const tileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const applyAppearance = dark => document.body.classList.toggle("dark-appearance", dark);
  applyAppearance(appearance.matches);
  const RotationBufferedTileLayer = L.TileLayer.extend({
    _getTiledPixelBounds(center) {
      const bounds = L.TileLayer.prototype._getTiledPixelBounds.call(this, center);
      const size = bounds.getSize();
      const diagonal = Math.hypot(size.x, size.y);
      const expansion = L.point((diagonal - size.x) / 2, (diagonal - size.y) / 2);
      return L.bounds(bounds.min.subtract(expansion), bounds.max.add(expansion));
    },
  });
  const streetTiles = new RotationBufferedTileLayer(tileUrl, {
    subdomains: "abcd",
    maxZoom: 20,
    detectRetina: true,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 4,
  }).addTo(map);
  streetTiles.on("tileerror", event => {
    const tile = event.tile;
    const match = tile?.src?.match(/\/(\d+)\/(\d+)\/(\d+)(?:@2x)?\.png/);
    if (match && !tile.dataset.fallback) {
      tile.dataset.fallback = "1";
      tile.src = `https://tile.openstreetmap.org/${match[1]}/${match[2]}/${match[3]}.png`;
    }
  });
  const routeLatLngs = points.map(p => [p.lat, p.lon]);
  let currentFix = null;
  const routeBounds = L.latLngBounds(routeLatLngs);
  const routePassOffsetPixels = 5;
  const routePassLayer = L.layerGroup().addTo(map);
  const routeChevronLayer = L.layerGroup().addTo(map);
  const oppositeBearing = (first, second) => Math.abs(signedHeading(first - second)) > 120;
  map.fitBounds(routeBounds, { paddingTopLeft: [20, 170], paddingBottomRight: [20, 150] });

  function offsetRoutePoint(point, bearing, pixels = routePassOffsetPixels) {
    const screen = map.latLngToContainerPoint([point.lat, point.lon]);
    const radians = bearing * Math.PI / 180;
    return map.containerPointToLatLng([screen.x + Math.cos(radians) * pixels, screen.y + Math.sin(radians) * pixels]);
  }
  function displayedRoutePoint(along, zoom = map.getZoom()) {
    const point = pointAtCourse(along);
    const bearing = courseBearing(along);
    const projected = map.project([point.lat, point.lon], zoom);
    const radians = bearing * Math.PI / 180;
    return map.unproject([projected.x + Math.cos(radians) * routePassOffsetPixels, projected.y + Math.sin(radians) * routePassOffsetPixels], zoom);
  }
  function refreshRoutePasses() {
    routePassLayer.clearLayers();
    const separated = points.map((point, index) => {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      return offsetRoutePoint(point, bearingBetween(previous, next));
    });
    L.polyline(separated, { color: "#ffffff", weight: 6, opacity: .3, lineCap: "round", lineJoin: "round", interactive: false }).addTo(routePassLayer);
    L.polyline(separated, { color: "#e90000", weight: 4, opacity: .78, lineCap: "round", lineJoin: "round", interactive: false }).addTo(routePassLayer);
  }

  function refreshRouteChevrons() {
    routeChevronLayer.clearLayers();
    const latitude = map.getCenter().lat * Math.PI / 180;
    const metersPerPixel = 156543.03392 * Math.cos(latitude) / (2 ** map.getZoom());
    const spacing = Math.max(20, Math.min(900, metersPerPixel * 30));
    const tangentOffset = Math.max(5, Math.min(18, spacing * .2));
    const visibleBounds = map.getBounds().pad(.3);
    const candidates = [];
    for (let along = spacing / 2; along < totalMeters; along += spacing) {
      const point = pointAtCourse(along);
      if (!visibleBounds.contains([point.lat, point.lon])) continue;
      const previous = pointAtCourse(Math.max(0, along - tangentOffset));
      const next = pointAtCourse(Math.min(totalMeters, along + tangentOffset));
      const bearing = bearingBetween(previous, next);
      const shifted = offsetRoutePoint(point, bearing);
      candidates.push({ point: shifted, bearing, screen: map.latLngToContainerPoint(shifted) });
    }
    const clusters = [];
    candidates.forEach(candidate => {
      const cluster = clusters.find(item => item[0].screen.distanceTo(candidate.screen) < 15);
      if (cluster) cluster.push(candidate);
      else clusters.push([candidate]);
    });
    const reserved = currentFix ? [map.latLngToContainerPoint([currentFix.lat, currentFix.lon])] : [];
    const occupied = [];
    clusters.forEach(cluster => {
      cluster.forEach(candidate => {
        if (reserved.some(position => position.distanceTo(candidate.screen) < 18)) return;
        const blocks = occupied.some(accepted => accepted.screen.distanceTo(candidate.screen) < 20 && !oppositeBearing(accepted.bearing, candidate.bearing));
        if (blocks) return;
        occupied.push(candidate);
        const icon = L.divIcon({
          className: "route-inline-chevron-icon",
          html: `<span class="route-inline-chevron" style="transform:rotate(${candidate.bearing - 90}deg)"></span>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        });
        L.marker(candidate.point, { icon, interactive: false, keyboard: false, zIndexOffset: -1000 }).addTo(routeChevronLayer);
      });
    });
  }
  function refreshRoutePresentation() {
    refreshRoutePasses();
    refreshRouteChevrons();
  }
  map.on("zoomend moveend", refreshRoutePresentation);
  refreshRoutePresentation();

  const label = (text, className) => L.divIcon({ className, html: `<span class="map-label-inner">${text}</span>`, iconAnchor: [className === "course-label" ? 13 : 24, 13] });
  L.marker([route.start[1], route.start[0]], { icon: label("START", "start-finish"), zIndexOffset: 500 }).addTo(map).bindPopup("Start · King Harbor");
  L.marker([route.finish[1], route.finish[0]], { icon: label("FINISH", "start-finish"), zIndexOffset: 500 }).addTo(map).bindPopup("Finish · King Harbor");
  route.mileMarkers.forEach(m => L.marker([m.coordinates[1], m.coordinates[0]], { icon: label(String(m.mile), "course-label") }).addTo(map).bindTooltip(`Mile ${m.mile}`));
  const headingPane = document.createElement("div");
  headingPane.className = "leaflet-heading-pane";
  const mapPane = map.getPane("mapPane");
  mapPane.appendChild(headingPane);
  ["tilePane", "overlayPane", "shadowPane", "markerPane", "tooltipPane", "popupPane"].forEach(name => {
    const pane = map.getPane(name);
    if (pane) headingPane.appendChild(pane);
  });

  const elementIds = [
    "route-control", "center-control", "direction-toggle", "course-status", "distance", "remaining", "live-elevation", "location-accuracy",
    "direction", "turn-arrow", "direction-label", "direction-detail", "heading-source", "location-error", "help",
    "help-toggle", "help-body", "elevation-profile", "elevation-chart", "elevation-area", "elevation-line",
    "elevation-cursor", "elevation-progress",
  ];
  const els = Object.fromEntries(elementIds.map(id => [id, document.getElementById(id)]));
  let watchId = null;
  let userMarker = null;
  let accuracyCircle = null;
  let nearestMarker = null;
  let following = true;
  let wakeLock = null;
  let navigationMode = true;
  let manualMapRotation = null;
  let fullRouteMode = false;
  let orientationListening = false;
  let deviceHeading = null;
  let compassValue = null;
  let mapRotation = 0;
  let headingSource = "";
  let lastCompassAt = 0;
  let lastGpsHeadingAt = 0;
  let currentSpeed = 0;
  let currentNearest = null;
  let liveSummary = null;
  let previewMarker = null;
  let previewSavedView = null;
  let previewMapRotation = null;
  let previewSavedControls = null;
  let previewTileAlong = null;
  let previewDistance = null;
  let rotationFrame = null, lastRotationFrameAt = null;
  const activeMapPointers = new Map();
  let rotationGesture = null;
  let elevationScale = null;
  const mapAngleSmoother = createAngleSmoother({ initialAngle: 0, deadZoneDegrees: 1.5, timeConstantMs: 220 });
  let gpsHistory = [];
  const miles = meters => meters / 1609.344;
  const feet = meters => meters * 3.28084;
  const summaryMiles = meters => `${miles(meters).toFixed(1).replace(/\.0$/, "")} miles`;

  function renderLiveSummary() {
    if (!liveSummary || previewDistance !== null) return;
    const hasCourseProgress = liveSummary.status !== "Off course";
    els.distance.textContent = hasCourseProgress ? summaryMiles(liveSummary.progress) : "—";
    els.remaining.textContent = hasCourseProgress ? summaryMiles(liveSummary.remaining) : "—";
    const elevationMeters = elevation.elevationAtDistance(elevation.samples, liveSummary.progress);
    els["live-elevation"].textContent = hasCourseProgress ? `${Math.round(feet(elevationMeters))} feet` : "—";
    els["course-status"].textContent = liveSummary.status;
    statusClass(els["course-status"], liveSummary.statusClass);
    const accuracyText = `±${Math.round(feet(liveSummary.accuracy))} feet`;
    els["location-accuracy"].textContent = accuracyText;
    els["center-control"].setAttribute("aria-label", `Center map on my location. Accuracy ${accuracyText}`);
    const liveMile = Number(miles(liveSummary.progress).toFixed(1));
    els["elevation-profile"].setAttribute("aria-valuenow", String(liveMile));
    els["elevation-profile"].setAttribute("aria-valuetext", `Live position · mile ${liveMile}`);
    renderElevationProgress(hasCourseProgress ? liveSummary.progress : null);
  }

  function statusClass(element, name) { element.className = name || ""; }
  function smoothHeading(previous, next, amount = .65) {
    if (previous === null || !Number.isFinite(previous)) return normalizeHeading(next);
    return normalizeHeading(previous + signedHeading(next - previous) * amount);
  }
  function compassHeading(event) {
    if (Number.isFinite(event.webkitCompassHeading)) return normalizeHeading(event.webkitCompassHeading);
    if (!Number.isFinite(event.alpha)) return null;
    const screenAngle = Number(screen.orientation?.angle || window.orientation || 0);
    return normalizeHeading(360 - event.alpha + screenAngle);
  }
  function onOrientation(event) {
    const heading = compassHeading(event);
    if (heading === null) return;
    compassValue = smoothHeading(compassValue, heading, .35);
    lastCompassAt = Date.now();
    if (Date.now() - lastGpsHeadingAt > 4000 || currentSpeed < .8) {
      deviceHeading = smoothHeading(deviceHeading, compassValue, .38);
      headingSource = "COMPASS";
    }
    renderNavigation();
  }
  function recentGpsHeading(fix) {
    gpsHistory.push(fix);
    gpsHistory = gpsHistory.filter(item => fix.timestamp - item.timestamp <= 8000).slice(-8);
    let origin = null;
    for (let index = gpsHistory.length - 2; index >= 0; index -= 1) {
      const item = gpsHistory[index];
      if (fix.timestamp - item.timestamp < 1500) continue;
      const distance = segmentMeters(item, fix);
      const threshold = Math.max(5, Math.min(12, Math.max(Number(item.accuracy || 0), Number(fix.accuracy || 0)) * .55));
      if (distance >= threshold) { origin = item; break; }
    }
    if (!origin) return null;
    const distance = segmentMeters(origin, fix);
    const seconds = Math.max(.1, (fix.timestamp - origin.timestamp) / 1000);
    const calculatedSpeed = distance / seconds;
    if (calculatedSpeed > 12) return null;
    return {
      heading: bearingBetween(origin, fix),
      speed: calculatedSpeed,
    };
  }
  function pointFromHeading(origin, heading, meters) {
    const angle = toRad(heading);
    return {
      lat: origin.lat + Math.cos(angle) * meters / 111111,
      lon: origin.lon + Math.sin(angle) * meters / (111111 * Math.cos(toRad(origin.lat))),
    };
  }
  function routeInstruction(delta) {
    const amount = Math.abs(delta);
    if (amount <= 15) return "Continue straight";
    if (amount <= 45) return delta > 0 ? "Bear right" : "Bear left";
    if (amount <= 120) return delta > 0 ? "Turn right" : "Turn left";
    return "Turn around";
  }
  function maneuverInstruction(delta) {
    const amount = Math.abs(delta);
    if (amount >= 145) return "Turn around";
    if (amount < 60) return delta > 0 ? "Bear right" : "Bear left";
    return delta > 0 ? "Turn right" : "Turn left";
  }
  function maneuverArrow(delta) {
    if (Math.abs(delta) >= 145) return "↶";
    return delta > 0 ? "↱" : "↰";
  }
  function relativeArrow(delta) {
    if (Math.abs(delta) <= 15) return "↑";
    return maneuverArrow(delta);
  }
  function distanceText(meters) {
    const distanceFeet = feet(Math.max(0, meters));
    if (distanceFeet < 1000) return `${Math.max(10, Math.round(distanceFeet / 10) * 10)} ft`;
    return `${miles(meters).toFixed(1)} mi`;
  }
  function nextManeuver(along) {
    return maneuvers.find(item => item.along > along - 35) || null;
  }
  function navigationTarget() {
    if (!currentFix || !currentNearest) return null;
    if (currentNearest.distance > MAX_REJOIN_GUIDANCE_METERS) return { paused: true, distance: currentNearest.distance };
    if (currentNearest.distance > REJOIN_GUIDANCE_MIN_METERS) return { lat: currentNearest.lat, lon: currentNearest.lon, rejoin: true, distance: currentNearest.distance };
    if (currentNearest.along >= totalMeters - FINISH_REACHED_METERS) return { ...pointAtCourse(totalMeters), arrived: true, rejoin: false, distance: 0 };
    return { ...pointAtCourse(currentNearest.along + GUIDANCE_LOOKAHEAD_METERS), rejoin: false, distance: GUIDANCE_LOOKAHEAD_METERS };
  }
  function drawMapRotation(timestamp) {
    const elapsed = lastRotationFrameAt === null ? 16 : Math.min(64, timestamp - lastRotationFrameAt);
    lastRotationFrameAt = timestamp;
    mapRotation = mapAngleSmoother.step(elapsed);
    headingPane.style.rotate = `${mapRotation}deg`;
    document.getElementById("map").style.setProperty("--map-heading", `${-mapRotation}deg`);
    if (!mapAngleSmoother.isSettled()) {
      rotationFrame = requestAnimationFrame(drawMapRotation);
    } else {
      rotationFrame = null;
      lastRotationFrameAt = null;
    }
  }
  function rotateMap() {
    const targetRotation = previewDistance !== null
      ? navigationMode ? -courseBearing(previewDistance) : 0
      : navigationMode && !fullRouteMode && Number.isFinite(deviceHeading)
      ? -deviceHeading
      : manualMapRotation ?? 0;
    mapAngleSmoother.setTarget(targetRotation);
    if (rotationFrame === null && !mapAngleSmoother.isSettled()) {
      rotationFrame = requestAnimationFrame(drawMapRotation);
    }
  }
  const pointerAngle = pointers => {
    const [first, second] = [...pointers.values()];
    return Math.atan2(second.y - first.y, second.x - first.x) * 180 / Math.PI;
  };
  function setMapRotationImmediately(rotation) {
    if (rotationFrame !== null) cancelAnimationFrame(rotationFrame);
    rotationFrame = null;
    lastRotationFrameAt = null;
    mapRotation = rotation;
    mapAngleSmoother.reset(rotation);
    headingPane.style.rotate = `${rotation}deg`;
    document.getElementById("map").style.setProperty("--map-heading", `${-rotation}deg`);
  }
  function beginManualRotation() {
    if (activeMapPointers.size !== 2) return;
    manualMapRotation = mapRotation;
    applyNavigationMode(false, { preserveRotation: true });
    setMapRotationImmediately(manualMapRotation);
    rotationGesture = { startAngle: pointerAngle(activeMapPointers), startRotation: manualMapRotation };
    renderNavigation();
  }
  function updateManualRotation() {
    if (!rotationGesture || activeMapPointers.size !== 2) return;
    const angleDelta = signedHeading(pointerAngle(activeMapPointers) - rotationGesture.startAngle);
    manualMapRotation = rotationGesture.startRotation + angleDelta;
    setMapRotationImmediately(manualMapRotation);
  }
  const mapElement = document.getElementById("map");
  mapElement.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse") return;
    activeMapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activeMapPointers.size === 2) beginManualRotation();
  }, { passive: true, capture: true });
  mapElement.addEventListener("pointermove", event => {
    if (!activeMapPointers.has(event.pointerId)) return;
    activeMapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    updateManualRotation();
  }, { passive: true, capture: true });
  const endMapPointer = event => {
    activeMapPointers.delete(event.pointerId);
    if (activeMapPointers.size < 2) rotationGesture = null;
  };
  mapElement.addEventListener("pointerup", endMapPointer, { passive: true, capture: true });
  mapElement.addEventListener("pointercancel", endMapPointer, { passive: true, capture: true });
  const mapOrientationLabel = () => navigationMode ? headingSource || "HEADING" : manualMapRotation !== null ? "MANUAL" : "NORTH UP";
  const userDirectionIcon = L.divIcon({ className: "user-dot", html: '<span class="user-direction-arrow"></span><span class="user-center"></span>', iconSize: [34, 34], iconAnchor: [17, 17] });
  function refreshUserDirection() {
    const element = userMarker?.getElement();
    if (!element) return;
    const hasHeading = Number.isFinite(deviceHeading);
    element.classList.toggle("has-heading", hasHeading);
    if (hasHeading) element.style.setProperty("--user-heading", `${deviceHeading}deg`);
  }
  function showDirection({ arrow = "↑", label, detail, source } = {}) {
    els["turn-arrow"].textContent = arrow;
    els["direction-label"].textContent = label;
    els["direction-detail"].textContent = detail;
    els["heading-source"].textContent = source || mapOrientationLabel();
  }
  function renderNavigation() {
    rotateMap();
    refreshUserDirection();
    const target = navigationTarget();
    els.direction.hidden = Boolean(target && target.paused);
    if (target && target.paused) return;
    if (!target) {
      showDirection({ label: "Waiting for location", detail: "Live tracking is on", source: mapOrientationLabel() });
      return;
    }
    if (target.arrived) {
      showDirection({ arrow: "✓", label: "Finish reached", detail: "King Harbor finish area" });
      return;
    }
    if (target.rejoin) {
      if (deviceHeading === null) {
        showDirection({ arrow: "↥", label: "Return to course", detail: `Course is ${distanceText(target.distance)} away` });
        return;
      }
      const delta = signedHeading(bearingBetween(currentFix, target) - deviceHeading);
      showDirection({ arrow: relativeArrow(delta), label: `${routeInstruction(delta)} to course`, detail: `Rejoin course in ${distanceText(target.distance)}` });
      return;
    }
    const next = nextManeuver(currentNearest.along);
    if (!next) {
      const remaining = totalMeters - currentNearest.along;
      showDirection({ arrow: "↑", label: remaining <= 60 ? "Finish ahead" : "Continue to finish", detail: `${distanceText(remaining)} remaining` });
      return;
    }
    const distance = next.along - currentNearest.along;
    const instruction = maneuverInstruction(next.delta);
    if (distance <= 35) {
      showDirection({ arrow: maneuverArrow(next.delta), label: `${instruction} now`, detail: `Mile ${miles(next.along).toFixed(2)} course turn` });
    } else if (distance <= 220) {
      showDirection({ arrow: maneuverArrow(next.delta), label: `${instruction} in ${distanceText(distance)}`, detail: `Mile ${miles(next.along).toFixed(2)} course turn` });
    } else {
      showDirection({ arrow: "↑", label: "Continue straight", detail: `${instruction} in ${distanceText(distance)}` });
    }
  }
  function updatePosition(position) {
    const { latitude: lat, longitude: lon, accuracy, heading, speed } = position.coords;
    const timestamp = Number(position.timestamp || Date.now());
    const elapsedSeconds = currentFix ? Math.max(.1, (timestamp - currentFix.timestamp) / 1000) : 1;
    const movementMeters = currentFix ? segmentMeters(currentFix, { lat, lon }) : 0;
    const movementThreshold = Math.max(3, Math.min(12, Number(accuracy || 10) * .6));
    const nextFix = { lat, lon, accuracy: Number(accuracy || 10), timestamp };
    const gpsMotion = recentGpsHeading(nextFix);
    const nativeHeading = Number.isFinite(heading) && heading >= 0 ? normalizeHeading(heading) : null;
    const nativeSpeed = Number(speed) > 0 && Number(speed) <= 12 ? Number(speed) : null;
    const instantSpeed = movementMeters / elapsedSeconds;
    const plausibleInstantMotion = currentFix && elapsedSeconds <= 30 && instantSpeed <= 12 && movementMeters >= movementThreshold;
    const travelHeading = gpsMotion?.heading ?? (nativeSpeed !== null ? nativeHeading : null) ?? (plausibleInstantMotion ? bearingBetween(currentFix, nextFix) : null);
    const travelSpeed = gpsMotion?.speed ?? nativeSpeed ?? (instantSpeed <= 12 ? instantSpeed : 0);
    const nearest = selectCoursePosition(lat, lon, {
      previousAlong: currentNearest?.along,
      travelHeading,
      speed: travelSpeed,
      accuracy: Number(accuracy || 10),
      elapsedSeconds,
    });
    currentFix = nextFix;
    currentNearest = nearest;
    currentSpeed = travelSpeed;
    const movementHeading = gpsMotion?.heading ?? (nativeHeading !== null && nativeSpeed !== null && nativeSpeed > .5 ? nativeHeading : null);
    if (movementHeading !== null && travelSpeed > .8) {
      const change = deviceHeading === null ? 180 : Math.abs(signedHeading(movementHeading - deviceHeading));
      deviceHeading = smoothHeading(deviceHeading, movementHeading, change > 35 ? .82 : .62);
      headingSource = gpsMotion ? "GPS TRACK" : "GPS";
      lastGpsHeadingAt = Date.now();
    } else if (compassValue !== null && Date.now() - lastCompassAt < 3000) {
      deviceHeading = smoothHeading(deviceHeading, compassValue, .38);
      headingSource = "COMPASS";
    }
    const progress = Math.min(totalMeters, nearest.along), remaining = Math.max(0, totalMeters - progress);
    const offFeet = feet(nearest.distance);
    let courseStatus = "Off course", courseStatusClass = "bad";
    if (offFeet <= 100) { courseStatus = "On course"; courseStatusClass = "good"; }
    else if (offFeet <= 300) { courseStatus = "Nearby"; courseStatusClass = "warn"; }
    liveSummary = { progress, remaining, status: courseStatus, statusClass: courseStatusClass, accuracy: Number(accuracy || 10) };
    renderLiveSummary();
    els["location-error"].hidden = true;
    const ll = [lat, lon];
    if (!userMarker) {
      userMarker = L.marker(ll, { icon: userDirectionIcon, zIndexOffset: 1000 }).addTo(map).bindTooltip("You");
      accuracyCircle = L.circle(ll, { radius: accuracy, color: "#1689ff", weight: 1, fillColor: "#1689ff", fillOpacity: .1 }).addTo(map);
      nearestMarker = L.circleMarker([nearest.lat, nearest.lon], { radius: 4, color: "white", weight: 2, fillColor: "#ff1616", fillOpacity: 1 }).addTo(map);
    } else {
      userMarker.setLatLng(ll); accuracyCircle.setLatLng(ll).setRadius(accuracy); nearestMarker.setLatLng([nearest.lat, nearest.lon]);
    }
    refreshUserDirection();
    if (following && previewDistance === null) {
      const targetZoom = Math.max(map.getZoom(), navigationMode ? 17 : 16);
      const viewCenter = navigationMode && Number.isFinite(deviceHeading) ? pointFromHeading(currentFix, deviceHeading, 70) : currentFix;
      const centerLatLng = [viewCenter.lat, viewCenter.lon];
      const center = map.getCenter();
      if (map.getZoom() !== targetZoom || center.distanceTo(centerLatLng) > 8) map.setView(centerLatLng, targetZoom, { animate: false });
    }
    refreshRouteChevrons();
    renderNavigation();
  }

  function locationError(error) {
    const messages = { 1: "Location permission is off. In Safari, tap aA → Website Settings → Location → Allow, then reload this page.", 2: "Your location is temporarily unavailable. Move outdoors while this page keeps trying.", 3: "GPS is taking longer than expected. Move outdoors while this page keeps trying." };
    els["location-error"].textContent = messages[error.code] || "Could not read your location.";
    els["location-error"].hidden = false;
  }

  async function requestWakeLock() {
    try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch (_) {}
  }
  function startTracking() {
    if (!navigator.geolocation) return locationError({ code: 2 });
    if (watchId !== null) return;
    following = true;
    watchId = navigator.geolocation.watchPosition(updatePosition, locationError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    requestWakeLock();
  }
  function stopTracking() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  function renderElevationProfile() {
    const samples = elevation.samples;
    const elevations = samples.map(sample => sample[1]);
    const minimum = Math.min(...elevations) - 3;
    const maximum = Math.max(...elevations) + 3;
    const range = Math.max(1, maximum - minimum);
    elevationScale = { minimum, range };
    const coordinates = samples.map(([along, meters]) => {
      const x = along / totalMeters * 220;
      const y = 27 - (meters - minimum) / range * 24;
      return [x, y];
    });
    const linePath = coordinates.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    els["elevation-line"].setAttribute("d", linePath);
    els["elevation-area"].setAttribute("d", `${linePath} L220,30 L0,30 Z`);
  }

  function renderElevationProgress(along, previewing = false) {
    const hidden = !Number.isFinite(along) || !elevationScale;
    els["elevation-cursor"].toggleAttribute("hidden", hidden);
    els["elevation-progress"].toggleAttribute("hidden", hidden);
    if (hidden) return;
    const target = Math.max(0, Math.min(totalMeters, along));
    const elevationMeters = elevation.elevationAtDistance(elevation.samples, target);
    const chartX = target / totalMeters * 220;
    const chartY = 27 - (elevationMeters - elevationScale.minimum) / elevationScale.range * 24;
    els["elevation-cursor"].setAttribute("x1", chartX.toFixed(2));
    els["elevation-cursor"].setAttribute("x2", chartX.toFixed(2));
    els["elevation-cursor"].classList.toggle("previewing", previewing);
    els["elevation-progress"].style.left = `${target / totalMeters * 100}%`;
    els["elevation-progress"].style.top = `${chartY}px`;
    els["elevation-progress"].classList.toggle("previewing", previewing);
  }

  const previewDirectionIcon = bearing => L.divIcon({
    className: "route-preview-direction",
    html: `<span class="route-preview-arrow" style="transform:rotate(${bearing}deg)"></span><span class="route-preview-center"></span>`,
    iconSize: [36, 36], iconAnchor: [18, 18],
  });
  function previewTilesReady() {
    map.fire("previewtilesready", { along: previewTileAlong });
  }
  function previewCourseAt(along) {
    const target = Math.max(0, Math.min(totalMeters, along));
    const previewBearing = courseBearing(target);
    if (previewDistance === null) {
      previewSavedView = { center: map.getCenter(), zoom: map.getZoom() };
      previewMapRotation = mapAngleSmoother.getTarget();
      previewSavedControls = { following, fullRouteMode };
      setPreviewRouteSelection(true);
    }
    previewDistance = target;
    setMapRotationImmediately(navigationMode ? -previewBearing : 0);
    const elevationMeters = elevation.elevationAtDistance(elevation.samples, target);
    const previewZoom = Math.max(map.getZoom(), 16);
    const displayedPoint = displayedRoutePoint(target, previewZoom);
    if (!previewMarker) previewMarker = L.marker(displayedPoint, { icon: previewDirectionIcon(previewBearing), interactive: false, keyboard: false, zIndexOffset: 1500 }).addTo(map);
    else previewMarker.setLatLng(displayedPoint).setIcon(previewDirectionIcon(previewBearing));
    map.invalidateSize({ pan: false, animate: false });
    previewTileAlong = target;
    streetTiles.off("load", previewTilesReady);
    streetTiles.once("load", previewTilesReady);
    map.setView(displayedPoint, previewZoom, { animate: false });
    els.distance.textContent = summaryMiles(target);
    els.remaining.textContent = summaryMiles(totalMeters - target);
    els["live-elevation"].textContent = `${Math.round(feet(elevationMeters))} feet`;
    renderElevationProgress(target, true);
    const mileValue = Number(miles(target).toFixed(1));
    els["elevation-profile"].setAttribute("aria-valuenow", String(mileValue));
    els["elevation-profile"].setAttribute("aria-valuetext", `Mile ${mileValue} · ${Math.round(feet(elevationMeters))} feet elevation`);
  }

  function endCoursePreview() {
    if (previewDistance === null) return;
    previewDistance = null;
    if (previewMarker) { map.removeLayer(previewMarker); previewMarker = null; }
    if (previewSavedControls) {
      following = previewSavedControls.following;
      setFullRouteMode(previewSavedControls.fullRouteMode);
    }
    if (following && currentFix && !fullRouteMode) {
      const useHeadingOffset = navigationMode && Number.isFinite(deviceHeading);
      const viewCenter = useHeadingOffset ? pointFromHeading(currentFix, deviceHeading, 70) : currentFix;
      map.setView([viewCenter.lat, viewCenter.lon], previewSavedView?.zoom ?? map.getZoom(), { animate: false });
    } else if (previewSavedView) map.setView(previewSavedView.center, previewSavedView.zoom, { animate: false });
    if (previewMapRotation !== null) setMapRotationImmediately(previewMapRotation);
    streetTiles.off("load", previewTilesReady);
    previewTileAlong = null;
    previewSavedView = null;
    previewMapRotation = null;
    previewSavedControls = null;
    renderLiveSummary();
  }

  function previewFromPointer(event) {
    const rect = els["elevation-chart"].getBoundingClientRect();
    previewCourseAt(elevation.distanceFromPointer(event.clientX, rect.left, rect.width, totalMeters));
  }

  els["elevation-profile"].addEventListener("pointerdown", event => {
    els["elevation-profile"].setPointerCapture(event.pointerId);
    previewFromPointer(event);
  });
  els["elevation-profile"].addEventListener("pointermove", event => {
    if (els["elevation-profile"].hasPointerCapture(event.pointerId)) previewFromPointer(event);
  });
  els["elevation-profile"].addEventListener("pointerup", endCoursePreview);
  els["elevation-profile"].addEventListener("pointercancel", endCoursePreview);
  els["elevation-profile"].addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const base = previewDistance ?? liveSummary?.progress ?? 0;
    const step = totalMeters / 100;
    previewCourseAt(event.key === "Home" ? 0 : event.key === "End" ? totalMeters : base + (event.key === "ArrowRight" ? step : -step));
  });
  els["elevation-profile"].addEventListener("keyup", event => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) endCoursePreview();
  });
  els["elevation-profile"].addEventListener("blur", endCoursePreview);
  renderElevationProfile();
  function setFullRouteMode(enabled) {
    fullRouteMode = enabled;
    els["route-control"].classList.toggle("active", enabled);
    els["route-control"].setAttribute("aria-pressed", String(enabled));
    els["center-control"].classList.toggle("active", !enabled && following);
    els["center-control"].setAttribute("aria-pressed", String(!enabled && following));
  }
  function setPreviewRouteSelection(enabled) {
    const routeSelected = enabled || fullRouteMode;
    const locationSelected = !enabled && !fullRouteMode && following;
    els["route-control"].classList.toggle("active", routeSelected);
    els["route-control"].setAttribute("aria-pressed", String(routeSelected));
    els["center-control"].classList.toggle("active", locationSelected);
    els["center-control"].setAttribute("aria-pressed", String(locationSelected));
  }
  function applyNavigationMode(enabled, { preserveRotation = false } = {}) {
    navigationMode = enabled;
    if (enabled) manualMapRotation = null;
    els["direction-toggle"].classList.toggle("active", enabled);
    els["direction-toggle"].setAttribute("aria-pressed", String(enabled));
    els["direction-toggle"].setAttribute("aria-label", enabled ? "Direction heading enabled" : "Direction heading disabled");
    document.body.classList.toggle("navigation-mode", enabled);
    map.invalidateSize({ pan: false, animate: false });
    if (!preserveRotation && currentFix && following && !fullRouteMode) {
      const useHeadingOffset = enabled && Number.isFinite(deviceHeading);
      const viewCenter = useHeadingOffset ? pointFromHeading(currentFix, deviceHeading, 70) : currentFix;
      map.setView([viewCenter.lat, viewCenter.lon], enabled ? 17 : 16, { animate: false });
    }
    if (!preserveRotation) renderNavigation();
  }
  async function toggleNavigation() {
    if (navigationMode) {
      applyNavigationMode(false);
      return;
    }
    let permission = "granted";
    try {
      if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        permission = await DeviceOrientationEvent.requestPermission();
      }
    } catch (_) {
      permission = "denied";
    }
    if (permission === "granted" && !orientationListening) {
      window.addEventListener("deviceorientation", onOrientation, { passive: true });
      orientationListening = true;
    }
    following = true;
    setFullRouteMode(false);
    applyNavigationMode(true);
    if (permission !== "granted") {
      els["direction-label"].textContent = "Move to set direction";
      els["direction-detail"].textContent = "Compass denied · using GPS heading while running";
      els["heading-source"].textContent = "GPS";
    }
  }
  els["direction-toggle"].addEventListener("click", toggleNavigation);
  function centerLiveMap() {
    following = true;
    setFullRouteMode(false);
    if (currentFix) {
      const useHeadingOffset = navigationMode && Number.isFinite(deviceHeading);
      const viewCenter = useHeadingOffset ? pointFromHeading(currentFix, deviceHeading, 70) : currentFix;
      map.setView([viewCenter.lat, viewCenter.lon], navigationMode ? 17 : 16, { animate: false });
    }
    renderNavigation();
  }
  els["center-control"].addEventListener("click", centerLiveMap);
  els["route-control"].addEventListener("click", () => {
    const selectingRouteFromLocation = following && !fullRouteMode;
    manualMapRotation = null;
    if (selectingRouteFromLocation) applyNavigationMode(false);
    setFullRouteMode(true);
    following = false;
    rotateMap();
    map.fitBounds(routeBounds, { paddingTopLeft: [20, 190], paddingBottomRight: [20, 100] });
  });
  map.on("dragstart", () => {
    following = false;
    setFullRouteMode(false);
  });
  els["help-toggle"].addEventListener("click", () => {
    const open = els.help.hidden;
    els.help.hidden = !open;
    els["help-toggle"].setAttribute("aria-expanded", String(open));
    document.getElementById("help-label").textContent = open ? "Close" : "More info";
    document.getElementById("help-symbol").textContent = open ? "−" : "＋";
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (watchId === null) startTracking();
    requestWakeLock();
  });
  appearance.addEventListener?.("change", event => applyAppearance(event.matches));
  const refreshMapLayout = () => window.requestAnimationFrame(() => { map.invalidateSize({ pan: false, animate: false }); renderNavigation(); });
  window.addEventListener("resize", refreshMapLayout, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(refreshMapLayout, 250), { passive: true });
  window.visualViewport?.addEventListener("resize", refreshMapLayout, { passive: true });
  window.visualViewport?.addEventListener("scroll", refreshMapLayout, { passive: true });
  setTimeout(refreshMapLayout, 100);
  setTimeout(refreshMapLayout, 1000);
  document.body.classList.add("navigation-mode");
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission !== "function") {
    window.addEventListener("deviceorientation", onOrientation, { passive: true });
    orientationListening = true;
  }
  startTracking();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  function setTestNavigation(heading, enabled = true) {
    deviceHeading = normalizeHeading(heading);
    headingSource = "TEST";
    applyNavigationMode(enabled);
    renderNavigation();
  }
  function navigationState() { return { deviceHeading, mapRotation, mapRotationTarget: mapAngleSmoother.getTarget(), mapRotationSettled: mapAngleSmoother.isSettled(), headingSource, currentSpeed, navigationMode, fullRouteMode, following, gpsHistory: gpsHistory.length, guidancePaused: Boolean(currentNearest && currentNearest.distance > MAX_REJOIN_GUIDANCE_METERS) }; }
  function mapState(courseDistance = null) {
    const center = map.getCenter();
    const size = map.getSize();
    const target = Number.isFinite(courseDistance) ? pointAtCourse(courseDistance) : null;
    const targetScreen = target ? map.latLngToContainerPoint([target.lat, target.lon]) : null;
    const tiles = [...document.querySelectorAll(".leaflet-tile")];
    return {
      center: { lat: center.lat, lng: center.lng }, zoom: map.getZoom(), viewport: { x: size.x / 2, y: size.y / 2 },
      targetScreen: targetScreen ? { x: targetScreen.x, y: targetScreen.y } : null,
      loadedTiles: tiles.filter(tile => tile.complete && tile.naturalWidth > 0).length, totalTiles: tiles.length,
    };
  }
  const triggerMapDragStart = () => map.fire("dragstart");
  window.__routeAppTest = { nearestOnCourse, selectCoursePosition, pointAtCourse, bearingBetween, courseBearing, updatePosition, totalMeters, maxRejoinGuidanceMeters: MAX_REJOIN_GUIDANCE_METERS, startTracking, stopTracking, setTestNavigation, setFullRouteMode, navigationState, mapState, triggerMapDragStart, routeInstruction, maneuverInstruction, nextManeuver, maneuvers, signedHeading };
})();
