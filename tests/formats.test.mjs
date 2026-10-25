// The DST/DSB/DSZ code in stitch_analyzer/web/formats.js, run outside the page with Node's own test
// runner: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const F = vm.createContext({ TextDecoder, TextEncoder, atob, btoa });
vm.runInContext(readFileSync(new URL('stitch_analyzer/web/formats.js', root), 'utf8'), F, { filename: 'formats.js' });

// Recorded from the converter before its code moved into formats.js; any change in output fails here.
const FIXTURES = JSON.parse(readFileSync(new URL('tests/fixtures/conversions.json', root), 'utf8'));
const NEEDLE_MAP = [2, 4, 6];

const fromHex = h => Uint8Array.from(h.match(/../g), b => parseInt(b, 16));
const toHex = u8 => Array.from(u8, v => v.toString(16).padStart(2, '0')).join('');
const loadDst = hex => F.loadDstBytes(fromHex(hex).buffer);
const loadExplicit = (u8, fmt) => F.loadExplicitBytes(u8.buffer, fmt);
const convert = (hex, fmt, map = null, trim = false) => {
  const { header, records } = loadDst(hex);
  return F.convertToExplicit(header, records, map, trim, fmt);
};

// Needle positions in 0.1 mm, plus where the design ends (jumps included).
function stitchPath(records) {
  let x = 0, y = 0;
  const stitches = [];
  for (const r of records) {
    if (r.is_color_change || r.is_explicit_stop || r.is_explicit_trim) continue;
    x += Math.round(r.dx * 10);
    y += Math.round(r.dy * 10);
    if (!r.is_jump) stitches.push([x, y]);
  }
  return { stitches, end: [x, y] };
}

// Array.from: arrays made inside the vm context aren't deep-strict-equal to arrays made here.
const commands = records => Array.from(records)
  .filter(r => r.is_color_change || r.is_explicit_stop || r.is_explicit_trim)
  .map(r => r.is_explicit_trim ? 'trim' : r.is_explicit_stop ? 'stop' : `needle ${r.needle_no}`);

for (const [name, fx] of Object.entries(FIXTURES)) {
  test(`${name}: output matches the recorded bytes`, () => {
    assert.equal(toHex(convert(fx.dst, 'dsb')), fx.dsb);
    assert.equal(toHex(convert(fx.dst, 'dsb', null, true)), fx.dsb_trim);
    assert.equal(toHex(convert(fx.dst, 'dsb', NEEDLE_MAP)), fx.dsb_map);
    assert.equal(toHex(convert(fx.dst, 'dsz')), fx.dsz);
    assert.equal(toHex(convert(fx.dst, 'dsz', null, true)), fx.dsz_trim);
    assert.equal(toHex(convert(fx.dst, 'dsz', NEEDLE_MAP, true)), fx.dsz_map);
    const dsb = loadExplicit(fromHex(fx.dsb), 'dsb');
    assert.equal(toHex(F.convertToDst(dsb.header, dsb.records)), fx.dst_from_dsb);
  });

  for (const fmt of ['dsb', 'dsz']) {
    test(`${name}: DST → ${fmt.toUpperCase()} keeps every stitch where it was`, () => {
      const want = stitchPath(loadDst(fx.dst).records);
      const got = stitchPath(loadExplicit(convert(fx.dst, fmt, null, true), fmt).records);
      assert.deepEqual(got.stitches, want.stitches);
      assert.deepEqual(got.end, want.end);
    });
  }
}

test('stops and needle changes follow the CO header, with the trim before each stop', () => {
  for (const fmt of ['dsb', 'dsz']) {
    const cmds = name => commands(loadExplicit(convert(FIXTURES[name].dst, fmt, null, true), fmt).records);
    assert.deepEqual(cmds('stops'), ['trim', 'stop', 'trim', 'stop']);
    assert.deepEqual(cmds('colors'), ['needle 2', 'needle 3']);
    assert.deepEqual(cmds('stop_then_change'), ['trim', 'stop', 'needle 2', 'trim', 'stop']);
  }
});

test('without "trim before stop" there are no trims', () => {
  for (const fmt of ['dsb', 'dsz']) {
    const cmds = commands(loadExplicit(convert(FIXTURES.stops.dst, fmt), fmt).records);
    assert.deepEqual(cmds, ['stop', 'stop']);
  }
});

test('the needle map picks the starting needle and each change', () => {
  for (const fmt of ['dsb', 'dsz']) {
    const { header, records } = loadExplicit(convert(FIXTURES.colors.dst, fmt, NEEDLE_MAP), fmt);
    assert.equal(header.start_needle, 2);
    assert.deepEqual(commands(records), ['needle 4', 'needle 6']);
  }
});

test('needles the format cannot hold are refused', () => {
  assert.throws(() => convert(FIXTURES.colors.dst, 'dsz', [1, 2, 13]), /DSZ supports needles 1–12; color change 2 is set to needle 13/);
  assert.throws(() => convert(FIXTURES.colors.dst, 'dsb', [16]), /DSB supports needles 1–15; the starting thread is set to needle 16/);
  assert.doesNotThrow(() => convert(FIXTURES.colors.dst, 'dsb', [1, 14, 15]));
});

test('the shared header is padded the way Barudan machines expect', () => {
  const out = convert(FIXTURES.stops.dst, 'dsb');
  const text = new TextDecoder('latin1').decode(out.slice(0, 512));
  assert.match(text, /^LA:stops {11}\rST: {5}86\rCO:  0\r\+X:  120\r-X:   80\r\+Y:   90\r-Y:  110\r/);
  assert.match(text, /AX: {5}0\rAY: {5}0\rMX:\+ {4}0\rMY:\+ {4}0\rPD:\*{6}\r\n/);
  assert.equal(out[511], 0x20);
  assert.deepEqual(Array.from(out.slice(512, 515)), [0xE9, 0, 0]);
  assert.deepEqual(Array.from(out.slice(-3)), [0xF8, 0, 0]);
});

test('DSZ records put the command byte last and have no end code', () => {
  const out = convert(FIXTURES.stops.dst, 'dsz', null, true);
  assert.deepEqual(Array.from(out.slice(512, 515)), [0, 0, 0x83]);
  const ctrls = [];
  for (let i = 512; i < out.length; i += 3) ctrls.push(out[i + 2]);
  assert.ok(ctrls.every(c => c & 0x80), 'every DSZ record sets bit 7');
  assert.equal(ctrls.filter(c => c === 0x82).length, 2);
  assert.equal(ctrls.filter(c => c === 0x9B).length, 2);
  assert.notEqual(ctrls[ctrls.length - 1] & 0x1F, 0x18);
});
