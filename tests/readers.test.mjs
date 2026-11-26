// The readers for formats other than DST, DSB and DSZ (stitch_analyzer/web/readers.js), and loadEmbFile in
// formats.js, which picks a reader. Two kinds of file:
//  - files pyembroidery wrote (tests/fixtures/readers.json, made by scripts/make_reader_fixtures.py), each
//    with pyembroidery's own reading of it: these readers must agree, stitch for stitch;
//  - files made up here, byte by byte, for the formats pyembroidery can only read (most built as OpenDecoDesk's
//    test199_stitch_formats.js builds them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const F = vm.createContext({ TextDecoder, TextEncoder, atob, btoa });
for (const f of ['formats.js', 'readers.js']) {
  vm.runInContext(readFileSync(new URL(`stitch_analyzer/web/${f}`, root), 'utf8'), F, { filename: f });
}
const R = vm.runInContext('StitchReaders', F);
const open = (name, buffer) => F.loadEmbFile({ name }, buffer);
const fromHex = h => Uint8Array.from(h.match(/../g), b => parseInt(b, 16)).buffer;

// ── What a reading comes to, in a form both sides can be put in ─────────────────────────────────────────────
// Needle positions in 0.1 mm with Y up, and before each stitch what happened since the last one:
// t = trimmed, c<n> = n color changes, s<n> = n stops. Nothing before the first stitch or after the last counts:
// both sides only start a design at its first stitch.
function summarize(events) {
  const stitches = [], between = [];
  let pending = { t: false, c: 0, s: 0 };
  for (const [kind, x, y] of events) {
    if (kind === 'stitch') {
      stitches.push([x, y]);
      between.push((pending.t ? 't' : '') + (pending.c ? `c${pending.c}` : '') + (pending.s ? `s${pending.s}` : ''));
      pending = { t: false, c: 0, s: 0 };
    } else if (kind === 'trim') pending.t = true;
    else if (kind === 'color') pending.c++;
    else if (kind === 'stop') pending.s++;
  }
  between[0] = '';
  return { stitches, between };
}
// The analyzer's records as the same events (absolute, 0.1 mm, Y up).
function eventsOf(records) {
  let x = 0, y = 0;
  return Array.from(records, r => {
    x += Math.round(r.dx * 10); y += Math.round(r.dy * 10);
    const kind = r.is_color_change ? 'color' : r.is_explicit_stop ? 'stop' : r.is_explicit_trim ? 'trim' : r.is_jump ? 'jump' : 'stitch';
    return [kind, x, y];
  });
}
// pyembroidery's events: Y down, so flip it.
const pyEvents = events => events.map(([k, x, y]) => [k, x, 0 - y || 0]);
const blocksOf = records => Array.from(records).filter(r => r.is_color_change).length + 1;

// ── Files pyembroidery wrote ────────────────────────────────────────────────────────────────────────────────
const FIXTURES = JSON.parse(readFileSync(new URL('tests/fixtures/readers.json', root), 'utf8'));

const COLOR_FILES = ['edr', 'col', 'inf'];
for (const [name, fx] of Object.entries(FIXTURES)) {
  if (COLOR_FILES.includes(fx.ext)) {
    test(`${name}: the thread colors pyembroidery reads`, () => {
      assert.ok(R.isColorFile(fx.ext.toUpperCase()));
      assert.deepEqual(Array.from(R.readColors(fromHex(fx.hex), fx.ext), t => t.hex), fx.threads);
    });
    continue;
  }
  test(`${name}: read as pyembroidery reads it`, () => {
    const { header, records } = open(`design.${fx.ext}`, fromHex(fx.hex));
    const ours = summarize(eventsOf(records)), theirs = summarize(pyEvents(fx.events));
    // This app keeps whole 0.1 mm; pyembroidery keeps the fractions some formats' scaling gives (PMV's 0.25 mm).
    assert.equal(ours.stitches.length, theirs.stitches.length, 'stitch count');
    ours.stitches.forEach(([x, y], i) => {
      const [tx, ty] = theirs.stitches[i];
      assert.ok(Math.abs(x - tx) <= 0.5 && Math.abs(y - ty) <= 0.5, `stitch ${i}: (${x}, ${y}) vs (${tx}, ${ty})`);
    });
    assert.deepEqual(ours.between, theirs.between, 'trims, color changes and stops between stitches');
    assert.equal(header.format, fx.ext);
    assert.equal(header.stitch_count, theirs.stitches.length);
    assert.equal(header.color_changes, blocksOf(records) - 1);
    // Thread colors: where pyembroidery finds the file's own (not a default it makes up), they match by block.
    if (fx.threads.length && fx.ext !== 'tbf') {
      const ours = Array.from(header.file_colors, c => c && c.hex);
      assert.deepEqual(ours, fx.threads.slice(0, ours.length), 'thread colors');
    }
  });
}

