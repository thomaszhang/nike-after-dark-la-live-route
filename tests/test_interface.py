from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "styles.css").read_text(encoding="utf-8")
JS = (ROOT / "app.js").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")


def test_heading_smoother_loads_before_app_and_is_cached():
    assert '<meta name="mobile-web-app-capable" content="yes">' in HTML
    assert HTML.index('heading-smoothing.js?v=1') < HTML.index('app.js?v=36')
    assert 'styles.css?v=24' in HTML
    for asset in ('styles.css?v=24', 'leaflet.css?v=1.9.4', 'leaflet.js?v=1.9.4', 'route-data.js?v=2', 'course-elevation.js?v=1', 'heading-smoothing.js?v=1', 'app.js?v=36'):
        assert f'"{asset}"' in SW
    assert re.search(r'\b\w+\.request\.mode\s*===\s*"navigate"', SW)
    assert '"heading-smoothing.js"' not in SW
    assert 'createAngleSmoother({ initialAngle: 0, deadZoneDegrees: 1.5, timeConstantMs: 220 })' in JS
    assert "requestAnimationFrame(drawMapRotation)" in JS
    assert "transition:rotate" not in CSS


def test_tracking_starts_automatically_without_manual_button():
    assert 'id="track"' not in HTML
    assert "Start live tracking" not in HTML
    assert re.search(r"\bstartTracking\(\);\s*(?:\n|if \(\"serviceWorker)", JS)


def test_heading_starts_enabled_and_remains_a_toggle():
    assert 'id="direction-toggle"' in HTML
    assert re.search(r'id="direction-toggle"[^>]*aria-pressed="true"', HTML)
    assert re.search(r"let navigationMode = true\b", JS)
    assert "toggleNavigation" in JS


def test_navigation_is_one_bottom_interface():
    assert 'id="guidance"' not in HTML
    assert HTML.count('aria-live="polite"') == 2
    assert HTML.count('aria-live="assertive"') == 0
    assert 'class="navigation-card" aria-live="polite" aria-atomic="true"' in HTML
    assert CSS.count(".navigation-card {") >= 1
    assert re.search(r"\.navigation-card\s*\{[^}]*bottom:", CSS, re.DOTALL)
    assert "renderGuidance" not in JS
    assert "target.paused" in JS
    assert "els.direction.hidden = Boolean(target && target.paused)" in JS
    assert ".navigation-card[hidden] { display:none; }" in CSS
    assert 'label: "Navigation paused"' not in JS
    assert "MAX_REJOIN_GUIDANCE_METERS = 100" in JS


def test_course_information_uses_requested_title_and_four_columns():
    assert re.search(r"\.stats-card\s*\{[^}]*top:var\(--safe-top\)", CSS, re.DOTALL)
    assert "Nike: After Dark Half Marathon Course (2026)" in HTML
    for label in ("DISTANCE", "REMAINING", "ELEVATION", "STATUS"):
        assert f'>{label}<' in HTML
    assert HTML.index(">DISTANCE<") < HTML.index(">REMAINING<") < HTML.index(">ELEVATION<") < HTML.index(">STATUS<")
    for element_id in ("distance", "remaining", "live-elevation", "course-status"):
        assert f'id="{element_id}"' in HTML
    assert '>ACCURACY<' not in HTML
    for old_label in ("COURSE", "MILE", "FROM ROUTE"):
        assert f'>{old_label}<' not in HTML
    assert "progress follows nearest point on course" not in HTML
    assert "progress follows nearest point on course" not in JS


