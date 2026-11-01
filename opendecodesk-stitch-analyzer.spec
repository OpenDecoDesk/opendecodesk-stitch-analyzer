# PyInstaller build: `pyinstaller opendecodesk-stitch-analyzer.spec`
# macOS -> dist/OpenDecoDesk Stitch Analyzer.app (a folder bundle; zip it to share)
# Windows / Linux -> dist/OpenDecoDesk Stitch Analyzer(.exe), one portable file
import os
import sys

sys.path.insert(0, os.path.join(SPECPATH, "scripts"))
from release_version import bundle_versions, read_version  # noqa: E402

NAME = "OpenDecoDesk Stitch Analyzer"
# The Mac app's version numbers come from __version__ (stamped by CI for a release, "dev" otherwise).
SHORT_VERSION, BUNDLE_VERSION = bundle_versions(read_version(SPECPATH))

a = Analysis(["run.py"], pathex=["."], datas=[("stitch_analyzer/web", "web")])
pyz = PYZ(a.pure)

if sys.platform == "darwin":
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name=NAME, console=False)
    coll = COLLECT(exe, a.binaries, a.datas, name=NAME)
    app = BUNDLE(
        coll,
        name=NAME + ".app",
        icon="icons/icon.icns",
        bundle_identifier="org.opendecodesk.stitchanalyzer",
        info_plist={
            "CFBundleShortVersionString": SHORT_VERSION,
            "CFBundleVersion": BUNDLE_VERSION,
            "NSHighResolutionCapable": True,
        },
    )
else:
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name=NAME, console=False, icon="icons/icon.ico")
