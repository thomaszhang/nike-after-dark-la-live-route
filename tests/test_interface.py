from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "styles.css").read_text(encoding="utf-8")
JS = (ROOT / "app.js").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")


def test_heading_smoother_loads_before_app_and_is_cached():
    assert HTML.index('heading-smoothing.js?v=1') < HTML.index('app.js?v=12')
    assert 'styles.css?v=11' in HTML
    for asset in ('styles.css?v=11', 'leaflet.css?v=1.9.4', 'leaflet.js?v=1.9.4', 'route-data.js?v=2', 'heading-smoothing.js?v=1', 'app.js?v=12'):
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
    assert 'id="navigate"' in HTML
    assert 'aria-pressed="true"' in HTML
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


def test_course_information_stays_at_top_and_center_is_bottom_right():
    assert re.search(r"\.stats-card\s*\{[^}]*top:var\(--safe-top\)", CSS, re.DOTALL)
    assert 'id="recenter"' in HTML
    assert re.search(r"\.recenter-button\s*\{[^}]*right:", CSS, re.DOTALL)
    assert re.search(r"\.recenter-button\s*\{[^}]*bottom:", CSS, re.DOTALL)


def test_heading_does_not_rotate_leaflet_input_container():
    assert 'document.getElementById("map").style.rotate' not in JS
    assert "mapElement.style.rotate" not in JS
    assert "headingPane.style.rotate" in JS
    assert "width:100dvw" in CSS
    assert "height:100dvh" in CSS


def test_recenter_does_not_change_heading_preference():
    handler = re.search(r'els\.recenter\.addEventListener\("click",\s*(\w+)\)', JS)
    assert handler
    function_start = JS.index(f"function {handler.group(1)}()")
    function_end = JS.index("\n  }", function_start)
    assert "toggleNavigation" not in JS[function_start:function_end]


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