def test_bottom_bar_has_route_location_and_direction_with_enabled_dots():
    assert 'class="actions-card" aria-label="Map controls"' in HTML
    assert HTML.count('class="control-button') == 3
    assert re.search(r'id="route-control"[^>]*>\s*<span class="enabled-dot"[^>]*></span>\s*Route', HTML)
    assert re.search(r'id="center-control"[^>]*aria-pressed="true"[^>]*>[\s\S]*<span class="control-label">Location</span>[\s\S]*id="location-accuracy"', HTML)
    assert re.search(r"\.control-detail\s*\{[^}]*color:var\(--muted\)[^}]*font-size:", CSS, re.DOTALL)
    assert re.search(r'id="direction-toggle"[^>]*aria-pressed="true"[^>]*>\s*<span class="enabled-dot"[^>]*></span>\s*Direction', HTML)
    assert 'id="recenter"' not in HTML
    assert "recenter-button" not in CSS
    assert "grid-template-columns:repeat(3,1fr)" in CSS
    assert re.search(r"\.control-button\.active\s+\.enabled-dot\s*\{[^}]*background:var\(--enabled\)", CSS, re.DOTALL)
    assert 'id="navigate"' not in HTML
    assert 'id="overview"' not in HTML
    assert "Heading on" not in HTML
    assert "Full route" not in HTML


def test_heading_does_not_rotate_leaflet_input_container():
    assert 'document.getElementById("map").style.rotate' not in JS
    assert "mapElement.style.rotate" not in JS
    assert "headingPane.style.rotate" in JS
    assert "width:100dvw" in CSS
    assert "height:100dvh" in CSS


def test_rotated_map_requests_tiles_for_the_full_viewport_diagonal():
    assert "const RotationBufferedTileLayer = L.TileLayer.extend" in JS
    assert "_getTiledPixelBounds(center)" in JS
    assert "L.TileLayer.prototype._getTiledPixelBounds.call(this, center)" in JS
    assert "Math.hypot(size.x, size.y)" in JS
    assert "bounds.min.subtract(expansion)" in JS
    assert "bounds.max.add(expansion)" in JS
    assert "new RotationBufferedTileLayer(tileUrl" in JS
    assert "keepBuffer: 4" in JS


def test_location_does_not_change_heading_preference():
    handler = re.search(r'els\["center-control"\]\.addEventListener\("click",\s*(\w+)\)', JS)
    assert handler
    function_start = JS.index(f"function {handler.group(1)}()")
    function_end = JS.index("\n  }", function_start)
    assert "toggleNavigation" not in JS[function_start:function_end]


def test_live_location_marker_shows_heading_whenever_known():
    assert "userDirectionIcon" in JS
    assert "refreshUserDirection" in JS
    assert 'element.classList.toggle("has-heading", !hasHeading)' not in JS
    assert 'element.classList.toggle("has-heading", hasHeading)' in JS
    assert 'element.style.setProperty("--user-heading", `${deviceHeading}deg`)' in JS
    assert "refreshUserDirection();" in JS[JS.index("function renderNavigation"):JS.index("function updatePosition")]
    assert "user-direction-arrow" in CSS
    assert re.search(r"\.user-dot:not\(\.has-heading\) \.user-direction-arrow\s*\{[^}]*display:none", CSS, re.DOTALL)


def test_course_uses_stronger_nike_red_and_continuous_inline_chevrons():
    assert 'color: "#e90000"' in JS
    assert re.search(r'color: "#e90000"[^\n]*opacity: \.78', JS)
    assert "route-inline-chevron" in JS
    assert "metersPerPixel * 30" in JS
    assert "iconAnchor: [5, 5]" in JS
    assert "candidate.bearing - 90" in JS
    assert "accepted.screen.distanceTo(candidate.screen) < 20" in JS
    assert "!oppositeBearing(accepted.bearing, candidate.bearing)" in JS
    assert "zIndexOffset: -1000" in JS
    assert "oppositeBearing" in JS
    assert "bearingBetween(previous, next)" in JS
    assert re.search(r"\.route-inline-chevron\s*\{[^}]*background:rgba\(255,255,255,\.96\)[^}]*clip-path:polygon", CSS, re.DOTALL)
    assert "routeArrowMarkers" not in JS
    assert "route-direction-arrow" not in CSS


