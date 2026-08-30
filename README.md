# Nike After Dark LA 2026 Live Course

A phone-first live course tracker for the Nike After Dark Tour Los Angeles half marathon. It uses the official 834-point course polyline to show location, course progress, remaining distance, heading-up guidance, and safe rejoin directions.

This is a static progressive web app: there is no application server, account, or build step.

## Features

- Starts precise GPS tracking automatically after location permission is granted.
- Matches each location fix to the most plausible point on the course, including crossings and nearby parallel segments.
- Shows completed distance, distance remaining, course status, and GPS accuracy in a four-column summary.
- Draws the course in translucent Nike red with directional arrows so overlapping out-and-back sections remain distinguishable without hiding the basemap.
- Includes a compact elevation profile; slide across it to preview distance and a corresponding point on the route, then release to return to live tracking.
- Rotates only the visual map panes for heading-up navigation, so touch dragging stays aligned with the screen.
- Smooths compass changes with a 1.5° dead zone and 220 ms response curve.
- Detects upcoming course turns from the route geometry.
- Follows the phone's light or dark appearance.
- Can be installed on an iPhone Home Screen.
- Caches the application shell and route data for offline startup.

## Navigation behavior

The bottom navigation card changes with distance from the route:

| Distance from course | Behavior |
| --- | --- |
| 0–30 m | Normal course and turn guidance |
| More than 30 m through 100 m | Direction and distance back to the nearest course point |
| More than 100 m (about 328 ft) | Navigation card hidden; the top status still reports that the runner is off course |

The card returns automatically after the location is again within 100 m of the course. Route, Center, and Direction remain available while the card is hidden.

These cues are a convenience, not authoritative race-day directions. Follow event staff, signs, closures, and official course updates.

## Run locally

Requirements:

- Node.js 18 or newer
- Python 3 with `pytest`

No package installation is needed. From this directory:

```sh
npm run serve
```

Open <http://127.0.0.1:8765>. Browsers permit geolocation on localhost. A non-local deployment must use HTTPS for location, orientation permission, service workers, and Home Screen installation to work reliably.

You can also run the server directly:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

## Use on iPhone

1. Open the HTTPS deployment in Safari.
2. Allow precise location when prompted.
3. Tap **Direction** if Safari asks separately for motion/orientation access.
4. Optionally choose **Share → Add to Home Screen**.
5. Keep the page visible during the run. iOS may pause browser location updates after the screen locks, even though the app requests a screen wake lock where supported.

Controls:

- **Route** fits and centers the complete course.
- **Center** returns the map to the current location after Route or manual dragging.
- **Direction** switches heading-up rotation on or off and starts enabled.
- Green dots show which controls are active.
- **More info** opens the in-app usage notes and official race link.

## Privacy and network use

Raw GPS and compass readings stay in browser memory. The app has no analytics, account system, location API, or application backend, and it does not persist location history.

The browser does request OpenStreetMap tiles for the visible map. As with any web map, the tile provider receives normal request metadata and the requested tile coordinates, which identify the displayed map area. The service worker caches same-origin application files; it does not add location storage.

## Offline behavior

After one successful online load, the service worker caches HTML, CSS, JavaScript, route data, Leaflet, icons, and marker images. The tracker can then start without a network connection.

OpenStreetMap tiles are hosted separately. Previously viewed tiles may remain in the browser cache, but uncached areas need network access and can appear blank offline. Course geometry, progress calculations, navigation, and GPS processing do not depend on a remote API.

## Course data

`route-data.js` contains the official source polyline and mile markers from:

<https://www.afterdarktour.nike.com/en/la>

`course-elevation.js` contains 101 terrain samples along that polyline. Elevation is based on the Copernicus DEM 2021 GLO-90 dataset at 90 m resolution, retrieved through the Open-Meteo Elevation API on 2026-08-30:

<https://open-meteo.com/en/docs/elevation-api>

The sampled profile is stored locally. The live app does not send coordinates to an elevation service.

The official page advertises 13.1 miles. Its current source polyline measures approximately 13.32 miles. Race-day closures and course revisions can differ, so re-check Nike's official page before the event.

## Development

Run all tests:

```sh
npm test
```

Run syntax checks and all tests:

```sh
npm run check
```

The test suite uses Node's built-in test runner for angle smoothing and navigation visibility, plus `pytest` for document, interface, service-worker, and asset contracts.

When changing a cached file:

1. Change the asset query version in `index.html`.
2. Put that exact versioned URL in `SHELL` in `sw.js`.
3. Increment the service-worker cache name.
4. Update the matching assertions in `tests/test_interface.py`.
5. Verify one online load followed by an offline reload.

See [DESIGN.md](DESIGN.md) for data flow, course matching, heading smoothing, safety behavior, and maintenance details.

## Project layout

| Path | Purpose |
| --- | --- |
| `README.md` | Setup, usage, privacy, offline behavior, and development workflow |
| `DESIGN.md` | Data flow, course matching, navigation rules, and maintenance constraints |
| `package.json` | Dependency-free serve, test, and check command aliases |
| `index.html` | Application structure, controls, accessibility text, and asset versions |
| `styles.css` | Responsive phone layout and system light/dark appearance |
| `app.js` | Course matching, GPS/compass handling, map rendering, and navigation |
| `heading-smoothing.js` | Testable shortest-angle smoothing module |
| `route-data.js` | Course polyline, start/finish, and mile markers |
| `sw.js` | Offline application-shell cache |
| `manifest.webmanifest` | Installable web-app metadata |
| `leaflet.js`, `leaflet.css` | Vendored Leaflet runtime and styles |
| `tests/` | Node and Python tests |

## Attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Leaflet is vendored locally so the application shell can start offline.
