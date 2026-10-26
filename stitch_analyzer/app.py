"""The window: the analyzer page (web/index.html) in a native window, with a native save dialog."""

import argparse
import base64
import binascii
import json
import logging
import os
import socket
import sys
import threading

from . import __version__

log = logging.getLogger("stitch_analyzer")

APP_TITLE = "OpenDecoDesk Stitch Analyzer"
APP_DIR_NAME = "opendecodesk-stitch-analyzer"
# The page keeps its settings in localStorage, which belongs to the page's address (port included),
# so the port must be the same on every run for the settings to be remembered.
HTTP_PORT = 42119
SELF_TEST_TIMEOUT_S = 90

FILE_TYPES = {
    ".dst": "Tajima DST (*.dst)",
    ".dsb": "Barudan DSB (*.dsb)",
    ".dsz": "ZSK DSZ (*.dsz)",
    ".svg": "SVG image (*.svg)",
    ".png": "PNG image (*.png)",
}


def app_dir():
    """The per-user folder for the app's data (same places as OpenDecoDesk Machine Files)."""
    if sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    elif os.name == "nt":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    return os.path.join(base, APP_DIR_NAME)


def web_dir():
    """Where index.html is: inside the PyInstaller bundle when frozen, else next to this file."""
    if getattr(sys, "frozen", False):
        return os.path.join(sys._MEIPASS, "web")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


def port_is_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        # Bind the way the page's web server does, so connections from the last run still closing
        # (TIME_WAIT) don't count as the port being taken. Windows' SO_REUSEADDR means something else.
        if os.name != "nt":
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def pick_port():
    if port_is_free(HTTP_PORT):
        return HTTP_PORT
    port = free_port()
    log.warning("Port %d is in use (is the app already open?); using %d. Settings changed now won't be "
                "remembered.", HTTP_PORT, port)
    return port


class Api:
    """Called from the page as window.pywebview.api.<name>(...)."""

    def __init__(self):
        self._window = None
        self._last_dir = ""

    def attach(self, window):
        self._window = window

    def save_file(self, suggested_name, data_base64):
        """Ask where to save, then write the bytes. Returns {"saved": path}, {"cancelled": True} or
        {"error": message} — the page shows the error."""
        import webview

        try:
            data = base64.b64decode(data_base64, validate=True)
        except (binascii.Error, ValueError, TypeError):
            return {"error": "the file data was not valid"}
        name = os.path.basename(str(suggested_name)) or "design"
        ext = os.path.splitext(name)[1].lower()
        file_types = (FILE_TYPES[ext], "All files (*.*)") if ext in FILE_TYPES else ()
        chosen = self._window.create_file_dialog(
            webview.FileDialog.SAVE, directory=self._last_dir, save_filename=name, file_types=file_types
        )
        if isinstance(chosen, (list, tuple)):
            chosen = chosen[0] if chosen else None
        if not chosen:
            return {"cancelled": True}
        try:
            with open(chosen, "wb") as fh:
                fh.write(data)
        except OSError as e:
            return {"error": e.strerror or str(e)}
        self._last_dir = os.path.dirname(chosen)
        return {"saved": chosen}


# The page counts as working when its scripts, the format code and the save bridge are all there.
SELF_TEST_JS = """JSON.stringify({
  formats: typeof convertToExplicit === 'function' && typeof loadDstBytes === 'function',
  page: typeof exportConverted === 'function' && typeof saveDownload === 'function',
  version: (document.querySelector('.version-stamp') || {}).textContent || '',
  bridge: !!(window.pywebview && window.pywebview.api && window.pywebview.api.save_file)
})"""


def self_test_result(raw):
    """(ok, message) for the JSON SELF_TEST_JS returned."""
    try:
        got = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return False, f"unexpected answer: {raw!r}"
    if not isinstance(got, dict):
        return False, f"unexpected answer: {raw!r}"
    problems = [k for k in ("formats", "page", "bridge") if not got.get(k)]
    if got.get("version") != f"v{__version__}":
        problems.append(f"version {got.get('version')!r} != v{__version__}")
    return (not problems), ("ok" if not problems else "failed: " + ", ".join(problems))


def _run_self_test(window, outcome):
    import time

    if not window.events.loaded.wait(SELF_TEST_TIMEOUT_S):
        outcome["message"] = "the page did not load"
    else:
        deadline = time.monotonic() + 20  # the save bridge is attached just after the page loads
        while True:
            ok, msg = self_test_result(window.evaluate_js(SELF_TEST_JS))
            if ok or time.monotonic() > deadline:
                break
            time.sleep(0.5)
        outcome["ok"], outcome["message"] = ok, msg
    window.destroy()


def main(argv=None):
    parser = argparse.ArgumentParser(prog="stitch_analyzer", description=APP_TITLE)
    parser.add_argument("--self-test", action="store_true",
                        help="open the window, check the page loaded, close it; exit status 0 if it worked")
    parser.add_argument("--version", action="version", version=__version__)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    import webview

    api = Api()
    window = webview.create_window(
        APP_TITLE,
        os.path.join(web_dir(), "index.html"),
        js_api=api,
        width=1280,
        height=860,
        min_size=(900, 600),
        text_select=True,
    )
    api.attach(window)

    storage = os.path.join(app_dir(), "webview")
    os.makedirs(storage, exist_ok=True)
    start = dict(private_mode=False, storage_path=storage, http_port=pick_port())

    if not args.self_test:
        webview.start(**start)
        return

    outcome = {"ok": False, "message": "did not finish"}
    watchdog = threading.Timer(SELF_TEST_TIMEOUT_S + 30, lambda: os._exit(2))
    watchdog.daemon = True
    watchdog.start()
    webview.start(_run_self_test, (window, outcome), **start)
    print(f"self-test {outcome['message']}")
    sys.exit(0 if outcome["ok"] else 1)