test('every pyembroidery fixture design has its three colors and its trims', () => {
  const { header, records } = open('logo.pes', fromHex(FIXTURES['three_colors.pes-v6t'].hex));
  assert.equal(blocksOf(records), 3);
  assert.ok(Array.from(records).filter(r => r.is_explicit_trim).length >= 2);
  assert.equal(header.file_colors[0].hex, 'ed171f');
  assert.equal(header.file_colors[1].brand, 'Isacord');
  assert.equal(header.file_colors[1].code, '1076');
});

// ── Files made up here ──────────────────────────────────────────────────────────────────────────────────────
const buf = (...parts) => new Uint8Array(Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p.flat ? p.flat(9) : p)))).buffer;
const u16le = n => [n & 255, (n >> 8) & 255], u16be = n => [(n >> 8) & 255, n & 255];
const u32le = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255], u32be = n => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const zeros = n => Buffer.alloc(n);
const rgb = hex => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
const pstr = s => [s.length, ...Buffer.from(s, 'latin1')];
const vstr = s => [...u16be(s.length), ...Buffer.from(s, 'latin1')];

// PEC stitch block: n short stitches of +2,+1 per block, a color change (FE B0 xx) between blocks.
const pecStitches = blocks => { const r = []; blocks.forEach((n, i) => { if (i) r.push(0xFE, 0xB0, 0x02); for (let k = 0; k < n; k++) r.push(2, 1); }); r.push(0xFF, 0x00); return r; };
const pecBlock = (colorIdx, blocks, label = '') => [Buffer.from('LA:'), Buffer.from(label.padEnd(16, ' ')), zeros(0xF), [0, 0], zeros(0xC), [colorIdx.length - 1], colorIdx,
  zeros(0x1D0 - (colorIdx.length - 1)), [0, 0, 0], zeros(0x0B), pecStitches(blocks)];
