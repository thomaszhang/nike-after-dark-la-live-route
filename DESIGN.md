# Design

## Scope

Nike After Dark LA Live Course is a static browser application for one fixed race route. It intentionally avoids a backend, user accounts, build tooling, and runtime dependencies beyond browser APIs and the vendored Leaflet files.

The main design goals are:

- keep location processing on the phone;
- provide readable, phone-sized course status while moving;
- avoid misleading turn instructions when the runner is clearly away from the course;
- remain useful after connectivity drops;
- preserve ordinary screen-aligned touch gestures while the visual map rotates.

## Runtime data flow

1. `route-data.js` assigns the course polyline, start, finish, and mile markers to `window.NIKE_ROUTE`.
2. `app.js` converts the polyline into latitude/longitude objects and precomputes cumulative segment lengths.
3. `navigator.geolocation.watchPosition()` produces location fixes.
4. Each fix is compared with every course segment to find nearby projected points.
5. `selectCoursePosition()` scores plausible candidates using distance, recent progress, GPS accuracy, speed, and travel heading. This reduces jumps at crossings and nearby parallel segments.
6. The selected point updates progress, remaining distance, off-course status, user/route markers, and navigation guidance.
7. Compass events or movement-derived GPS headings update the heading target.
8. The elevation profile reads locally stored Copernicus DEM samples. Trusted live progress moves a persistent graph cursor and fixed-size HTML dot, avoiding distortion from the chart SVG's nonuniform scaling. Pointer movement interpolates a course distance, temporarily selects Route instead of Location, updates the summary, and first centers a street-level view on the same screen-offset route pass that is rendered. Direction-on preview then uses shortest-angle smoothing to rotate around that fixed screen center until the selected course bearing points toward screen top; Direction-off preview remains north-up. Release restores the newest live summary plus the saved controls, map view, and rotation.
9. `heading-smoothing.js` advances the visible map angle on animation frames.

No fix is sent to an application server or written to persistent project storage.

## Course matching

`courseCandidates(lat, lon)` projects the current location onto each route segment using a local planar approximation around the fix. Each candidate contains:

- distance from the location to the segment;
- distance along the whole course;
- projected latitude and longitude;
- source segment index.

The nearest segment alone is ambiguous where the route crosses or doubles back. `selectCoursePosition()` considers candidates close to the nearest one and adds penalties for:

- course direction conflicting with a reliable movement heading;
- large backwards jumps;
- progress jumps that are not plausible for elapsed time, speed, and reported accuracy.

The result is still an estimate. GPS error, tunnels, dense buildings, and course changes can produce incorrect progress.

## Heading sources and smoothing

Heading uses the best recent signal available:

1. movement calculated from multiple GPS fixes;
2. the native geolocation heading when paired with plausible movement speed;
3. device orientation/compass when GPS direction is stale or the runner is moving slowly.

Incoming headings are angle-aware: differences use the shortest path across 359°/0°. The visual map rotation then uses `createAngleSmoother()` with:

- 1.5° dead zone to suppress stationary sensor chatter;
- 220 ms response time for visible easing;
- 0.05° settled threshold;
- elapsed-time-based interpolation for consistent behavior across frame rates.

Only Leaflet's visual panes are placed inside `.leaflet-heading-pane` and rotated. The `#map` input container remains unrotated, so a rightward finger drag remains rightward on screen at any heading. A two-pointer bearing gesture rotates the visual pane manually, disables Direction, and saves that rotation until Route resets north-up or Direction resumes heading-up. The tile layer expands Leaflet's requested pixel bounds to the viewport diagonal, so the rotated rectangle's corners remain covered at every angle instead of exposing unloaded edges.

The blue marker stays at the raw browser geolocation fix; its circle shows reported GPS uncertainty. When either movement-derived GPS direction or compass direction is known, a pointer on that marker rotates to the geographic heading independently of whether Direction mode is enabled. Course progress remains a separate route projection and does not move the blue marker onto the course.

## Navigation and off-course safety

The route geometry is scanned at startup for changes of at least 40°, and nearby detections are grouped into one maneuver. Turn instructions are based on the next detected maneuver and its distance ahead.

Distance from course controls which guidance is allowed:

- 0–30 m: next course maneuver;
- more than 30 m through 100 m: direction to the nearest course point;
- more than 100 m: no bottom navigation card.

The 100 m rule prevents a direct bearing to a distant course point from being presented as a valid street-level route. The top card still reports `Off course`, but Distance, Remaining, and Elevation show `—` because course progress is not trustworthy that far away. Route and Location, including their Direction settings, remain usable. GPS updates automatically restore the navigation card and course values after returning within range.

These thresholds are product behavior and safety behavior. Change them only with corresponding tests, documentation, and real-location or browser verification.

