# PyInstaller build: `pyinstaller opendecodesk-stitch-analyzer.spec`
# macOS -> dist/OpenDecoDesk Stitch Analyzer.app (a folder bundle; zip it to share)
# Windows / Linux -> dist/OpenDecoDesk Stitch Analyzer(.exe), one portable file
import sys

NAME = "OpenDecoDesk Stitch Analyzer"

a = Analysis(["run.py"], pathex=["."], datas=[("stitch_analyzer/web", "web")])
pyz = PYZ(a.pure)

if sys.platform == "darwin":
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name=NAME, console=False)
    coll = COLLECT(exe, a.binaries, a.datas, name=NAME)
    app = BUNDLE(
        coll,
        name=NAME + ".app",
        bundle_identifier="org.opendecodesk.stitchanalyzer",
        info_plist={
            "CFBundleShortVersionString": "1.1.0",
            "NSHighResolutionCapable": True,
        },
    )
else:
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name=NAME, console=False)