const pec = (colorIdx, blocks, label) => buf(Buffer.from('#PEC0001'), ...pecBlock(colorIdx, blocks, label));
const pes6 = (threads, blocks) => {
  const head = [zeros(4), pstr(''), pstr(''), pstr(''), pstr(''), pstr(''), zeros(36), pstr(''), zeros(24), u16le(0), u16le(0), u16le(0), u16le(threads.length),
    ...threads.map(t => [pstr(t.code), rgb(t.hex), [0, 0, 0, 0, 0], pstr(t.name), pstr(t.brand), pstr('')])];
  const headBuf = Buffer.concat(head.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p.flat ? p.flat(9) : p)));
  return buf(Buffer.from('#PES0060'), u32le(8 + 4 + headBuf.length), headBuf, ...pecBlock(threads.map((_, i) => i + 1), blocks));
};
// JEF: chart positions; 0 = a stop. Each block is a list of moves: [dx, dy] stitches, ['j', dx, dy] jumps.
const jef = (chartIdx, blocks) => {
  const st = [];
  blocks.forEach((moves, i) => {
    if (i) st.push(0x80, 0x01, 0, 0);
    for (const m of moves) m[0] === 'j' ? st.push(0x80, 0x02, m[1] & 255, m[2] & 255) : st.push(m[0] & 255, m[1] & 255);
  });
  st.push(0x80, 0x10);
  return buf(u32le(4 + 20 + 4 + 88 + chartIdx.length * 4), zeros(20), u32le(chartIdx.length), zeros(88), ...chartIdx.map(u32le), st);
};
const run = (n, dx = 3, dy = 2) => Array.from({ length: n }, () => [dx, dy]);
const vp3 = (threads, perBlock) => {
  const blocks = threads.map(t => {
    const stitches = []; for (let k = 0; k < perBlock; k++) stitches.push(4, 4);
    const body = Buffer.concat([Buffer.from([...u32be(0), ...u32be(0), 1, 0, ...rgb(t.hex), 0, ...u16be(0), 0, 0, ...vstr(t.code), ...vstr(t.name), ...vstr(t.brand)]), zeros(15), Buffer.from([0x0A, 0xF6, 0]), Buffer.from(stitches)]);
    return Buffer.concat([Buffer.from([0, 5, 0]), Buffer.from(u32be(body.length)), body]);
  });
  return buf(Buffer.from('%vsm%\0'), vstr(''), zeros(7), vstr(''), zeros(32), u32be(0), u32be(0), zeros(27), vstr(''), zeros(24), vstr(''), u16be(threads.length), ...blocks);
};
const xxx = (hexes, blocks) => {
  const head = zeros(0x100); head.writeUInt16LE(hexes.length, 0x27);
  const st = []; blocks.forEach((n, i) => { if (i) st.push(0x7F, 0x08, 0, 0); for (let k = 0; k < n; k++) st.push(5, 3); }); st.push(0x7F, 0x7F, 0, 0);
  return buf(head, st, [0, 0], ...hexes.map(h => [0, ...rgb(h)]));
};
const exp = blocks => { const st = []; blocks.forEach((n, i) => { if (i) st.push(0x80, 0x01, 0, 0); for (let k = 0; k < n; k++) st.push(2, 2); }); return buf(st); };
const husStore = bytes => Buffer.concat([Buffer.from([bytes.length & 255, (bytes.length >> 8) & 255, 0x02, 0xA0, 0x01, 0xFE]), Buffer.from(bytes)]);
const hus = (chartIdx, blocks) => {
  const cmd = [], xs = [], ys = [];
  blocks.forEach((n, i) => { if (i) { cmd.push(0x84); xs.push(0); ys.push(0); } for (let k = 0; k < n; k++) { cmd.push(0x80); xs.push(3); ys.push(1); } });
  cmd.push(0x88); xs.push(0); ys.push(0);
  cmd.push(0x90); xs.push(0); ys.push(0);
  const c = husStore(cmd), x = husStore(xs), y = husStore(ys);
  const headLen = 4 + 4 + 4 + 8 + 12 + 8 + 2 + chartIdx.length * 2;
  return buf(u32le(0x00C8AF5B), u32le(cmd.length), u32le(chartIdx.length), zeros(8), u32le(headLen), u32le(headLen + c.length), u32le(headLen + c.length + x.length),
    zeros(8), u16le(0), ...chartIdx.map(u16le), c, x, y);
};
const dstTc = (tcLines, blocks) => {
  const header = Buffer.alloc(512, 0x20);
  header.write('LA:TEST\r' + tcLines.map(l => 'TC:' + l + '\r').join(''), 0, 'latin1');
  const r = []; blocks.forEach((n, i) => { if (i) r.push(0, 0, 0xC3); for (let k = 0; k < n; k++) r.push(1, 0, 3); }); r.push(0, 0, 0xF3);
  return buf(header, r);
};

const kinds = records => Array.from(records, r => r.is_color_change ? `C${r.needle_no ?? ''}` : r.is_explicit_stop ? 'S' : r.is_explicit_trim ? 'T' : r.is_jump ? 'j' : '.').join('');
const hexes = header => Array.from(header.file_colors, c => c && c.hex);

