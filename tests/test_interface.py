from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "styles.css").read_text(encoding="utf-8")
JS = (ROOT / "app.js").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")


def test_heading_smoother_loads_before_app_and_is_cached():
    assert HTML.index('heading-smoothing.js?v=1') < HTML.index('app.js?v=18')
    assert 'styles.css?v=18' in HTML
    for asset in ('styles.css?v=18', 'leaflet.css?v=1.9.4', 'leaflet.js?v=1.9.4', 'route-data.js?v=2', 'course-elevation.js?v=1', 'heading-smoothing.js?v=1', 'app.js?v=18'):
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
    for label in ("DISTANCE", "REMAINING", "STATUS", "ACCURACY"):
        assert f'>{label}<' in HTML
    for element_id in ("distance", "remaining", "course-status", "accuracy"):
        assert f'id="{element_id}"' in HTML
    for old_label in ("COURSE", "MILE", "FROM ROUTE"):
        assert f'>{old_label}<' not in HTML
    assert "progress follows nearest point on course" not in HTML
    assert "progress follows nearest point on course" not in JS


def test_bottom_bar_has_route_center_and_direction_with_enabled_dots():
    assert 'class="actions-card" aria-label="Map controls"' in HTML
    assert HTML.count('class="control-button') == 3
    assert re.search(r'id="route-control"[^>]*>\s*<span class="enabled-dot"[^>]*></span>\s*Route', HTML)
    assert re.search(r'id="center-control"[^>]*aria-pressed="true"[^>]*>\s*<span class="enabled-dot"[^>]*></span>\s*Center', HTML)
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


def test_center_does_not_change_heading_preference():
    handler = re.search(r'els\["center-control"\]\.addEventListener\("click",\s*(\w+)\)', JS)
    assert handler
    function_start = JS.index(f"function {handler.group(1)}()")
    function_end = JS.index("\n  }", function_start)
    assert "toggleNavigation" not in JS[function_start:function_end]


def test_course_uses_transparent_nike_red_and_direction_arrows():
    assert 'color: "#e90000"' in JS
    assert re.search(r'color: "#e90000"[^\n]*opacity: \.34', JS)
    assert "route-direction-arrow" in JS
    assert "routeArrowDistances" in JS
    assert "updateRouteArrowVisibility" in JS
    assert 'map.on("zoomend moveend", updateRouteArrowVisibility)' in JS
    assert "position.distanceTo(other) < 22" in JS
    assert "Math.cos(radians) * 11" in JS
    assert "translateY(11px)" in JS
    assert ">➤</span>" in JS
    assert "bearingBetween(previous, next)" in JS
    assert re.search(r"\.route-direction-arrow\s*\{[^}]*color:#e90000", CSS, re.DOTALL)


def test_elevation_profile_is_local_interactive_and_restores_live_state():
    assert 'course-elevation.js?v=1' in HTML
    assert '"course-elevation.js?v=1"' in SW
    assert 'id="elevation-profile"' in HTML
    assert 'aria-label="Course elevation profile. Slide to preview the course."' in HTML
    assert 'aria-orientation="horizontal"' in HTML
    assert 'id="elevation-chart"' in HTML
    assert 'id="elevation-cursor"' in HTML
    assert 'id="elevation-value"' in HTML
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


def test_map_and_interface_follow_system_appearance():
    assert 'media="(prefers-color-scheme: light)"' in HTML
    assert 'media="(prefers-color-scheme: dark)"' in HTML
    assert "prefers-color-scheme: dark" in CSS
    assert "tile.openstreetmap.org" in JS
    assert "dark-appearance" in JS
    assert "light_all" not in JS
    assert "matchMedia" in JS


def test_help_describes_automatic_tracking_and_single_bottom_navigation():
    assert "starts automatically" in HTML
    assert "bottom navigation card" in HTML
    assert "top banner" not in HTML
