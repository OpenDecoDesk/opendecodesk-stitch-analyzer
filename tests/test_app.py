"""The desktop shell (stitch_analyzer/app.py) and the bundled page. pywebview is replaced by a stub, so
these run with the standard library only."""

import base64
import enum
import json
import os
import re
import socket
import sys
import tempfile
import types
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class _FileDialog(enum.IntEnum):
    OPEN = 10
    FOLDER = 20
    SAVE = 30


sys.modules.setdefault("webview", types.SimpleNamespace(FileDialog=_FileDialog))

from stitch_analyzer import __version__, app  # noqa: E402


class FakeWindow:
    def __init__(self, answer):
        self.answer = answer
        self.calls = []

    def create_file_dialog(self, dialog_type, **kwargs):
        self.calls.append((dialog_type, kwargs))
        return self.answer


def b64(data):
    return base64.b64encode(data).decode()


class SaveFileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def api_answering(self, answer):
        api = app.Api()
        window = FakeWindow(answer)
        api.attach(window)
        return api, window

    def test_writes_the_bytes_where_chosen(self):
        target = os.path.join(self.tmp.name, "LOGO.dsb")
        api, window = self.api_answering(target)
        data = bytes(range(256)) * 3
        self.assertEqual(api.save_file("LOGO.dsb", b64(data)), {"saved": target})
        with open(target, "rb") as fh:
            self.assertEqual(fh.read(), data)
        kind, kwargs = window.calls[0]
        self.assertEqual(kind, _FileDialog.SAVE)
        self.assertEqual(kwargs["save_filename"], "LOGO.dsb")
        self.assertEqual(kwargs["file_types"], ("Barudan DSB (*.dsb)", "All files (*.*)"))

    def test_dialog_answering_with_a_list(self):
        target = os.path.join(self.tmp.name, "a.svg")
        api, _ = self.api_answering((target,))
        self.assertEqual(api.save_file("a.svg", b64(b"<svg/>")), {"saved": target})

    def test_remembers_the_folder_for_the_next_save(self):
        target = os.path.join(self.tmp.name, "one.dst")
        api, window = self.api_answering(target)
        api.save_file("one.dst", b64(b"x"))
        api.save_file("two.dst", b64(b"y"))
        self.assertEqual(window.calls[0][1]["directory"], "")
        self.assertEqual(window.calls[1][1]["directory"], self.tmp.name)

    def test_cancelled(self):
        for answer in (None, (), ""):
            api, _ = self.api_answering(answer)
            self.assertEqual(api.save_file("x.dsz", b64(b"x")), {"cancelled": True})

    def test_bad_data_is_refused_before_asking(self):
        api, window = self.api_answering(os.path.join(self.tmp.name, "x.dst"))
        self.assertEqual(api.save_file("x.dst", "not base64!"), {"error": "the file data was not valid"})
        self.assertEqual(window.calls, [])

    def test_unwritable_place_is_an_error(self):
        api, _ = self.api_answering(os.path.join(self.tmp.name, "missing", "x.dst"))
        self.assertIn("error", api.save_file("x.dst", b64(b"x")))

    def test_suggested_name_is_only_a_name(self):
        api, window = self.api_answering(None)
        api.save_file("../../etc/x.png", b64(b"x"))
        self.assertEqual(window.calls[0][1]["save_filename"], "x.png")

    def test_unknown_extension_has_no_filter(self):
        api, window = self.api_answering(None)
        api.save_file("notes.txt", b64(b"x"))
        self.assertEqual(window.calls[0][1]["file_types"], ())