test('PES v6: the header thread list gives each block its brand, code, name and color', () => {
  const { header, records } = open('logo.pes', pes6([{ code: '01800', hex: '112233', name: 'Navy', brand: 'Sample Poly 40' }, { code: '77', hex: 'abcdef', name: 'Sky', brand: 'Other Thread Co' }], [5, 4]));
  assert.equal(kinds(records), '.....C....');
  assert.equal(header.stitch_count, 9);
  assert.equal(header.file_colors[0].brand, 'Sample Poly 40');
  assert.equal(header.file_colors[0].code, '01800');
  assert.equal(header.file_colors[1].name, 'Sky');
  // +2,+1 per stitch in pyembroidery's Y-down units: up is down. 9 stitches: 1.8 mm across, 0.9 mm down.
  assert.equal(header.x_pos, 18); assert.equal(header.y_neg, 9); assert.equal(header.y_pos, 0);
  assert.ok(records[0].dy < 0);
});

test("PEC: chart positions give Brother's chart colors, and the label is the design's", () => {
  const { header } = open('logo.PEC', pec([20, 5], [3, 3], 'MYLOGO'));
  assert.deepEqual(hexes(header), ['000000', 'ed171f']);
  assert.equal(header.file_colors[0].name, 'Black');
  assert.equal(header.file_colors[0].brand, 'Brother');
  assert.equal(header.label, 'MYLOGO');
});

test('JEF: chart position 0 is a stop; the colors carry Janome thread numbers', () => {
  const { header, records } = open('x.jef', jef([1, 0, 2], [run(4), run(4), run(4)]));
  assert.equal(kinds(records), '....S....C....');
  assert.deepEqual(Array.from(header.file_colors, c => c.code), ['002', '001']);
  assert.equal(header.file_colors[1].brand, 'Janome');
});

test('JEF has no trim command: a jump run over 3 mm gets one, a short one does not', () => {
  const { header, records } = open('x.jef', jef([1], [[...run(3), ['j', 10, 0], ...run(2), ['j', 20, 0], ['j', 20, 0], ...run(2)]]));
  assert.equal(kinds(records), '...j..Tjj..');
  assert.equal(header.trims, 'long-jumps');
});

test('VP3: a block per thread, with its code and color', () => {
  const { header, records } = open('x.vp3', vp3([{ code: '1800', hex: '112233', name: 'Navy', brand: 'Sample Poly 40' }, { code: '9', hex: 'fedcba', name: '', brand: 'Other' }], 6));
  assert.equal(blocksOf(records), 2);
  assert.equal(header.stitch_count, 12);
  assert.equal(header.file_colors[0].code, '1800');
  assert.equal(header.file_colors[1].hex, 'fedcba');
});

test('XXX: the colors listed after the stitches; an empty block keeps the colors in step', () => {
  assert.deepEqual(hexes(open('x.xxx', xxx(['ff0000', '00ff00', '0000ff'], [2, 2, 2])).header), ['ff0000', '00ff00', '0000ff']);
  const { header, records } = open('x.xxx', xxx(['ff0000', '00ff00', '0000ff'], [2, 0, 2]));
  assert.equal(kinds(records), '..CC..');
  assert.deepEqual(hexes(header), ['ff0000', null, '0000ff']);
});

test('EXP: no colors in the file; color changes before the first stitch and after the last are dropped', () => {
  const { header, records } = open('x.exp', exp([0, 3, 3, 3, 0]));
  assert.equal(kinds(records), '...C...C...');
  assert.deepEqual(hexes(header), [null, null, null]);
  const trims = open('x.exp', buf([2, 2, 0x80, 0x80, 0, 0, 0x80, 0x04, 50, 0, 2, 2]));
  assert.equal(kinds(trims.records), '.Tj.');
});

test('HUS: decompressed; Viking chart colors with their thread numbers; 0x88 trims', () => {
  const { header, records } = open('x.hus', hus([0, 12], [5, 5]));
  assert.equal(kinds(records), '.....C.....T');
  assert.equal(header.file_colors[0].code, '026');
  assert.equal(header.file_colors[1].name, 'White');
});

