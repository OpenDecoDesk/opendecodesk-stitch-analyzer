# OpenDecoDesk Stitch Analyzer

A desktop app for checking embroidery designs before they go to a machine, and for converting them
between machine formats. It opens Tajima **.DST**, Barudan **.DSB** and ZSK **.DSZ** files, and about 25
more machine formats (see [Formats](#formats)): Brother .PES, Janome .JEF, Melco .EXP, Pfaff and Viking
.VP3 and others. Everything runs on your computer: files never leave it, and it works with no internet
connection.

- **Design preview:** every stitch drawn to scale, with long stitches (red), short stitches (orange),
  jumps, trims, stops and needle changes marked and numbered, and a list of those events in order.
  **Thread colors** draws the stitches in the colors the file names (PES, VP3, XXX, JEF and others, and
  DSTs whose header lists `TC:` threads), or in a palette where it names none; light threads get a grey
  edge. The events list, the table and the needle map show each block's thread and its name either way.
- **Table:** each stitch longer than the threshold, grouped by needle.
- **Threshold grid:** how many stitches are over each length from 5 to 40 mm.
- **Quality:** stitch lengths by stitch type, satin and fill density, fill angle, layering (where
  stitches pile up), and a run-time estimate, with the biggest issues ranked first.
- **Design size:** jumps that travel outside the stitches, such as an end point left above the
  design, are marked in red on the preview with a note. Machines count those moves in the design's
  size, so one can refuse a hoop the stitches fit or show the far point as a stray stitch.
- **Compare:** load a second design to see what changed between two versions.
- **Convert:**
  - **DST → DSB** (Barudan) and **DST → DSZ** (ZSK), with a **needle map** (which needle each color
    change goes to) and **Trim before stop** (cut the thread before each stop, so the machine pauses
    with the thread already trimmed). A DST color change counts as a stop or a needle change by the
    file's CO count, the way Tajima machines read it.
  - **DSB / DSZ → DST**: stops become a pair of color changes and trims become three jumps.
  - **Any other format → DST**, the same way: each color change stays a color change, stops become a pair
    of color changes and trims three jumps.
  - **Any format → DSB or DSZ**, DSB → DSZ and DSZ → DSB included, with the same needle map and Trim before
    stop. The map starts from the needles the file names (DSB, DSZ, U01, TBF, KSM …), else 1, 2, 3 …;
    stops and trims the file has are kept.
- It remembers the thresholds and options between runs.

Opening a file: drop it on the left panel, or click the panel to browse. Saving (an SVG of the preview,
a converted file, the layering heatmap) asks where to put it.

### What's checked and what isn't
| | |
|---|---|
| DST → DSB | ✅ run on a Barudan, stops honored. Every move matches, byte for byte, the DSB a Barudan writes when it converts the same DST itself. Trim before stop and needle changes are checked in software (read back and compared), not yet on a machine |
| DSB direction | Y points up, as in DST: bit 0x40 marks a move down, bit 0x20 a move left. Checked against DSBs a Barudan wrote from DSTs (versions before this check read and wrote DSB upside down) |
| DSB → DST | checked in software only |
| DST → DSZ | ⚠️ written from the only public description of the format ([pyembroidery](https://github.com/EmbroidePy/pyembroidery)'s DSZ reader) and not yet tried on a ZSK — run a short test design first. Four details are best guesses: bit 0x20 marks a move down, read the same way as DSB's 0x40, whose direction a Barudan confirmed, there's no end-of-design code, needles are numbered 1 = 0x83, 2 = 0x85 … 12 = 0x99, and every record sets the top bit. A DSZ saved by other software would settle them; please open an issue with one. |
| DSZ supports needles 1–12, DSB 1–15 | picking a higher needle shows an error instead of saving |
| The other formats | read the way [pyembroidery](https://github.com/EmbroidePy/pyembroidery) reads them (see [Formats](#formats)); none checked against a machine yet |

### Formats
Besides DST, DSB and DSZ, the app opens the formats below. Their record layouts and the makers' thread
charts are ported from pyembroidery, by way of OpenDecoDesk's Designs page, which reads the same files.
Each keeps its own trims, stops and needle numbers. A file is read by its extension; one with the wrong
extension, or none, is still read if it starts with `#PES`, `#PEC` or `%vsm%`. Design-software project
files (.EMB, .ART, .JAN, .OFM …) are closed formats: export a machine file from that software instead.

Checked against pyembroidery means the test files were written by pyembroidery, and this app reads them
stitch for stitch, trim for trim, the way pyembroidery reads them back. Made-up files means each record
type was checked with files built byte by byte in the tests. Nothing in this table has been checked
against files from the makers' own software yet; please open an issue with one that reads wrong.

| Format | Maker | Thread colors from the file | Checked |
|---|---|---|---|
| .PES, .PEC | Brother | PES v5+: brand, code, name and color; otherwise Brother's chart | against pyembroidery (PES v1 and v6, PEC) |
| .PHB, .PHC | Brother | Brother's chart | reader only |
| .JEF | Janome | Janome's chart, with thread numbers | against pyembroidery |
| .SEW | Janome | Janome's chart | reader only |
| .EXP | Melco | none | against pyembroidery |
| .STX | Data Stitch | none | made-up files |
| .VP3 | Pfaff, Husqvarna Viking | brand, code, name and color | against pyembroidery |
| .HUS | Husqvarna Viking | Viking's chart, with thread numbers | made-up files |
| .SHV | Husqvarna Viking | Viking's chart | reader only; larger files have a header it doesn't know and are refused |
| .PCS, .PCM | Pfaff | PCS: colors; PCM: Pfaff's 16 colors | made-up files (PCS) |
| .KSM, .MAX | Pfaff | none | made-up files (KSM) |
| .XXX | Singer | colors | against pyembroidery |
| .U01 | Barudan | none; needle numbers | against pyembroidery |
| .TBF | Tajima | colors by needle; needle numbers | against pyembroidery |
| .TAP | Happy | none | made-up files |
| .GT | Gold Thread | none; needle numbers | made-up files |
| .10O | Toyota | none | made-up files |
| .INB | Inbro | none | made-up files |
| .NEW | Ameco | none | made-up files |
| .EMD | Elna | none | made-up files |
| DST with `TC:` lines | — | some design software lists each color's thread in the DST header; those are read | made-up files |

**Trims.** DST and TAP have no trim command: three jumps in a row count as a trim, as Tajima machines read
them. JEF, SEW, PCS, PCM, INB, NEW and SHV have none either: a jump run of more than 3 mm gets a trim, as
pyembroidery reads them. The rest have their own trim command.

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
node --test tests/formats.test.mjs tests/readers.test.mjs tests/svg.test.mjs tests/calibration.test.mjs
```
- `tests/test_app.py` — the desktop shell: saving through the dialog, where settings live, the port,
  the self-test, the version in the title bar and the page's header, and that the bundled page needs
  nothing from the internet. pywebview is stubbed, so it needs only the standard library.
- `tests/test_release_version.py` — working out a release's version and stamping it in.
- `tests/formats.test.mjs` — the DST, DSB and DSZ code in `stitch_analyzer/web/formats.js`, run in
  Node (22 or newer, no packages): converted files are compared byte for byte with recorded ones
  (`tests/fixtures/conversions.json`) and read back to check every stitch is where it was.
- `tests/readers.test.mjs` — the other formats (`stitch_analyzer/web/readers.js`): files pyembroidery
  wrote (`tests/fixtures/readers.json`) read stitch for stitch as pyembroidery reads them, files made up
  byte by byte for the formats pyembroidery only reads, picking a reader by a file's first bytes, and a
  PES converted to DST. `scripts/make_reader_fixtures.py` remakes the pyembroidery files
  (`pip install pyembroidery` first; the app itself doesn't need it).
- `tests/svg.test.mjs` — the drawing's SVG export is well-formed XML, with Thread colors on and off.
- `tests/calibration.test.mjs` — each Calibrate suggestion (a new Max speed, or new trim and
  color-change times), fed back into the speed model, gives the stitch-out time that was entered.

`python3 -m stitch_analyzer --self-test` opens the real window, checks the page, the format code and
the save bridge all loaded, and exits 0 if they did. CI runs it on each built app.

## Versions and releases
The version is the release date and that day's build number: `2026.11.01.01` is the first release
made on 1 November 2026 (UTC), `2026.11.01.02` the second. It shows in the title bar and at the top
of the page. Nobody sets it by hand: the source says `dev` (so does an app run from source or built
by hand), and CI works it out when it publishes a release.

To release: merge to main, then run **Actions → CI → Run workflow** on main with **Publish a
release** ticked. CI runs the tests, works out the version from the tags already there
(`scripts/release_version.py`), stamps it into `stitch_analyzer/__init__.py` and the page, builds
both apps, self-tests them and publishes them as a release tagged `v<version>`. The download names
stay the same from one release to the next.

## Build the apps yourself
```bash
python3 -m pip install pyinstaller -r requirements.txt
pyinstaller --noconfirm opendecodesk-stitch-analyzer.spec
```

The app's icon (`icons/`: the OpenDecoDesk navy tile, cream hoop and orange D, here the hoop as a magnifying glass) is made
from its two drawings, `icons/icon-large.svg` (64 px and up) and `icons/icon-small.svg` (48 px and
under), with OpenDecoDesk's icon script: in a checkout of
[OpenDecoDesk](https://github.com/OpenDecoDesk/opendecodesk), `cd desktop && npm install`, then
`npx electron icons/make-icons.js --large=<this repo>/icons/icon-large.svg --small=<this repo>/icons/icon-small.svg --out=<this repo>/icons`.
Commit the `icon.icns`, `icon.ico` and `icon.png` it writes.

## Related
[OpenDecoDesk Machine Files](https://github.com/OpenDecoDesk/opendecodesk-machine-files) copies designs
between a folder and a SmartStitch machine on your network.

Tajima, Barudan, ZSK, Brother, Janome, Melco, Pfaff, Husqvarna Viking, Singer and the other makers named
here are their owners' brands; this project isn't affiliated with or endorsed by any
of them.

## Licence
[GNU AGPL-3.0](LICENSE). The format readers are ported from pyembroidery, under the MIT license (see
[NOTICE](NOTICE)). The bundled IBM Plex fonts are under the SIL Open Font License
([stitch_analyzer/web/fonts/OFL.txt](stitch_analyzer/web/fonts/OFL.txt)).
