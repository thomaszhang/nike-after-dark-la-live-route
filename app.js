
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
  const streetTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 20,
    detectRetina: true,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 4,
    attribution: "© OpenStreetMap © CARTO",
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

  const label = (text, className) => L.divIcon({ className, html: text, iconAnchor: [className === "course-label" ? 13 : 24, 13] });
  L.marker([route.start[1], route.start[0]], { icon: label("START", "start-finish"), zIndexOffset: 500 }).addTo(map).bindPopup("Start · King Harbor");
  L.marker([route.finish[1], route.finish[0]], { icon: label("FINISH", "start-finish"), zIndexOffset: 500 }).addTo(map).bindPopup("Finish · King Harbor");
  route.mileMarkers.forEach(m => L.marker([m.coordinates[1], m.coordinates[0]], { icon: label(String(m.mile), "course-label") }).addTo(map).bindTooltip(`Mile ${m.mile}`));

  const els = Object.fromEntries(["track", "navigate", "recenter", "overview", "course-status", "mile-progress", "remaining", "off-route", "accuracy", "guidance", "guidance-arrow", "guidance-title", "guidance-detail", "direction", "turn-arrow", "direction-label", "direction-detail", "heading-source", "location-error", "help-toggle", "help-body"].map(id => [id, document.getElementById(id)]));
  const navigationCanvas = document.createElement("canvas");
  navigationCanvas.id = "navigation-view";
  navigationCanvas.hidden = true;
  document.getElementById("app").append(navigationCanvas);
  let watchId = null, userMarker = null, accuracyCircle = null, nearestMarker = null, following = true, wakeLock = null;
  let navigationMode = false, orientationListening = false, deviceHeading = null, headingSource = "", lastCompassAt = 0, currentFix = null, currentNearest = null;
  const miles = meters => meters / 1609.344;
  const feet = meters => meters * 3.28084;

  function statusClass(element, name) { element.className = name || ""; }
  function smoothHeading(previous, next) {
    if (previous === null || !Number.isFinite(previous)) return normalizeHeading(next);
    return normalizeHeading(previous + signedHeading(next - previous) * .22);
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
    deviceHeading = smoothHeading(deviceHeading, heading);
    headingSource = "COMPASS";
    lastCompassAt = Date.now();
    renderNavigation();
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
  function renderGuidance() {
    if (!currentFix || !currentNearest) return;
    els.guidance.hidden = false;
    document.body.classList.add("guidance-active");
    if (currentNearest.distance > 30) {
      const target = { lat: currentNearest.lat, lon: currentNearest.lon };
      const delta = deviceHeading === null ? 0 : signedHeading(bearingBetween(currentFix, target) - deviceHeading);
      els["guidance-arrow"].textContent = deviceHeading === null ? "↥" : relativeArrow(delta);
      els["guidance-title"].textContent = deviceHeading === null ? "Return to course" : `${routeInstruction(delta)} to course`;
      els["guidance-detail"].textContent = `Course is ${distanceText(currentNearest.distance)} away`;
      return;
    }
    if (currentNearest.along >= totalMeters - 15) {
      els["guidance-arrow"].textContent = "✓";
      els["guidance-title"].textContent = "Finish reached";
      els["guidance-detail"].textContent = "King Harbor finish area";
      return;
    }
    const next = nextManeuver(currentNearest.along);
    if (!next) {
      const remaining = totalMeters - currentNearest.along;
      els["guidance-arrow"].textContent = "↑";
      els["guidance-title"].textContent = remaining <= 60 ? "Finish ahead" : "Continue to finish";
      els["guidance-detail"].textContent = `${distanceText(remaining)} remaining`;
      return;
    }
    const distance = next.along - currentNearest.along;
    const instruction = maneuverInstruction(next.delta);
    els["guidance-arrow"].textContent = maneuverArrow(next.delta);
    if (distance <= 35) {
      els["guidance-title"].textContent = `${instruction} now`;
      els["guidance-detail"].textContent = `Mile ${miles(next.along).toFixed(2)} course turn`;
    } else if (distance <= 220) {
      els["guidance-title"].textContent = `${instruction} in ${distanceText(distance)}`;
      els["guidance-detail"].textContent = `Mile ${miles(next.along).toFixed(2)} course turn`;
    } else {
      els["guidance-arrow"].textContent = "↑";
      els["guidance-title"].textContent = "Continue straight";
      els["guidance-detail"].textContent = `${instruction} in ${distanceText(distance)}`;
    }
  }
  function navigationTarget() {
    if (!currentFix || !currentNearest) return null;
    if (currentNearest.distance > 30) return { lat: currentNearest.lat, lon: currentNearest.lon, rejoin: true, distance: currentNearest.distance };
    if (currentNearest.along >= totalMeters - 15) return { ...pointAtCourse(totalMeters), arrived: true, rejoin: false, distance: 0 };
    const target = pointAtCourse(currentNearest.along + 50);
    return { ...target, rejoin: false, distance: 50 };
  }
  function drawNavigationCourse(target) {
    const canvas = navigationCanvas;
    const width = window.innerWidth, height = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    if (!currentFix || deviceHeading === null) return;
    const centerX = width / 2, originY = height - 156, horizonY = Math.max(230, height * .28), viewDepth = 420;
    const heading = toRad(deviceHeading), cosLat = Math.cos(toRad(currentFix.lat));
    const project = point => {
      const east = toRad(point.lon - currentFix.lon) * R * cosLat;
      const north = toRad(point.lat - currentFix.lat) * R;
      const forward = east * Math.sin(heading) + north * Math.cos(heading);
      const right = east * Math.cos(heading) - north * Math.sin(heading);
      const forwardRatio = Math.max(-.12, Math.min(1, forward / viewDepth));
      const depth = forwardRatio >= 0 ? Math.pow(forwardRatio, .72) : forwardRatio;
      const perspective = 1 - Math.max(0, forwardRatio) * .5;
      return { x: centerX + right * 1.15 * perspective, y: originY - depth * (originY - horizonY), forward };
    };
    const gradient = ctx.createLinearGradient(0, horizonY, 0, originY);
    gradient.addColorStop(0, "rgba(22,22,22,.22)"); gradient.addColorStop(1, "rgba(0,0,0,.72)");
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(centerX - 28, horizonY); ctx.lineTo(width, originY); ctx.lineTo(0, originY); ctx.lineTo(centerX + 28, horizonY); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.16)"; ctx.lineWidth = 1;
    for (const distance of [50, 100, 200, 300, 400]) {
      const y = originY - Math.pow(distance / viewDepth, .72) * (originY - horizonY);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    const navigationPoints = [];
    if (target.rejoin) navigationPoints.push({ lat: currentFix.lat, lon: currentFix.lon }, { lat: target.lat, lon: target.lon });
    else {
      navigationPoints.push(pointAtCourse(Math.max(0, currentNearest.along - 20)));
      for (let along = currentNearest.along; along <= Math.min(totalMeters, currentNearest.along + viewDepth); along += 8) navigationPoints.push(pointAtCourse(along));
    }
    const projected = navigationPoints.map(project).filter(point => point.forward >= -50 && point.forward <= viewDepth * 1.15);
    const stroke = (color, widthValue) => {
      if (projected.length < 2) return;
      ctx.beginPath(); ctx.moveTo(projected[0].x, projected[0].y);
      for (const point of projected.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = color; ctx.lineWidth = widthValue; ctx.stroke();
    };
    stroke("rgba(255,255,255,.95)", 17); stroke(target.rejoin ? "#ffb020" : "#ff1616", 10);
    ctx.fillStyle = "#1689ff"; ctx.strokeStyle = "white"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(centerX, originY, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  function renderNavigation() {
    if (!navigationMode) return;
    const target = navigationTarget();
    if (!target || deviceHeading === null) {
      els["direction-label"].textContent = currentFix ? "Point your phone forward" : "Waiting for location";
      els["direction-detail"].textContent = deviceHeading === null ? "Waiting for compass or movement" : "Acquiring GPS";
      navigationCanvas.getContext("2d")?.clearRect(0, 0, navigationCanvas.width, navigationCanvas.height);
      return;
    }
    const desired = bearingBetween(currentFix, target);
    const delta = signedHeading(desired - deviceHeading);
    if (target.arrived) {
      els["turn-arrow"].style.transform = "rotate(0deg)";
      els["direction-label"].textContent = "Finish reached";
      els["direction-detail"].textContent = "King Harbor finish area";
      drawNavigationCourse(target);
      return;
    }
    els["turn-arrow"].style.transform = `rotate(${delta}deg)`;
    els["direction-label"].textContent = target.rejoin ? `${routeInstruction(delta)} to course` : routeInstruction(delta);
    els["direction-detail"].textContent = target.rejoin ? `Rejoin course in ${Math.round(feet(target.distance))} ft` : `Aim ${Math.round(target.distance * 3.28084)} ft ahead on course`;
    els["heading-source"].textContent = headingSource || "HEADING";
    drawNavigationCourse(target);
  }
  function updatePosition(position) {
    const { latitude: lat, longitude: lon, accuracy, heading, speed } = position.coords;
    const timestamp = Number(position.timestamp || Date.now());
    const elapsedSeconds = currentFix ? Math.max(.1, (timestamp - currentFix.timestamp) / 1000) : 1;
    const movementMeters = currentFix ? segmentMeters(currentFix, { lat, lon }) : 0;
    const movementThreshold = Math.max(3, Math.min(12, Number(accuracy || 10) * .6));
    const travelHeading = Number.isFinite(heading) && heading >= 0
      ? heading
      : currentFix && elapsedSeconds <= 30 && movementMeters >= movementThreshold
        ? bearingBetween(currentFix, { lat, lon })
        : null;
    const travelSpeed = Number(speed) > 0 ? Number(speed) : movementMeters / elapsedSeconds;
    const nearest = selectCoursePosition(lat, lon, {
      previousAlong: currentNearest?.along,
      travelHeading,
      speed: travelSpeed,
      accuracy: Number(accuracy || 10),
      elapsedSeconds,
    });
    currentFix = { lat, lon, accuracy, timestamp };
    currentNearest = nearest;
    const compassIsFresh = orientationListening && Date.now() - lastCompassAt < 2000;
    if (Number.isFinite(heading) && heading >= 0 && Number(speed || 0) > .5 && (deviceHeading === null || !compassIsFresh)) {
      deviceHeading = smoothHeading(deviceHeading, heading);
      headingSource = "GPS";
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
      const targetZoom = Math.max(map.getZoom(), 16);
      const center = map.getCenter();
      if (map.getZoom() !== targetZoom || center.distanceTo(ll) > 12) map.setView(ll, targetZoom, { animate: false });
    }
    els.recenter.disabled = false;
    renderGuidance();
    renderNavigation();
  }

  function locationError(error) {
    const messages = { 1: "Location permission is off. In Safari, tap aA → Website Settings → Location → Allow, then try again.", 2: "Your location is temporarily unavailable. Move outdoors and try again.", 3: "GPS took too long to respond. Tap Start live tracking again." };
    els["location-error"].textContent = messages[error.code] || "Could not read your location.";
    els["location-error"].hidden = false;
    stopTracking();
  }

  async function requestWakeLock() {
    try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch (_) {}
  }
  function startTracking() {
    if (!navigator.geolocation) return locationError({ code: 2 });
    els.track.textContent = "Stop tracking"; els.track.classList.add("tracking"); following = true;
    watchId = navigator.geolocation.watchPosition(updatePosition, locationError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    requestWakeLock();
  }
  function stopTracking() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null; els.track.textContent = "Start live tracking"; els.track.classList.remove("tracking");
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  function applyNavigationMode(enabled) {
    navigationMode = enabled;
    navigationCanvas.hidden = !enabled;
    els.direction.hidden = !enabled;
    els.navigate.classList.toggle("active", enabled);
    els.navigate.textContent = enabled ? "On" : "2.5D";
    els.navigate.setAttribute("aria-label", enabled ? "2.5D navigation on" : "Enable 2.5D navigation");
    document.body.classList.toggle("navigation-mode", enabled);
    if (enabled) {
      following = true;
      renderNavigation();
    } else {
      const ctx = navigationCanvas.getContext("2d");
      ctx?.clearRect(0, 0, navigationCanvas.width, navigationCanvas.height);
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
    if (watchId === null) startTracking();
    if (permission !== "granted") {
      els["direction-label"].textContent = "Move to set direction";
      els["direction-detail"].textContent = "Compass denied · using GPS heading while running";
      els["heading-source"].textContent = "GPS";
    }
  }
  els.track.addEventListener("click", () => watchId === null ? startTracking() : stopTracking());
  els.navigate.addEventListener("click", toggleNavigation);
  els.recenter.addEventListener("click", () => { following = true; if (userMarker) map.setView(userMarker.getLatLng(), 16, { animate: false }); });
  els.overview.addEventListener("click", () => { applyNavigationMode(false); following = false; map.fitBounds(line.getBounds(), { paddingTopLeft: [20, 170], paddingBottomRight: [20, 150] }); });
  map.on("dragstart", () => { following = false; });
  els["help-toggle"].addEventListener("click", () => { const open = els["help-body"].hidden; els["help-body"].hidden = !open; els["help-toggle"].setAttribute("aria-expanded", String(open)); els["help-toggle"].querySelector("span").textContent = open ? "−" : "＋"; });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && watchId !== null) requestWakeLock(); });
  const refreshMapLayout = () => window.requestAnimationFrame(() => { map.invalidateSize({ pan: false, animate: false }); renderNavigation(); });
  window.addEventListener("resize", refreshMapLayout, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(refreshMapLayout, 250), { passive: true });
  window.visualViewport?.addEventListener("resize", refreshMapLayout, { passive: true });
  window.visualViewport?.addEventListener("scroll", refreshMapLayout, { passive: true });
  setTimeout(refreshMapLayout, 100);
  setTimeout(refreshMapLayout, 1000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  function setTestNavigation(heading, enabled = true) {
    deviceHeading = normalizeHeading(heading);
    headingSource = "TEST";
    applyNavigationMode(enabled);
    renderNavigation();
  }
  window.__routeAppTest = { nearestOnCourse, selectCoursePosition, pointAtCourse, bearingBetween, courseBearing, updatePosition, totalMeters, startTracking, stopTracking, setTestNavigation, routeInstruction, maneuverInstruction, nextManeuver, maneuvers, signedHeading };
})();
