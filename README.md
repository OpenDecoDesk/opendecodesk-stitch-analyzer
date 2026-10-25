# OpenDecoDesk Stitch Analyzer

A desktop app for checking embroidery designs before they go to a machine, and for converting them
between machine formats. It opens Tajima **.DST**, Barudan **.DSB** and ZSK **.DSZ** files. Everything
runs on your computer: files never leave it, and it works with no internet connection.

- **Design preview:** every stitch drawn to scale, with long stitches (red), short stitches (orange),
  jumps, trims, stops and needle changes marked and numbered, and a list of those events in order.
- **Table:** each stitch longer than the threshold, grouped by needle.
- **Threshold grid:** how many stitches are over each length from 5 to 40 mm.
- **Quality:** stitch lengths by stitch type, satin and fill density, fill angle, layering (where
  stitches pile up), and a run-time estimate, with the biggest issues ranked first.
- **Compare:** load a second design to see what changed between two versions.
- **Convert:**
  - **DST → DSB** (Barudan) and **DST → DSZ** (ZSK), with a **needle map** (which needle each color
    change goes to) and **Trim before stop** (cut the thread before each stop, so the machine pauses
    with the thread already trimmed). A DST color change counts as a stop or a needle change by the
    file's CO count, the way Tajima machines read it.
  - **DSB / DSZ → DST**: stops become a pair of color changes and trims become three jumps.
- It remembers the thresholds and options between runs.

Opening a file: drop it on the left panel, or click the panel to browse. Saving (an SVG of the preview,
a converted file, the layering heatmap) asks where to put it.

### What's checked and what isn't
| | |
|---|---|
| DST → DSB | ✅ run on a Barudan, stops honored. Trim before stop and needle changes are checked in software (read back and compared), not yet on a machine |
| DSB → DST | checked in software only |
| DST → DSZ | ⚠️ written from the only public description of the format ([pyembroidery](https://github.com/EmbroidePy/pyembroidery)'s DSZ reader) and not yet tried on a ZSK — run a short test design first. Three details are best guesses: there's no end-of-design code, needles are numbered 1 = 0x83, 2 = 0x85 … 12 = 0x99, and every record sets the top bit. A DSZ saved by other software would settle them; please open an issue with one. |
| DSZ supports needles 1–12, DSB 1–15 | picking a higher needle shows an error instead of saving |

## Download
From the [Releases](../../releases) page:
- **Windows:** `OpenDecoDesk-Stitch-Analyzer-Windows.exe` — one portable file, no install. It uses
  Microsoft Edge WebView2, which Windows 10 and 11 already have.
- **macOS (Apple Silicon):** unzip `OpenDecoDesk-Stitch-Analyzer-macOS-AppleSilicon.zip`. The app isn't
  signed yet, so the first time, right-click it → Open. On an Intel Mac, run it from source (below).

Only one copy can remember settings at a time: a second copy opened alongside the first still works,
but its setting changes aren't kept.

## Run from source
Python 3.9 or newer:
```bash
python3 -m pip install -r requirements.txt
python3 -m stitch_analyzer
```
The window is [pywebview](https://pywebview.flowrl.com/) showing the page in `stitch_analyzer/web/`;
on Windows it uses Edge WebView2, on macOS the system WebKit. On Linux, pywebview also needs Qt or GTK
(`pip install pywebview[qt]`).

The page also works on its own: open `stitch_analyzer/web/index.html` in a browser. Saving then
downloads the file instead of asking where to put it.

## Tests
```bash
python3 -m unittest discover -s tests -t . -v
node --test tests/formats.test.mjs
```
- `tests/test_app.py` — the desktop shell: saving through the dialog, where settings live, the port,
  the self-test, and that the bundled page needs nothing from the internet. pywebview is stubbed, so
  it needs only the standard library.
- `tests/formats.test.mjs` — the DST, DSB and DSZ code in `stitch_analyzer/web/formats.js`, run in
  Node (22 or newer, no packages): converted files are compared byte for byte with recorded ones
  (`tests/fixtures/conversions.json`) and read back to check every stitch is where it was.

`python3 -m stitch_analyzer --self-test` opens the real window, checks the page, the format code and
the save bridge all loaded, and exits 0 if they did. CI runs it on each built app.

## Making a release
Push a tag like `v1.1.0`, and set the same version in `stitch_analyzer/__init__.py`, the page's
version stamp (`version-stamp` in `stitch_analyzer/web/index.html`) and the spec file — a test checks
they agree. CI runs the tests, builds both apps, self-tests them and publishes them as a release.

## Build the apps yourself
```bash
python3 -m pip install pyinstaller -r requirements.txt
pyinstaller --noconfirm opendecodesk-stitch-analyzer.spec
```

## Related
[OpenDecoDesk Machine Files](https://github.com/OpenDecoDesk/opendecodesk-machine-files) copies designs
between a folder and a SmartStitch machine on your network.

Tajima, Barudan and ZSK are their owners' brands; this project isn't affiliated with or endorsed by any
of them.

## Licence
[GNU AGPL-3.0](LICENSE). The bundled IBM Plex fonts are under the SIL Open Font License
([stitch_analyzer/web/fonts/OFL.txt](stitch_analyzer/web/fonts/OFL.txt)).