test('U01: needle changes name their needle, the first one is the starting needle', () => {
  const r = []; [2, 2, 2].forEach((n, i) => { r.push(0x89 + i * 2, 0, 0); for (let k = 0; k < n; k++) r.push(0x80, 1, 2); });
  r.push(0x86, 0, 0, 0x88, 0, 0, 0x80, 1, 2, 0xF8, 0, 0);
  const { header, records } = open('x.u01', buf(zeros(0x100), r));
  assert.equal(kinds(records), '..C3..C5..TS.');
  assert.equal(header.start_needle, 1);
  assert.equal(F.buildColorToNeedle(header, records)[2], 5);
});

test('GT: laid out like DSZ, with its stops, trims and needles', () => {
  const r = [0, 0, 0x83, 2, 1, 0, 2, 1, 0, 0, 0, 0x9B, 0, 0, 0x82, 0, 0, 0x85, 2, 1, 0];
  const { header, records } = open('x.gt', buf(zeros(0x200), r));
  assert.equal(kinds(records), '..TSC2.');
  assert.equal(header.start_needle, 1);
});

test('10O: 0x85 changes color, 0x82 stops, 0x81 trims', () => {
  const r = [0x8A, 0, 0, 0x00, 1, 2, 0x00, 1, 2, 0x81, 0, 0, 0x90, 5, 5, 0x85, 0, 0, 0x00, 1, 2, 0x82, 0, 0, 0x00, 1, 2, 0x87, 0, 0];
  assert.equal(kinds(open('x.10o', buf(r)).records), '..TjC.S.');
});

test('KSM: a trim leaves the needle up until stitching starts again', () => {
  const r = [1, 2, 0, 1, 2, 0, 0, 0, 0x07, 5, 5, 0, 0, 0, 0x17, 1, 2, 0, 0, 0, 0x0C, 1, 2, 0x17, 1, 2, 0, 0, 0, 0x08];
  const { records } = open('x.ksm', buf(zeros(0x200), r));
  assert.equal(kinds(records), '..Tj.C2j.');
});

test('EMD, INB, NEW, STX, TAP: stitches, color changes and jumps', () => {
  const emd = buf(zeros(0x30), [2, 2, 2, 2, 0x80, 0xAD, 0x80, 0x80, 20, 0, 0x80, 0x2A, 2, 2, 0x80, 0xFD]);
  assert.equal(kinds(open('x.emd', emd).records), '..TjC.');
  const inb = buf(zeros(0x2000), [2, 1, 0, 2, 1, 0, 0, 0, 1, 2, 1, 0, 0, 0, 0x04]);
  assert.equal(kinds(open('x.inb', inb).records), '..C.');
  const nw = buf([3, 0], [2, 1, 0, 2, 1, 0, 0, 0, 2, 2, 1, 0, 0, 0, 0x11]);
  assert.equal(kinds(open('x.new', nw).records), '..C.');
  const stx = buf(Buffer.from('STX'), zeros(0x0C - 3), u32le(0), u32le(0), u32le(0x20), zeros(0x20 - 0x18), [2, 2, 0x80, 0x01, 0, 0, 2, 2]);
  assert.equal(kinds(open('x.stx', stx).records), '.C.');
  // TAP is DST's records with no header: 0x83 jump, 0xC3 color change, 0xF3 end.
  const tap = buf([1, 0, 3, 1, 0, 3, 0, 0, 0xC3, 1, 0, 3, 0, 0, 0xF3]);
  const t = open('x.tap', tap);
  assert.equal(kinds(t.records), '..C.');
  assert.equal(t.header.trims, 'jumps');
});

test('PCS: absolute positions, scaled to 0.1 mm without drifting', () => {
  // Two colors; positions at multiples of 3 file units = 5 tenths of a mm. The file's Y points up.
  const rec = (x, y, c) => [0, ...u32le(x).slice(0, 3), 0, ...u32le(y).slice(0, 3), c];
  const pcs = buf([0x32, 0x02], u16le(2), [...rgb('ff0000'), 0, ...rgb('00ff00'), 0], u16le(0),
    rec(0, 0, 0), rec(3, 0, 0), rec(6, 3, 0), rec(0, 0, 1), rec(9, 3, 0), rec(12, 3, 0));
  const { header, records } = open('x.pcs', pcs);
  assert.equal(kinds(records), '...C..');
  const ev = eventsOf(records).filter(e => e[0] === 'stitch').map(e => [e[1], e[2]]);
  assert.deepEqual(ev, [[0, 0], [5, 0], [10, 5], [15, 5], [20, 5]]);
  assert.deepEqual(hexes(header), ['ff0000', '00ff00']);
});

