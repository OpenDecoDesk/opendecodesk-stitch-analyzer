"""Writes tests/fixtures/readers.json: small designs saved in every format pyembroidery can write, each with
pyembroidery's own reading of the file. tests/readers.test.mjs checks that stitch_analyzer/web/readers.js
reads the same bytes the same way.

Run it only when the designs below change; the app doesn't need pyembroidery:
    python3 -m pip install pyembroidery
    python3 scripts/make_reader_fixtures.py
"""
import json
import os
import tempfile

import pyembroidery as pe

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "fixtures", "readers.json")

# (extension, writer settings). PES is written twice: version 1 has no thread list, version 6 does.
FORMATS = [
    ("pes", {"version": "6t"}),
    ("pes", {"version": 1}),
    ("pec", {}),
    ("jef", {}),
    ("exp", {}),
    ("vp3", {}),
    ("xxx", {}),
    ("u01", {}),
    ("tbf", {}),
]


def thread(hex_color, name, code, brand):
    t = pe.EmbThread()
    t.set_color(int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16))
    t.description, t.catalog_number, t.brand = name, code, brand
    return t


def square(p, x0, y0, size, step):
    """A filled square, run back and forth: enough stitches to look like a design."""
    rows = size // step
    for i in range(rows + 1):
        y = y0 + i * step
        xs = (x0, x0 + size) if i % 2 == 0 else (x0 + size, x0)
        for k in range(0, size + 1, 20):
            p.add_stitch_absolute(pe.STITCH, xs[0] + (k if xs[0] < xs[1] else -k), y)


def designs():
    """Units are 0.1 mm, Y down (pyembroidery's own)."""
    # Three colors, a trim and a long jump between them, short and long stitches.
    a = pe.EmbPattern()
    a.add_thread(thread("ed171f", "Red", "800", "Madeira"))
    a.add_thread(thread("0a55a3", "Blue", "1076", "Isacord"))
    a.add_thread(thread("ffff00", "Yellow", "", ""))
    square(a, 0, 0, 200, 40)
    a.add_command(pe.TRIM)
    a.add_stitch_absolute(pe.JUMP, 400, 50)
    a.add_stitch_absolute(pe.JUMP, 600, 100)
    a.add_command(pe.COLOR_CHANGE)
    square(a, 600, 100, 160, 40)
    a.add_stitch_absolute(pe.STITCH, 760, 300)   # a 20 mm stitch
    a.add_command(pe.TRIM)
    a.add_stitch_absolute(pe.JUMP, 300, 600)
    a.add_command(pe.COLOR_CHANGE)
    square(a, 300, 600, 120, 30)
    a.add_command(pe.END)

    # One color, a short jump with no trim, a stitch going up and left of the start.
    b = pe.EmbPattern()
    b.add_thread(thread("000000", "Black", "1800", "Isacord"))
    for x, y in [(0, 0), (30, -20), (60, 0), (90, -20), (120, 0)]:
        b.add_stitch_absolute(pe.STITCH, x, y)
    b.add_stitch_absolute(pe.JUMP, 140, 10)
    for x, y in [(140, 10), (100, 60), (-50, 80), (-80, -40)]:
        b.add_stitch_absolute(pe.STITCH, x, y)
    b.add_command(pe.END)
    return {"three_colors": a, "one_color": b}


def reading(path):
    """What pyembroidery reads back: every stitch, jump, trim, stop and color change, and the threads."""
    p = pe.read(path)
    names = {pe.STITCH: "stitch", pe.JUMP: "jump", pe.TRIM: "trim", pe.STOP: "stop",
             pe.COLOR_CHANGE: "color", pe.NEEDLE_SET: "color"}
    events = [[names[cmd & pe.COMMAND_MASK], round(x), round(y)]
              for x, y, cmd in p.stitches if (cmd & pe.COMMAND_MASK) in names]
    return {"events": events, "threads": ["%06x" % (t.color & 0xFFFFFF) for t in p.threadlist]}


def main():
    fixtures = {}
    with tempfile.TemporaryDirectory() as tmp:
        for dname, pattern in designs().items():
            for ext, settings in FORMATS:
                key = "%s.%s" % (dname, ext) + "".join("-v%s" % v for v in settings.values())
                path = os.path.join(tmp, key + "." + ext)
                pe.write(pattern, path, dict(settings))
                with open(path, "rb") as f:
                    data = f.read()
                fixtures[key] = {"ext": ext, "hex": data.hex(), **reading(path)}
    with open(OUT, "w") as f:
        json.dump(fixtures, f, indent=1, sort_keys=True)
        f.write("\n")
    print("wrote %d files to %s" % (len(fixtures), OUT))


if __name__ == "__main__":
    main()
