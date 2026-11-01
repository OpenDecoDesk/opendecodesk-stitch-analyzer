"""The release version (scripts/release_version.py): working out the next one, and stamping it in."""

import datetime
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import release_version as rv  # noqa: E402

DAY = datetime.date(2026, 11, 1)


class NextVersionTests(unittest.TestCase):
    def test_first_release_of_the_day(self):
        self.assertEqual(rv.next_version([], DAY), "2026.11.01.01")
        self.assertEqual(rv.next_version(["v0.1.0", "v0.1.1", "v2026.10.31.04"], DAY), "2026.11.01.01")

    def test_after_the_highest_of_the_day(self):
        tags = ["v2026.11.01.01", "v2026.11.01.03", "v2026.11.01.02"]
        self.assertEqual(rv.next_version(tags, DAY), "2026.11.01.04")

    def test_reads_git_ls_remote_lines(self):
        lines = ["723ce42\trefs/tags/v0.1.1\n", "c6a3004\trefs/tags/v2026.11.01.01\n",
                 "c6a3004\trefs/tags/v2026.11.01.01^{}\n"]
        self.assertEqual(rv.next_version(lines, DAY), "2026.11.01.02")

    def test_ignores_tags_that_only_look_close(self):
        tags = ["v2026.11.01.1", "v2026.11.01.001", "2026.11.01.05", "v2026.11.01.07-test"]
        self.assertEqual(rv.next_version(tags, DAY), "2026.11.01.01")

    def test_uses_todays_utc_date(self):
        today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y.%m.%d")
        self.assertEqual(rv.next_version([]), today + ".01")

    def test_two_digits_at_most(self):
        tags = [f"v2026.11.01.{n:02d}" for n in range(1, 100)]
        with self.assertRaises(ValueError):
            rv.next_version(tags, DAY)


class BundleVersionTests(unittest.TestCase):
    def test_release(self):
        self.assertEqual(rv.bundle_versions("2026.11.01.02"), ("2026.11.01", "2026.11.0102"))

    def test_dev(self):
        self.assertEqual(rv.bundle_versions("dev"), ("0.0.0", "0"))


class StampTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for name in (os.path.join("stitch_analyzer", "__init__.py"), rv.PAGE):
            os.makedirs(os.path.dirname(os.path.join(self.root, name)), exist_ok=True)
            shutil.copy(os.path.join(ROOT, name), os.path.join(self.root, name))

    def page(self):
        with open(os.path.join(self.root, rv.PAGE), encoding="utf-8") as fh:
            return fh.read()

    def test_stamps_the_source_the_title_and_the_header(self):
        rv.stamp("2026.11.01.01", self.root)
        self.assertEqual(rv.read_version(self.root), "2026.11.01.01")
        page = self.page()
        self.assertIn("<title>OpenDecoDesk Stitch Analyzer 2026.11.01.01</title>", page)
        self.assertIn('<span class="version-stamp">2026.11.01.01</span>', page)
        self.assertNotIn(">dev<", page)

    def test_leaves_the_rest_alone(self):
        before = self.page()
        rv.stamp("2026.11.01.01", self.root)
        rv.stamp("dev", self.root)
        self.assertEqual(self.page(), before)
        self.assertEqual(rv.read_version(self.root), "dev")

    def test_windows_line_endings(self):
        path = os.path.join(self.root, "stitch_analyzer", "__init__.py")
        with open(path, "w", encoding="utf-8", newline="\r\n") as fh:
            fh.write('"""x"""\n\n__version__ = "dev"\n')
        rv.stamp("2026.11.01.01", self.root)
        with open(path, "rb") as fh:
            self.assertEqual(fh.read(), b'"""x"""\r\n\r\n__version__ = "2026.11.01.01"\r\n')

    def test_refuses_a_bad_version(self):
        for bad in ("v2026.11.01.01", "2026.11.1.1", "0.1.2", ""):
            with self.assertRaises(ValueError):
                rv.stamp(bad, self.root)
        self.assertEqual(rv.read_version(self.root), "dev")


if __name__ == "__main__":
    unittest.main()
