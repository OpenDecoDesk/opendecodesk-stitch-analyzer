"""The release version: YYYY.MM.DD.NN, the UTC date of the release and that day's build number (01, 02 …).

The source always says "dev"; CI works out the version when it publishes a release and stamps it into
the files before building.

  git ls-remote --tags --refs origin | python3 scripts/release_version.py next   # prints e.g. 2026.11.01.01
  python3 scripts/release_version.py stamp 2026.11.01.01                         # writes it into the files
"""

import datetime
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV = "dev"
VERSION_RE = re.compile(r"^(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})$")

# (file, pattern): each must match once; the version replaces group 2, between groups 1 and 3.
PAGE = os.path.join("stitch_analyzer", "web", "index.html")
STAMPS = [
    (os.path.join("stitch_analyzer", "__init__.py"), r'^(__version__ = ")([^"\n]*)(")'),
    (PAGE, r"(<title>OpenDecoDesk Stitch Analyzer )([^<]*)(</title>)"),
    (PAGE, r'(<span class="version-stamp">)([^<]*)(</span>)'),
    # The page's own files carry the version in their addresses, so a new version never gets an
    # earlier one's copy from the window's cache (app.py does the same for the page itself).
    (PAGE, r'(<link rel="stylesheet" href="fonts/plex\.css\?v=)([^"]*)(">)'),
    (PAGE, r'(<script src="formats\.js\?v=)([^"]*)("></script>)'),
]


def next_version(tags, today=None):
    """The version for a release made today (UTC): the day's next build number after the tags there."""
    today = today or datetime.datetime.now(datetime.timezone.utc).date()
    day = today.strftime("%Y.%m.%d")
    taken = [0]
    for tag in tags:
        name = tag.strip().split("refs/tags/")[-1]  # a plain tag name or a line of `git ls-remote --tags`
        m = re.fullmatch(r"v" + re.escape(day) + r"\.(\d{2})", name)
        if m:
            taken.append(int(m.group(1)))
    n = max(taken) + 1
    if n > 99:
        raise ValueError(f"already 99 releases on {day}")
    return f"{day}.{n:02d}"


def bundle_versions(version):
    """(CFBundleShortVersionString, CFBundleVersion) for the Mac app. Apple wants at most three numbers in
    each, so 2026.11.01.02 is 2026.11.01 and 2026.11.0102; a dev build is 0.0.0 and 0."""
    m = VERSION_RE.match(version)
    if not m:
        return "0.0.0", "0"
    y, mo, d, n = m.groups()
    return f"{y}.{mo}.{d}", f"{y}.{mo}.{d}{n}"


def read_version(root=ROOT):
    with open(os.path.join(root, "stitch_analyzer", "__init__.py"), encoding="utf-8") as fh:
        return re.search(r'^__version__ = "([^"]*)"$', fh.read(), re.M).group(1)


def stamp(version, root=ROOT):
    """Write the version into __init__.py and the page (its <title>, version stamp and file addresses)."""
    if version != DEV and not VERSION_RE.match(version):
        raise ValueError(f"not a version: {version!r}")
    for name, pattern in STAMPS:
        path = os.path.join(root, name)
        with open(path, encoding="utf-8", newline="") as fh:
            text = fh.read()
        text, count = re.subn(pattern, lambda m: m.group(1) + version + m.group(3), text, flags=re.M)
        if count != 1:
            raise ValueError(f"{name}: expected one match for {pattern!r}, found {count}")
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)


def main(argv):
    if argv[:1] == ["next"] and len(argv) == 1:
        print(next_version(sys.stdin))
    elif argv[:1] == ["stamp"] and len(argv) == 2:
        stamp(argv[1])
        print(f"stamped {argv[1]}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