def test_explicit_location_to_route_selection_disables_direction_and_two_pointer_rotation_is_supported():
    route_handler = JS[JS.index('els["route-control"].addEventListener'):]
    route_handler = route_handler[:route_handler.index("\n  });")]
    assert "selectingRouteFromLocation" in route_handler
    assert "following && !fullRouteMode" in route_handler
    assert "showFullRoute({ disableDirection: selectingRouteFromLocation })" in route_handler
    assert "manualMapRotation" in JS
    assert "activeMapPointers" in JS
    assert "pointerdown" in JS and "pointermove" in JS and "pointerup" in JS and "pointercancel" in JS
    assert "pointerAngle" in JS
    assert "applyNavigationMode(false, { preserveRotation: true })" in JS[JS.index("function beginManualRotation"):JS.index("function updateManualRotation")]
    assert "headingPane.style.rotate" in JS


def test_off_course_transition_defaults_to_route_and_route_press_always_fits_course():
    position = JS[JS.index("function updatePosition"):JS.index("function locationError")]
    route_view = JS[JS.index("function showFullRoute"):JS.index('els["route-control"].addEventListener')]
    assert 'const enteredOffCourse = courseStatus === "Off course" && liveSummary?.status !== "Off course"' in position
    assert 'if (previewDistance !== null) pendingOffCourseRoute = courseStatus === "Off course"' in position
    assert "else if (enteredOffCourse) showFullRoute({ disableDirection: true })" in position
    assert "setMapRotationImmediately(0)" in route_view
    assert "map.invalidateSize({ pan: false, animate: false })" in route_view
    assert "map.fitBounds(routeBounds" in route_view
    assert "showFullRoute({ disableDirection: selectingRouteFromLocation })" in JS


def test_off_course_route_selection_waits_for_active_profile_preview_to_end():
    end_preview = JS[JS.index("function endCoursePreview"):JS.index("function previewFromPointer")]
    assert "pendingOffCourseRoute" in JS
    assert "const showPendingOffCourseRoute = pendingOffCourseRoute" in end_preview
    assert "pendingOffCourseRoute = false" in end_preview
    assert "if (showPendingOffCourseRoute) showFullRoute({ disableDirection: true })" in end_preview


def test_off_course_hides_course_values_but_keeps_preview_values():
    assert "hasCourseProgress" in JS
    assert 'els.distance.textContent = hasCourseProgress ? summaryMiles(liveSummary.progress) : "—"' in JS
    assert 'els.remaining.textContent = hasCourseProgress ? summaryMiles(liveSummary.remaining) : "—"' in JS
    assert 'els["live-elevation"].textContent = hasCourseProgress ? `${Math.round(feet(elevationMeters))} feet` : "—"' in JS
    assert "previewCourseAt" in JS


def test_elevation_profile_is_local_interactive_and_restores_live_state():
    assert 'course-elevation.js?v=1' in HTML
    assert '"course-elevation.js?v=1"' in SW
    assert 'id="elevation-profile"' in HTML
    assert 'aria-label="Course elevation profile. Slide to preview the course."' in HTML
    assert 'aria-orientation="horizontal"' in HTML
    assert 'id="elevation-chart"' in HTML
    assert 'id="elevation-cursor"' in HTML
    assert 'id="elevation-progress"' in HTML
    assert "pointerdown" in JS and "pointermove" in JS
    assert "setPointerCapture" in JS
    assert "previewCourseAt" in JS
    assert "endCoursePreview" in JS
    assert "previewMarker" in JS
    assert "previewSavedView" in JS
    assert "renderLiveSummary" in JS
    assert "api.open-meteo.com" not in JS
    assert "fetch(" not in JS
    assert re.search(r"\.elevation-profile\s*\{[^}]*touch-action:none", CSS, re.DOTALL)


