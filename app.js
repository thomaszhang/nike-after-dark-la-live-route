
(() => {
  "use strict";
  const route = window.NIKE_ROUTE;
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
  const MAX_REJOIN_GUIDANCE_METERS = 100;

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

  const map = L.map("map", { zoomControl: false, attributionControl: true, preferCanvas: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
  const appearance = window.matchMedia("(prefers-color-scheme: dark)");
  const tileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const applyAppearance = dark => document.body.classList.toggle("dark-appearance", dark);
  applyAppearance(appearance.matches);
  const streetTiles = L.tileLayer(tileUrl, {
    subdomains: "abcd",
    maxZoom: 20,
    detectRetina: true,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 4,
    attribution: "© OpenStreetMap contributors",
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
  const courseRenderer = L.Browser.svg ? L.svg({ padding: .5 }) : L.canvas({ padding: .5 });
  const outline = L.polyline(routeLatLngs, { renderer: courseRenderer, color: "#ffffff", weight: 12, opacity: .9, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
  const line = L.polyline(routeLatLngs, { renderer: courseRenderer, color: "#ff1616", weight: 7, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
  map.fitBounds(line.getBounds(), { paddingTopLeft: [20, 170], paddingBottomRight: [20, 150] });

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

  const els = Object.fromEntries(["navigate", "recenter", "overview", "course-status", "mile-progress", "remaining", "off-route", "accuracy", "direction", "turn-arrow", "direction-label", "direction-detail", "heading-source", "location-error", "help", "help-toggle", "help-body"].map(id => [id, document.getElementById(id)]));
  let watchId = null, userMarker = null, accuracyCircle = null, nearestMarker = null, following = true, wakeLock = null;
  let navigationMode = true, fullRouteMode = false, orientationListening = false, deviceHeading = null, compassValue = null, mapRotation = 0, headingSource = "", lastCompassAt = 0, lastGpsHeadingAt = 0, currentSpeed = 0, currentFix = null, currentNearest = null;
  let gpsHistory = [];
  const miles = meters => meters / 1609.344;
  const feet = meters => meters * 3.28084;

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
    if (currentNearest.distance > 30) return { lat: currentNearest.lat, lon: currentNearest.lon, rejoin: true, distance: currentNearest.distance };
    if (currentNearest.along >= totalMeters - 15) return { ...pointAtCourse(totalMeters), arrived: true, rejoin: false, distance: 0 };
    return { ...pointAtCourse(currentNearest.along + 50), rejoin: false, distance: 50 };
  }
  function rotateMap() {
    const heading = navigationMode && !fullRouteMode && Number.isFinite(deviceHeading) ? deviceHeading : 0;
    const desiredRotation = -heading;
    mapRotation += signedHeading(desiredRotation - mapRotation);
    headingPane.style.rotate = `${mapRotation}deg`;
    document.getElementById("map").style.setProperty("--map-heading", `${-mapRotation}deg`);
  }
  function showDirection({ arrow = "↑", rotation = 0, label, detail, source } = {}) {
    els["turn-arrow"].textContent = arrow;
    els["turn-arrow"].style.transform = `rotate(${rotation}deg)`;
    els["direction-label"].textContent = label;
    els["direction-detail"].textContent = detail;
    els["heading-source"].textContent = source || (navigationMode ? headingSource || "HEADING" : "NORTH UP");
  }
  function renderNavigation() {
    rotateMap();
    const target = navigationTarget();
    if (!target) {
      showDirection({ label: "Waiting for location", detail: "Live tracking is on", source: navigationMode ? "HEADING" : "NORTH UP" });
      return;
    }
    if (target.paused) {
      showDirection({ arrow: "!", label: "Navigation paused", detail: `${distanceText(target.distance)} from course · open Full route`, source: "PAUSED" });
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
    els["mile-progress"].textContent = miles(progress).toFixed(2);
    els.remaining.textContent = miles(remaining).toFixed(2) + " mi";
    els["off-route"].textContent = offFeet < 1000 ? Math.round(offFeet) + " ft" : (offFeet / 5280).toFixed(2) + " mi";
    if (offFeet <= 100) { els["course-status"].textContent = "On course"; statusClass(els["course-status"], "good"); statusClass(els["off-route"], "good"); }
    else if (offFeet <= 300) { els["course-status"].textContent = "Nearby"; statusClass(els["course-status"], "warn"); statusClass(els["off-route"], "warn"); }
    else { els["course-status"].textContent = "Off course"; statusClass(els["course-status"], "bad"); statusClass(els["off-route"], "bad"); }
    els.accuracy.textContent = `GPS accuracy ±${Math.round(feet(accuracy))} ft · progress follows nearest point on course`;
    els["location-error"].hidden = true;
    const ll = [lat, lon];
    if (!userMarker) {
      userMarker = L.marker(ll, { icon: L.divIcon({ className: "user-dot", iconAnchor: [11, 11] }), zIndexOffset: 1000 }).addTo(map).bindTooltip("You");
      accuracyCircle = L.circle(ll, { radius: accuracy, color: "#1689ff", weight: 1, fillColor: "#1689ff", fillOpacity: .1 }).addTo(map);
      nearestMarker = L.circleMarker([nearest.lat, nearest.lon], { radius: 4, color: "white", weight: 2, fillColor: "#ff1616", fillOpacity: 1 }).addTo(map);
    } else {
      userMarker.setLatLng(ll); accuracyCircle.setLatLng(ll).setRadius(accuracy); nearestMarker.setLatLng([nearest.lat, nearest.lon]);
    }
    if (following) {
      const targetZoom = Math.max(map.getZoom(), navigationMode ? 17 : 16);
      const viewCenter = navigationMode && Number.isFinite(deviceHeading) ? pointFromHeading(currentFix, deviceHeading, 70) : currentFix;
      const centerLatLng = [viewCenter.lat, viewCenter.lon];
      const center = map.getCenter();
      if (map.getZoom() !== targetZoom || center.distanceTo(centerLatLng) > 8) map.setView(centerLatLng, targetZoom, { animate: false });
    }
    els.recenter.disabled = false;
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
  function setFullRouteMode(enabled) {
    fullRouteMode = enabled;
    els.overview.textContent = enabled ? "Live map" : "Full route";
    els.overview.classList.toggle("active", enabled);
    els.overview.setAttribute("aria-pressed", String(enabled));
    els.overview.setAttribute("aria-label", enabled ? "Return to live heading-up map" : "Show full route");
  }
  function applyNavigationMode(enabled) {
    navigationMode = enabled;
    els.navigate.classList.toggle("active", enabled);
    els.navigate.textContent = enabled ? "Heading on" : "Heading off";
    els.navigate.setAttribute("aria-pressed", String(enabled));
    els.navigate.setAttribute("aria-label", enabled ? "Heading-up navigation on" : "Enable heading-up navigation");
    document.body.classList.toggle("navigation-mode", enabled);
    map.invalidateSize({ pan: false, animate: false });
    if (enabled) {
      setFullRouteMode(false);
      following = true;
      if (currentFix) {
        const viewCenter = Number.isFinite(deviceHeading) ? pointFromHeading(currentFix, deviceHeading, 70) : currentFix;
        map.setView([viewCenter.lat, viewCenter.lon], Math.max(17, map.getZoom()), { animate: false });
      }
      renderNavigation();
    } else {
      rotateMap();
      map.invalidateSize({ pan: false, animate: false });
      if (currentFix) map.setView([currentFix.lat, currentFix.lon], Math.max(16, map.getZoom()), { animate: false });
    }
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
    applyNavigationMode(true);
    if (permission !== "granted") {
      els["direction-label"].textContent = "Move to set direction";
      els["direction-detail"].textContent = "Compass denied · using GPS heading while running";
      els["heading-source"].textContent = "GPS";
    }
  }
  els.navigate.addEventListener("click", toggleNavigation);
  function centerLiveMap() {
    setFullRouteMode(false);
    following = true;
    if (currentFix) {
      const useHeadingOffset = navigationMode && Number.isFinite(deviceHeading);
      const viewCenter = useHeadingOffset ? pointFromHeading(currentFix, deviceHeading, 70) : currentFix;
      map.setView([viewCenter.lat, viewCenter.lon], navigationMode ? 17 : 16, { animate: false });
    }
    renderNavigation();
  }
  els.recenter.addEventListener("click", centerLiveMap);
  els.overview.addEventListener("click", () => {
    if (fullRouteMode) {
      centerLiveMap();
      return;
    }
    setFullRouteMode(true);
    following = false;
    rotateMap();
    map.fitBounds(line.getBounds(), { paddingTopLeft: [20, 190], paddingBottomRight: [20, 100] });
  });
  map.on("dragstart", () => { following = false; });
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
  function navigationState() { return { deviceHeading, mapRotation, headingSource, currentSpeed, navigationMode, gpsHistory: gpsHistory.length, guidancePaused: Boolean(currentNearest && currentNearest.distance > MAX_REJOIN_GUIDANCE_METERS) }; }
  window.__routeAppTest = { nearestOnCourse, selectCoursePosition, pointAtCourse, bearingBetween, courseBearing, updatePosition, totalMeters, maxRejoinGuidanceMeters: MAX_REJOIN_GUIDANCE_METERS, startTracking, stopTracking, setTestNavigation, setFullRouteMode, navigationState, routeInstruction, maneuverInstruction, nextManeuver, maneuvers, signedHeading };
})();
