
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

  function nearestOnCourse(lat, lon) {
    const cos = Math.cos(toRad(lat));
    let best = { distance: Infinity, along: 0, lat: points[0].lat, lon: points[0].lon };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const ax = toRad(a.lon - lon) * R * cos, ay = toRad(a.lat - lat) * R;
      const bx = toRad(b.lon - lon) * R * cos, by = toRad(b.lat - lat) * R;
      const dx = bx - ax, dy = by - ay;
      const denom = dx * dx + dy * dy;
      const t = denom ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denom)) : 0;
      const x = ax + t * dx, y = ay + t * dy, distance = Math.hypot(x, y);
      if (distance < best.distance) best = { distance, along: cumulative[i - 1] + t * (cumulative[i] - cumulative[i - 1]), lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
    }
    return best;
  }

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

  const els = Object.fromEntries(["track", "recenter", "overview", "course-status", "mile-progress", "remaining", "off-route", "accuracy", "location-error", "help-toggle", "help-body"].map(id => [id, document.getElementById(id)]));
  let watchId = null, userMarker = null, accuracyCircle = null, nearestMarker = null, following = true, wakeLock = null;
  const miles = meters => meters / 1609.344;
  const feet = meters => meters * 3.28084;

  function statusClass(element, name) { element.className = name || ""; }
  function updatePosition(position) {
    const { latitude: lat, longitude: lon, accuracy } = position.coords;
    const nearest = nearestOnCourse(lat, lon);
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
  els.track.addEventListener("click", () => watchId === null ? startTracking() : stopTracking());
  els.recenter.addEventListener("click", () => { following = true; if (userMarker) map.setView(userMarker.getLatLng(), 16, { animate: false }); });
  els.overview.addEventListener("click", () => { following = false; map.fitBounds(line.getBounds(), { paddingTopLeft: [20, 170], paddingBottomRight: [20, 150] }); });
  map.on("dragstart", () => { following = false; });
  els["help-toggle"].addEventListener("click", () => { const open = els["help-body"].hidden; els["help-body"].hidden = !open; els["help-toggle"].setAttribute("aria-expanded", String(open)); els["help-toggle"].querySelector("span").textContent = open ? "−" : "＋"; });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && watchId !== null) requestWakeLock(); });
  const refreshMapLayout = () => window.requestAnimationFrame(() => map.invalidateSize({ pan: false, animate: false }));
  window.addEventListener("resize", refreshMapLayout, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(refreshMapLayout, 250), { passive: true });
  window.visualViewport?.addEventListener("resize", refreshMapLayout, { passive: true });
  window.visualViewport?.addEventListener("scroll", refreshMapLayout, { passive: true });
  setTimeout(refreshMapLayout, 100);
  setTimeout(refreshMapLayout, 1000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  window.__routeAppTest = { nearestOnCourse, updatePosition, totalMeters, startTracking, stopTracking };
})();