test('DST: the header TC lines are the thread colors', () => {
  const { header } = open('x.dst', dstTc(['#112233,Navy,1800', '#ABCDEF,Sky,77'], [3, 3]));
  assert.deepEqual(hexes(header), ['112233', 'abcdef']);
  assert.equal(header.file_colors[0].code, '1800');
  assert.equal(header.format, 'dst');
  assert.deepEqual(hexes(open('x.dst', dstTc([], [3, 3])).header), []);
});

// ── Picking a reader ────────────────────────────────────────────────────────────────────────────────────────
test('a file with the wrong extension, or none, is read by its first bytes', () => {
  const p = pec([20, 5], [3, 3]);
  assert.equal(open('logo.dst', p).header.format, 'pec');
  assert.equal(open('logo', p).header.format, 'pec');
  assert.equal(open('logo.bin', FIXTURES['one_color.pes-v6t'] && fromHex(FIXTURES['one_color.pes-v6t'].hex)).header.format, 'pes');
  assert.equal(open('x.pes', dstTc([], [3])).header.format, 'dst');
});

test("design-software files and unknown formats say what's wrong", () => {
  assert.throws(() => open('logo.emb', buf(zeros(600))), /project file.*Export/s);
  assert.throws(() => open('logo.xyz', buf(zeros(600))), /can't read \.xyz/);
  assert.throws(() => open('x.pes', buf(zeros(20))), /too short|isn't a PES/);
  assert.throws(() => open('x.exp', exp([0])), /No stitches found in this EXP/);
  assert.throws(() => open('x.exp', buf(Array.from({ length: 200 }, () => [100, 100]).flat())), /couldn't be read/);
});

test('the list of extensions the app opens', () => {
  const exts = Array.from(F.readableExtensions());
  for (const e of ['dst', 'dsb', 'dsz', 'pes', 'pec', 'jef', 'exp', 'vp3', 'xxx', 'hus', 'u01', 'tbf', '10o']) assert.ok(exts.includes(e), e);
  assert.equal(new Set(exts).size, exts.length);
  assert.ok(R.exts.length >= 24);
});

// ── Any format converts ─────────────────────────────────────────────────────────────────────────────────────
test('a PES converts to DST with every stitch, trim and color change in place', () => {
  const src = open('logo.pes', fromHex(FIXTURES['three_colors.pes-v6t'].hex));
  const dst = F.loadDstBytes(F.convertToDst(src.header, src.records).buffer);
  const a = summarize(eventsOf(src.records)), b = summarize(eventsOf(dst.records));
  assert.deepEqual(b.stitches, a.stitches);
  assert.equal(dst.header.color_changes, 2);
  // DST has no trim command: a trim becomes three jumps, which the analyzer reads back as a trim.
  const trims = Array.from(src.records).filter(r => r.is_explicit_trim).length;
  assert.equal(Array.from(dst.records).filter(r => r.is_jump && !r.dx && !r.dy).length, 3 * trims);
});

// ── Each color block's thread, by the color index the drawing and the table use ─────────────────────────────
test('threads by color index follow the blocks the analysis counts', () => {
  const pesFile = open('logo.pes', fromHex(FIXTURES['three_colors.pes-v6t'].hex));
  assert.deepEqual(Array.from(F.threadsByColorIndex(pesFile.header, pesFile.records), t => t.hex), ['ed171f', '0a55a3', 'ffff00']);
  assert.equal(F.threadName(pesFile.header.file_colors[1]), 'Isacord 1076 Blue');
  // Two changes in a row are a stop and then a change: one new block, whose thread is the one listed third.
  const x = open('x.xxx', xxx(['ff0000', '00ff00', '0000ff'], [2, 0, 2]));
  assert.deepEqual(Array.from(F.threadsByColorIndex(x.header, x.records), t => t && t.hex), ['ff0000', '0000ff']);
  // A design that names no threads has none.
  const e = open('x.exp', exp([3, 3]));
  assert.deepEqual(Array.from(F.threadsByColorIndex(e.header, e.records)), []);
  assert.equal(F.threadName({ hex: 'abcdef', brand: '', code: '', name: '', chart: '' }), '#abcdef');
});

// ── The formats added from pyembroidery's readers, made up byte by byte ─────────────────────────────────────
test('PCD and PCQ read as PCS does', () => {
  const rec = (x, y, c) => [0, ...u32le(x).slice(0, 3), 0, ...u32le(y).slice(0, 3), c];
  const pc = buf([0x32, 0x02], u16le(1), [...rgb('123456'), 0], u16le(0), rec(0, 0, 0), rec(6, 0, 0), rec(6, 6, 0));
  for (const ext of ['pcd', 'pcq']) {
    const { header, records } = open(`x.${ext}`, pc);
    assert.equal(header.format, ext);
    assert.equal(kinds(records), '...');
    assert.deepEqual(hexes(header), ['123456']);
  }
});

test('100: 0x61 stitches, an odd control byte jumps, any other changes color', () => {
  const r = [0x61, 0, 2, 0x81, 0x61, 0, 2, 1, 0x01, 0, 40, 0, 0x00, 0, 0, 0, 0x61, 0, 2, 2];
  assert.equal(kinds(open('x.100', buf(r)).records), '..TjC.');
});

test('BRO: long jumps and needle changes', () => {
  const st = [2, 2, 2, 2, 0x80, 0x03, ...u16le(50), ...u16le(0), 0x80, 0xE3, ...u16le(0), ...u16le(0), 2, 2, 0x80, 0x02];
  const { records } = open('x.bro', buf(zeros(0x100), st));
  assert.equal(kinds(records), '..TjC3.');
});

test('DAT: Barudan records when every control byte has its top bit, Sunstar ones otherwise', () => {
  const barudan = buf([0x80, 1, 2, 0x80, 1, 2, 0x87, 0, 0, 0x8A, 0, 0, 0x80, 1, 2, 0x98, 0, 0]);
  assert.equal(kinds(open('x.dat', barudan).records), '..TC2.');
  const sunstar = buf(zeros(0x100), [2, 1, 0x07, 2, 1, 0x07, 0, 0, 0x80, 0x85, 0, 0x04, 0, 0, 0x87, 2, 1, 0x07, 0, 0, 0]);
  const s = open('x.dat', sunstar);
  assert.equal(kinds(s.records), '..TjC.');
  assert.ok(s.records[0].dy > 0 && s.records[0].dx > 0);   // y 1: up, as pyembroidery reads it
});

test('EXY is DST records after a 0x100 header; FXY is DSZ records after one', () => {
  const exy = open('x.exy', buf(zeros(0x100), [1, 0, 3, 1, 0, 3, 0, 0, 0xC3, 1, 0, 3, 0, 0, 0xF3]));
  assert.equal(kinds(exy.records), '..C.');
  assert.equal(exy.header.trims, 'jumps');
  const fxy = open('x.fxy', buf(zeros(0x100), [0, 0, 0x83, 2, 1, 0, 2, 1, 0, 0, 0, 0x9B, 0, 0, 0x85, 2, 1, 0]));
  assert.equal(kinds(fxy.records), '..TC2.');
  assert.equal(fxy.header.start_needle, 1);
});

test('SPX: stitches only, y corrected by its extra byte', () => {
  const rec = (x, y, c) => [0, 0, ...u16be(y & 0xFFFF), ...u16be(x & 0xFFFF), c & 255, 0, 0];
  const { records } = open('x.spx', buf(zeros(0x11E), rec(10, 5, 0), rec(10, 5, 1)));
  assert.equal(kinds(records), '..');
  assert.equal(Math.round(records[1].dy * 10), 6);   // up 5, plus 1
});

test('MIT: 0.2 mm moves; a color change counts only right after a stitch; no trim right after one', () => {
  // control 0b0111 stitch: bits 5–6 of byte 0 = 01, of byte 1 = 11; 0b1100 jump: 11, 00; 0b1000 change: 10, 00.
  const st = (x, y) => [0x20 | x, 0x60 | y], jump = (x, y) => [0x60 | x, y], cc = [0x40, 0];
  const { records } = open('x.mit', buf([...st(1, 1), ...st(1, 1), ...cc, ...jump(20, 0), ...st(1, 1), 0, 0]));
  assert.equal(kinds(records), '..Cj.');
  assert.equal(Math.round(records[0].dx * 10), 2);
});

test('JPX: JEF stitches from the offset at the start', () => {
  const st = [3, 2, 3, 2, 0x80, 0x01, 0, 0, 3, 2, 0x80, 0x10];
  assert.equal(kinds(open('x.jpx', buf(u32le(0x40), zeros(0x3C), st)).records), '..C.');
});

test('STC: needle changes are the control byte less 2', () => {
  const r = [2, 1, 1, 2, 1, 1, 0, 0, 7, 2, 1, 1, 0, 0, 25];
  assert.equal(kinds(open('x.stc', buf(zeros(0x28), r)).records), '..C5.');
});

test('ZHS: the thread list names each thread; x and y bits are interleaved', () => {
  const names = Buffer.from('&$Madeira&#Red&#80000&$&#Blue&#12300', 'utf8');
  const header = [2, ...rgb('ff0000'), ...rgb('0000ff'), ...u16le(names.length), ...names];
  // x = 2 (bit 1, from b2), y = 1 (bit 0, from b2): b1 = 0, b2 = 0b11.
  const st = [0x02, 0, 0b11], stitches = [...st, ...st, 0x04, 0, 0, ...st, 0x80, 0, 0];
  const at = 0x17, headerAt = at + stitches.length;
  const file = buf(zeros(0x0F), u32le(at), u32le(headerAt), stitches, header);
  const { header: h, records } = open('x.zhs', file);
  assert.equal(kinds(records), '..C.');
  assert.equal(Math.round(records[0].dx * 10), 2);
  assert.equal(Math.round(records[0].dy * 10), 1);
  assert.deepEqual(hexes(h), ['ff0000', '0000ff']);
  assert.equal(h.file_colors[0].chart, 'Madeira');
  assert.equal(h.file_colors[0].name, 'Red');
  assert.equal(h.file_colors[0].code, '800');
  assert.equal(h.file_colors[1].name, 'Blue');
});

test('ZXY: needle changes name their needle; 0x20 with x = 0xFF ends the design', () => {
  const r = [0, 2, 1, 0, 2, 1, 0x20, 0, 4, 0, 2, 1, 0x20, 0xFF, 0, 0, 9, 9];
  const { records } = open('x.zxy', buf([0], u16be(2), zeros(2), r));
  assert.equal(kinds(records), '..C4.');
});

test('color files: dropped after a design, they say its threads', () => {
  assert.deepEqual(Array.from(R.readColors(buf([1, 2, 3, 0, 255, 254, 253, 0]), 'edr'), t => t.hex), ['010203', 'fffefd']);
  const col = R.readColors(buf(Buffer.from('2\r\n1800,0,0,0\r\n1801,255,255,255\r\n')), 'col');
  assert.deepEqual(Array.from(col, t => t.hex + ' ' + t.code), ['000000 1800', 'ffffff 1801']);
  assert.throws(() => R.readColors(buf([]), 'edr'), /No thread colors/);
  assert.throws(() => R.readColors(buf([1, 2, 3]), 'xyz'), /isn't a thread color file/);
  // A design opened by mistake as a color file is not mistaken for one, and the other way round.
  assert.ok(!R.isColorFile('pes'));
  assert.throws(() => open('x.edr', buf([1, 2, 3, 0])), /can't read \.edr/);
});