class PlacesTests(unittest.TestCase):
    def test_app_dir_per_platform(self):
        with mock.patch.object(sys, "platform", "darwin"):
            self.assertTrue(app.app_dir().endswith(os.path.join("Library", "Application Support",
                                                                "opendecodesk-stitch-analyzer")))
        with mock.patch.object(sys, "platform", "win32"), mock.patch.object(os, "name", "nt"), \
                mock.patch.dict(os.environ, {"APPDATA": "C:\\Users\\a\\AppData\\Roaming"}):
            self.assertEqual(app.app_dir(), os.path.join("C:\\Users\\a\\AppData\\Roaming",
                                                         "opendecodesk-stitch-analyzer"))
        with mock.patch.object(sys, "platform", "linux"), mock.patch.object(os, "name", "posix"), \
                mock.patch.dict(os.environ, {"XDG_CONFIG_HOME": "/x/config"}):
            self.assertEqual(app.app_dir(), os.path.join("/x/config", "opendecodesk-stitch-analyzer"))

    def test_web_dir_from_source_has_the_page(self):
        web = app.web_dir()
        for name in ("index.html", "formats.js", os.path.join("fonts", "plex.css")):
            self.assertTrue(os.path.isfile(os.path.join(web, name)), name)

    def test_web_dir_when_frozen(self):
        with mock.patch.object(sys, "frozen", True, create=True), \
                mock.patch.object(sys, "_MEIPASS", "/bundle", create=True):
            self.assertEqual(app.web_dir(), os.path.join("/bundle", "web"))

    @staticmethod
    def listener(port):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if os.name != "nt":
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", port))
        s.listen()
        return s

    def test_port_falls_back_when_taken(self):
        if not app.port_is_free(app.HTTP_PORT):
            self.skipTest("the app's port is in use on this computer")
        self.assertEqual(app.pick_port(), app.HTTP_PORT)
        with self.listener(app.HTTP_PORT):
            with self.assertLogs("stitch_analyzer", "WARNING"):
                port = app.pick_port()
        self.assertNotEqual(port, app.HTTP_PORT)
        self.assertTrue(app.port_is_free(port))

    @unittest.skipIf(os.name == "nt", "TIME_WAIT doesn't block binding on Windows")
    def test_port_still_closing_from_the_last_run_counts_as_free(self):
        port = app.free_port()
        with self.listener(port) as srv:
            client = socket.create_connection(("127.0.0.1", port))
            conn, _ = srv.accept()
            conn.close()  # the server side closes first, so its end waits in TIME_WAIT, as after a run
            client.close()
        self.assertTrue(app.port_is_free(port))


class SelfTestResultTests(unittest.TestCase):
    def answer(self, **kw):
        got = {"formats": True, "page": True, "bridge": True, "version": f"v{__version__}"}
        got.update(kw)
        return json.dumps(got)

    def test_all_there(self):
        self.assertEqual(app.self_test_result(self.answer()), (True, "ok"))

    def test_problems_are_named(self):
        ok, msg = app.self_test_result(self.answer(bridge=False, version="v0.9"))
        self.assertFalse(ok)
        self.assertIn("bridge", msg)
        self.assertIn("v0.9", msg)

    def test_garbage(self):
        self.assertFalse(app.self_test_result("nope")[0])
        self.assertFalse(app.self_test_result(None)[0])


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


class BundleTests(unittest.TestCase):
    def test_versions_agree(self):
        stamp = re.search(r'class="version-stamp">v([\d.]+)<', read("stitch_analyzer", "web", "index.html"))
        spec = re.search(r'"CFBundleShortVersionString": "([\d.]+)"', read("opendecodesk-stitch-analyzer.spec"))
        self.assertEqual(stamp.group(1), __version__)
        self.assertEqual(spec.group(1), __version__)

    def test_works_offline(self):
        allowed = {"http://www.w3.org/2000/svg"}
        for parts in (("index.html",), ("formats.js",), ("fonts", "plex.css")):
            urls = set(re.findall(r"https?://[^\s\"'`)<>]+", read("stitch_analyzer", "web", *parts)))
            self.assertEqual(urls - allowed, set(), os.path.join(*parts))

    def test_fonts_named_in_the_css_are_bundled(self):
        css = read("stitch_analyzer", "web", "fonts", "plex.css")
        names = re.findall(r"url\(([^)]+)\)", css)
        self.assertEqual(len(names), 7)
        for name in names:
            self.assertTrue(os.path.isfile(os.path.join(ROOT, "stitch_analyzer", "web", "fonts", name)), name)

    def test_page_loads_the_format_code_first(self):
        html = read("stitch_analyzer", "web", "index.html")
        self.assertLess(html.index('<script src="formats.js"></script>'), html.index("<script>"))


if __name__ == "__main__":
    unittest.main()