def test_elevation_profile_is_full_width_below_stats_with_live_progress():
    assert HTML.index('id="course-status"') < HTML.index('id="elevation-profile"')
    assert 'id="elevation-value"' not in HTML
    assert "grid-template-columns:minmax(0,1fr) 54px" not in CSS
    assert "elevation-progress" in CSS
    assert "renderElevationProgress(hasCourseProgress ? liveSummary.progress : null)" in JS
    assert 'els["elevation-cursor"].setAttribute("hidden", "")' not in JS


def test_elevation_progress_dot_remains_round_when_chart_stretches():
    assert '<circle id="elevation-progress"' not in HTML
    assert '<span id="elevation-progress"' in HTML
    assert re.search(r"\.elevation-progress\s*\{[^}]*width:8px[^}]*height:8px[^}]*border-radius:50%", CSS, re.DOTALL)
    assert 'els["elevation-progress"].style.left = `${target / totalMeters * 100}%`' in JS
    assert 'els["elevation-progress"].style.top = `${chartY}px`' in JS


def test_profile_preview_follows_course_when_direction_is_on_and_waits_for_tiles():
    preview = JS[JS.index("function previewCourseAt"):JS.index("function endCoursePreview")]
    assert "previewMapRotation" in JS
    assert "previewMapRotation = mapAngleSmoother.getTarget()" in preview
    assert "previewBearing = courseBearing(target)" in preview
    assert "setMapRotationImmediately(navigationMode ? -previewBearing : 0)" in preview
    assert "map.setView(displayedPoint" in preview
    assert 'streetTiles.once("load"' in preview
    assert "map.invalidateSize" in preview


def test_profile_preview_temporarily_selects_route_without_disabling_direction():
    preview = JS[JS.index("function previewCourseAt"):JS.index("function endCoursePreview")]
    end_preview = JS[JS.index("function endCoursePreview"):JS.index("function previewFromPointer")]
    assert "previewSavedControls" in JS
    assert "previewSavedControls = { following, fullRouteMode }" in preview
    assert "setPreviewRouteSelection(true)" in preview
    assert "applyNavigationMode(false)" not in preview
    assert "following = previewSavedControls.following" in end_preview
    assert "setFullRouteMode(previewSavedControls.fullRouteMode)" in end_preview
    assert "previewSavedControls = null" in end_preview


def test_preview_marker_follows_displayed_pass_and_shows_forward_direction():
    preview = JS[JS.index("function previewCourseAt"):JS.index("function endCoursePreview")]
    assert "displayedRoutePoint(target, previewZoom)" in preview
    assert "courseBearing(target)" in preview
    assert "previewDirectionIcon" in preview
    assert "route-preview-direction" in CSS
    assert "route-preview-center" in CSS
    assert "L.marker(displayedPoint" in preview


def test_bidirectional_route_passes_are_separated_with_both_arrow_directions():
    assert "routePassLayer" in JS
    assert "offsetRoutePoint" in JS
    assert "routePassOffsetPixels" in JS
    assert "cluster.forEach(candidate" in JS
    assert "alternatives.length && cell % 2" not in JS
    assert "zIndexOffset" in JS


def test_map_and_interface_follow_system_appearance():
    assert 'media="(prefers-color-scheme: light)"' in HTML
    assert 'media="(prefers-color-scheme: dark)"' in HTML
    assert "prefers-color-scheme: dark" in CSS
    assert "tile.openstreetmap.org" in JS
    assert "dark-appearance" in JS
    assert "light_all" not in JS
    assert "matchMedia" in JS


def test_map_attribution_is_kept_out_of_viewport_but_retained_in_help():
    assert "attributionControl: false" in JS
    assert "attribution:" not in JS
    assert "leaflet-control-attribution" not in CSS
    assert 'href="https://www.openstreetmap.org/copyright"' in HTML
    assert "OpenStreetMap contributors" in HTML


def test_help_describes_automatic_tracking_and_single_bottom_navigation():
    assert "starts automatically" in HTML
    assert "bottom navigation card" in HTML
    assert "top banner" not in HTML