## Map appearance and controls

The application follows `prefers-color-scheme`. OpenStreetMap provides the map tiles; dark appearance is applied locally to the map presentation rather than switching to a credentialed tile provider. The distracting Leaflet attribution overlay is disabled; required OpenStreetMap contributor credit remains accessible under More info.

The interface is styled like a handled race-day field guide rather than a generated dashboard. Warm paper and charcoal replace pure white and black. Very light CSS-only grain stays inside cards, edges and radii vary by a few pixels, and small red marks give the information and help cards a printed accent. These variations are deterministic and restrained: body copy remains system type, controls retain 48 px tap targets, and no texture covers map labels.

The rendered course uses three copies of the same screen-offset geometry: a soft dark shadow, a warm paper under-stroke, and opaque Nike-red ink. Sparser white direction stitches replace the former continuous zipper of polygon arrows. The official coordinates used for distance and matching are unchanged. Mile pins get slight repeatable tilt; at the fitted overview zoom they shrink and alternate left/right around their exact anchored course point to reduce overlap. Street-level pins remain full size. The live location marker uses a softly pulsing irregular blue center and one attached compass needle rather than stacked polygon arrows. `prefers-reduced-motion` removes the pulse.

Reconsider the material treatment if it obscures street names in outdoor use, makes the course less visible against a changed tile style, or causes text/control contrast to fail. Do not add random runtime variation: screenshots and map state should remain repeatable, and route geometry must never be changed for visual texture.

The bottom bar has two mutually exclusive primary views: Route, Location, or neither after manual dragging. Selecting Route resets north-up and fits the complete course; selecting Location returns to the live fix. Pressing the already-selected view toggles its own remembered Direction preference. Location Direction starts on and provides heading-up following with the center led approximately 70 m ahead. Route Direction starts off and only rotates an active profile preview to its selected course bearing; the persistent fitted Route view remains north-up. Switching primary views does not alter either preference. When status transitions to Off course, Route is selected and fitted without changing either Direction preference. A later manual Location selection remains respected until status recovers and becomes Off course again.

The official coordinates remain unchanged for matching, mileage, and elevation. Rendering shifts each pass 5 screen pixels to the right of its travel direction. Opposing out-and-back passes therefore appear as parallel 4 px Nike-red tracks about 10 pixels apart instead of one collapsed line. Repeated white chevrons use the same shifted pass coordinates; opposite bearings are retained rather than filtering one direction out. Mile labels are regenerated from exact one-mile course distances and shifted through the same directional-pass function, rather than rendering the original unshifted GPX marker coordinates. Pass geometry, chevrons, and mile labels are recalculated after zoom or movement so screen-space separation remains consistent.

## Offline and cache updates

`sw.js` precaches the application shell under a named cache. Asset URLs include query versions because cache keys include the full request URL. The service worker must therefore cache the exact strings requested by `index.html`.

For any changed cached asset:

1. bump its query version in `index.html`;
2. make the same change in `SHELL` in `sw.js`;
3. increment `CACHE` so old shells are removed after activation;
4. update static cache assertions;
5. load once online, disable network, and reload to verify startup.

Navigation requests fall back to the cached application root. Missing scripts and styles do not receive HTML fallback responses.

Map tiles are cross-origin and are not added to the application-shell cache. Offline map coverage depends on the browser's existing tile cache.

## Privacy and security

The project has no location upload code, cookies, account tokens, analytics, or application database. Browser memory contains the current fix and a short GPS history used to calculate movement heading.

Network traffic consists of:

- same-origin static files from the chosen host;
- OpenStreetMap tile requests;
- the user-initiated link to Nike's official race page.

A deployed copy should use HTTPS. Do not add credentials to client-side files; all browser-delivered code is public.

## Testing strategy

- `tests/test_heading_smoothing.js` checks dead-zone behavior, convergence, north wraparound, and frame-rate consistency.
- `tests/test_off_course_visibility.js` protects the far-off-course card behavior and safe rejoin path.
- `tests/test_interface.py` checks document structure, automatic tracking, asset/cache versions, appearance integration, unrotated input handling, and accessibility properties.

`window.__routeAppTest` exposes calculation and state hooks for real-browser verification without changing normal behavior.

Before shipping changes, run:

```sh
npm run check
git diff --check
```

For navigation, layout, orientation, or cache changes, also exercise a phone-sized browser and perform an offline reload.

## Known limits

- Browser GPS can pause when iOS locks the screen.
- Compass readings vary by device, magnetic interference, and permission state.
- Turn maneuvers are inferred from route geometry; they do not know street names, closures, barriers, or race-day instructions.
- The app does not calculate a street-network route back to the course.
- The source polyline currently measures longer than the advertised race distance.
- Uncached basemap areas require network access.
