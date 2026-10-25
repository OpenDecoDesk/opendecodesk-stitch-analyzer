// Embroidery file formats: Tajima DST, Barudan DSB and ZSK DSZ — parsing, encoding and conversion.
// Plain browser script (no modules): everything here is a global used by index.html.
'use strict';

// ── DST constants ────────────────────────────────────────────────────────────
const HEADER_SIZE     = 512;
const RECORD_SIZE     = 3;
const UNIT_TO_MM      = 0.1;

// ── DST Parsing ──────────────────────────────────────────────────────────────
function parseHeader(bytes) {
  const text = new TextDecoder('latin1').decode(bytes.slice(0, HEADER_SIZE));
  const fields = {};
  for (const raw of text.split('\r')) {
    const t = raw.trim();
    const ci = t.indexOf(':');
    if (ci > 0) { fields[t.slice(0, ci).trim()] = t.slice(ci + 1).trim(); }
  }
  const int = k => { const v = parseInt(fields[k]); return isNaN(v) ? -1 : v; };
  return {
    label: fields['LA'] || '',
    stitch_count: int('ST'),
    color_changes: int('CO'),
    x_pos: int('+X'), x_neg: int('-X'),
    y_pos: int('+Y'), y_neg: int('-Y'),
  };
}

function decodeRecord(b0, b1, b2) {
  let dx = 0, dy = 0;
  dx += ((b0>>0)&1)*1;   dx -= ((b0>>1)&1)*1;
  dx += ((b0>>2)&1)*9;   dx -= ((b0>>3)&1)*9;
  dx += ((b1>>0)&1)*3;   dx -= ((b1>>1)&1)*3;
  dx += ((b1>>2)&1)*27;  dx -= ((b1>>3)&1)*27;
  dx += ((b2>>2)&1)*81;  dx -= ((b2>>3)&1)*81;
  dy += ((b0>>7)&1)*1;   dy -= ((b0>>6)&1)*1;
  dy += ((b0>>5)&1)*9;   dy -= ((b0>>4)&1)*9;
  dy += ((b1>>7)&1)*3;   dy -= ((b1>>6)&1)*3;
  dy += ((b1>>5)&1)*27;  dy -= ((b1>>4)&1)*27;
  dy += ((b2>>5)&1)*81;  dy -= ((b2>>4)&1)*81;
  const is_end          = (b2 & 0xF3) === 0xF3;
  const is_color_change = !is_end && ((b2 & 0xC3) === 0xC3);
  const is_jump         = !is_end && !is_color_change && ((b2 & 0x83) === 0x83);
  return { dx: dx*UNIT_TO_MM, dy: dy*UNIT_TO_MM, is_jump, is_color_change, is_end };
}

function parseRecords(bytes) {
  const records = [];
  const n = Math.floor(bytes.length / RECORD_SIZE) * RECORD_SIZE;
  for (let i = 0; i < n; i += RECORD_SIZE) {
    const rec = decodeRecord(bytes[i], bytes[i+1], bytes[i+2]);
    if (rec.is_end) break;
    records.push(rec);
  }
  return records;
}

function loadDstBytes(arrayBuffer) {
  let data = new Uint8Array(arrayBuffer);
  // Auto-detect base64: raw DST has ':' (0x3A) at byte 2
  if (data.length >= 3 && data[2] !== 0x3A) {
    try {
      const b64 = new TextDecoder('ascii').decode(data).replace(/\s/g, '');
      data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    } catch(e) {}
  }
  if (data.length < HEADER_SIZE) throw new Error(`File too short (${data.length} bytes) — not a valid DST file`);
  const header  = parseHeader(data);
  const records = parseRecords(data.slice(HEADER_SIZE));
  if (records.length === 0) throw new Error('No stitch records found after header');
  return { header, records };
}

// ── DSB (Barudan) Parsing ─────────────────────────────────────────────────────
// Record layout: [ctrl, y_raw, x_raw]
// y = -y_raw by default; bit 0x40 in ctrl negates y again (→ positive); bit 0x20 negates x.
// lo5 == 0 → stitch, lo5 == 1 → jump/move; special ctrl bytes: E7=trim E8=stop E9-F7=needle F8=end.
function decodeRecordDsb(ctrl, y_raw, x_raw) {
  if (ctrl === 0xF8) return { is_end:true };
  if (ctrl === 0xE7) return { dx:0, dy:0, is_jump:false, is_color_change:false, is_explicit_trim:true,  is_explicit_stop:false, needle_no:null, is_end:false };
  if (ctrl === 0xE8) return { dx:0, dy:0, is_jump:false, is_color_change:false, is_explicit_trim:false, is_explicit_stop:true,  needle_no:null, is_end:false };
  if (ctrl >= 0xE9 && ctrl <= 0xF7) return { dx:0, dy:0, is_jump:false, is_color_change:true, is_explicit_trim:false, is_explicit_stop:false, needle_no:ctrl-0xE8, is_end:false };
  const lo5 = ctrl & 0x1F;
  if (lo5 !== 0 && lo5 !== 1) return null;  // uncaught control byte — stop decoding
  let x = x_raw;
  let y = -y_raw;
  if (ctrl & 0x40) y = -y;
  if (ctrl & 0x20) x = -x;
  return { dx:x*UNIT_TO_MM, dy:y*UNIT_TO_MM, is_jump:lo5===1, is_color_change:false, is_explicit_trim:false, is_explicit_stop:false, needle_no:null, is_end:false };
}

// ── DSZ (ZSK) Parsing ────────────────────────────────────────────────────────
// Layout per pyembroidery's DszReader (no official spec): [y_raw, x_raw, ctrl].
// y = -y_raw by default; bit 0x20 negates y again; bit 0x40 negates x.
// lo5 == 0 → stitch, lo5 == 1 → jump; 0x82=stop 0x9B=trim 0x83-0x9A=needle (two codes per needle).
// No end code is defined — the stream runs to end of file.
const DSZ_STOP = 0x82, DSZ_TRIM = 0x9B, DSZ_NEEDLE_BASE = 0x83, DSZ_MAX_NEEDLE = 12;
function decodeRecordDsz(y_raw, x_raw, ctrl) {
  const lo5 = ctrl & 0x1F;
  if (lo5 === 0 || lo5 === 1) {
    let x = x_raw;
    let y = -y_raw;
    if (ctrl & 0x40) x = -x;
    if (ctrl & 0x20) y = -y;
    return { dx:x*UNIT_TO_MM, dy:y*UNIT_TO_MM, is_jump:lo5===1, is_color_change:false, is_explicit_trim:false, is_explicit_stop:false, needle_no:null, is_end:false };
  }
  if (ctrl === DSZ_STOP) return { dx:0, dy:0, is_jump:false, is_color_change:false, is_explicit_trim:false, is_explicit_stop:true,  needle_no:null, is_end:false };
  if (ctrl === DSZ_TRIM) return { dx:0, dy:0, is_jump:false, is_color_change:false, is_explicit_trim:true,  is_explicit_stop:false, needle_no:null, is_end:false };
  if (ctrl >= DSZ_NEEDLE_BASE && ctrl <= 0x9A) return { dx:0, dy:0, is_jump:false, is_color_change:true, is_explicit_trim:false, is_explicit_stop:false, needle_no:((ctrl-DSZ_NEEDLE_BASE)>>1)+1, is_end:false };
  return null;
}

// A needle command before the first stitch selects the starting needle; it is
// returned as startNeedle rather than kept as a color change.
function parseRecordsExplicit(bytes, decode) {
  const records = [];
  let startNeedle = null, hadStitch = false;
  const n = Math.floor(bytes.length / RECORD_SIZE) * RECORD_SIZE;
  for (let i = 0; i < n; i += RECORD_SIZE) {
    const rec = decode(bytes[i], bytes[i+1], bytes[i+2]);
    if (!rec || rec.is_end) break;
    if (!hadStitch && rec.is_color_change) { startNeedle = rec.needle_no; continue; }
    if (!rec.is_jump && !rec.is_color_change && !rec.is_explicit_trim && !rec.is_explicit_stop) hadStitch = true;
    records.push(rec);
  }
  return { records, startNeedle };
}

function loadExplicitBytes(arrayBuffer, format) {
  const data = new Uint8Array(arrayBuffer);
  if (data.length < HEADER_SIZE) throw new Error(`File too short (${data.length} bytes) — not a valid ${format.toUpperCase()} file`);
  const header  = parseHeader(data);
  header.format = format;
  const decode = format === 'dsz' ? decodeRecordDsz : decodeRecordDsb;
  const { records, startNeedle } = parseRecordsExplicit(data.slice(HEADER_SIZE), decode);
  header.start_needle = startNeedle;
  if (records.length === 0) throw new Error('No stitch records found after header');
  return { header, records };
}

// DSB and DSZ carry explicit stop/trim/needle commands; DST infers them.
function hasExplicitCommands(header) { return header.format === 'dsb' || header.format === 'dsz'; }

function loadEmbFile(file, arrayBuffer) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'dsb' || ext === 'dsz') return loadExplicitBytes(arrayBuffer, ext);
  return loadDstBytes(arrayBuffer);
}

// Build a colorIndex → needleNo map for DSB files. A needle command applies to the
// stitches after it: colorIdx 0 is the starting needle, colorIdx N the Nth needle change.
// For DST, returns {} — callers fall back to colorIdx+1 (sequential).
function buildColorToNeedle(header, records) {
  if (!hasExplicitCommands(header)) return {};
  const map = {};
  if (header.start_needle != null) map[0] = header.start_needle;
  let colorIdx = 0;
  for (const rec of records) {
    if (rec.is_color_change) {
      colorIdx++;
      if (rec.needle_no != null) map[colorIdx] = rec.needle_no;
    }
  }
  return map;
}

// ── DST/DSB Conversion ────────────────────────────────────────────────────────

// Rebuild a 512-byte header block from a parsed header object.
// Preserves the original label/counts but updates CO for the new format if needed.
function buildSharedHeader(header, colorChanges) {
  const co = colorChanges !== undefined ? colorChanges : header.color_changes;
  const pad5 = v => String(v >= 0 ? v : 0).padStart(5, ' ');
  const pad7 = v => String(v >= 0 ? v : 0).padStart(7, ' ');
  const pad3 = v => String(v >= 0 ? v : 0).padStart(3, ' ');
  const pad6 = v => String(v).padStart(6, ' ');
  const signPad = v => (v >= 0 ? '+' : '-') + String(Math.abs(v)).padStart(5, ' ');
  const fields = [
    `LA:${(header.label || 'DST').slice(0, 16).padEnd(16,' ')}`,
    `ST:${pad7(header.stitch_count)}`,
    `CO:${pad3(co)}`,
    `+X:${pad5(header.x_pos)}`,
    `-X:${pad5(header.x_neg)}`,
    `+Y:${pad5(header.y_pos)}`,
    `-Y:${pad5(header.y_neg)}`,
    `AX:${pad6(header.ax || 0)}`,
    `AY:${pad6(header.ay || 0)}`,
    `MX:${signPad(header.mx || 0)}`,
    `MY:${signPad(header.my || 0)}`,
    `PD:******`,
  ];
  // Fields separated by CR; end with CRLF to match Barudan DSB convention.
  const line = fields.join('\r') + '\r\n';
  const buf = new Uint8Array(HEADER_SIZE);
  buf.fill(0x20); // pad with spaces
  const enc = new TextEncoder();
  const encoded = enc.encode(line);
  buf.set(encoded.slice(0, HEADER_SIZE));
  // No ctrl-Z at 0x1FF — Barudan DSB files leave this as a space.
  return buf;
}

// Encode one axis value (in DST units, ±121 max) into the 5 weight bits.
// Returns an object with {b0bits, b1bits} where bits are placed at the
// specified shift positions.  Uses minimize-|residual| greedy over [81,27,9,3,1].
function encodeDstAxis(val, shifts) {
  // shifts = [{weight, b0shift, b1shift, b2bit, b2neg}]
  const weights   = [81, 27, 9, 3, 1];
  // For x: +w bit positions in b0/b1/b2, -w bit positions
  // shifts encodes: [{w, posB, negB}] where posB/negB are [byteIdx, bitShift]
  let b0 = 0, b1 = 0, b2 = 0;
  let rem = val;
  for (let wi = 0; wi < weights.length; wi++) {
    const w = weights[wi];
    const { posB, negB } = shifts[wi];
    // choose +w, -w, or 0 — minimize |residual|
    const rp = rem - w;
    const rn = rem + w;
    const r0 = rem;
    if (Math.abs(rp) <= Math.abs(rn) && Math.abs(rp) <= Math.abs(r0)) {
      rem = rp;
      if (posB[0] === 0) b0 |= (1 << posB[1]);
      else if (posB[0] === 1) b1 |= (1 << posB[1]);
      else b2 |= (1 << posB[1]);
    } else if (Math.abs(rn) < Math.abs(r0)) {
      rem = rn;
      if (negB[0] === 0) b0 |= (1 << negB[1]);
      else if (negB[0] === 1) b1 |= (1 << negB[1]);
      else b2 |= (1 << negB[1]);
    }
    // else 0 contribution
  }
  return { b0, b1, b2, residual: rem };
}

const DST_X_SHIFTS = [
  { w:81, posB:[2,2], negB:[2,3] },
  { w:27, posB:[1,2], negB:[1,3] },
  { w:9,  posB:[0,2], negB:[0,3] },
  { w:3,  posB:[1,0], negB:[1,1] },
  { w:1,  posB:[0,0], negB:[0,1] },
];
const DST_Y_SHIFTS = [
  { w:81, posB:[2,5], negB:[2,4] },
  { w:27, posB:[1,5], negB:[1,4] },
  { w:9,  posB:[0,5], negB:[0,4] },
  { w:3,  posB:[1,7], negB:[1,6] },
  { w:1,  posB:[0,7], negB:[0,6] },
];

// Encode one DST stitch record. dx/dy in mm. Returns Uint8Array(3).
// Splits large moves into multiple records (max ±12.1mm per record).
function encodeDstRecords(dx_mm, dy_mm, type) {
  // type: 'stitch'|'jump'|'cc'|'end'
  const MM_TO_UNIT = 1 / UNIT_TO_MM;
  const MAX_STEP = 121;
  let rx = Math.round(dx_mm * MM_TO_UNIT);
  let ry = Math.round(dy_mm * MM_TO_UNIT);
  const out = [];

  // Split into multiple jump records if needed
  while (Math.abs(rx) > MAX_STEP || Math.abs(ry) > MAX_STEP) {
    const sx = Math.max(-MAX_STEP, Math.min(MAX_STEP, rx));
    const sy = Math.max(-MAX_STEP, Math.min(MAX_STEP, ry));
    out.push(_dstRecord(sx, sy, 'jump'));
    rx -= sx;
    ry -= sy;
  }

  out.push(_dstRecord(rx, ry, type));
  return out;
}

function _dstRecord(xu, yu, type) {
  const xr = encodeDstAxis(xu, DST_X_SHIFTS);
  const yr = encodeDstAxis(yu, DST_Y_SHIFTS);
  let b0 = xr.b0 | yr.b0;
  let b1 = xr.b1 | yr.b1;
  let b2 = xr.b2 | yr.b2;
  if      (type === 'end')    b2 |= 0xF3;
  else if (type === 'cc')     b2 |= 0xC3;
  else if (type === 'jump')   b2 |= 0x83;
  else                        b2 |= 0x03;  // stitch
  return new Uint8Array([b0 & 0xFF, b1 & 0xFF, b2 & 0xFF]);
}

// Encode one DSB move record. dx/dy in mm. Returns Uint8Array(3).
// ctrl: bit 7 always set; bit 6 = +Y; bit 5 = -X; bit 0 = jump (needle up), clear = stitch.
function encodeDsbMoveRecord(dx_mm, dy_mm, is_jump) {
  const MM_TO_UNIT = 1 / UNIT_TO_MM;
  const xu = Math.round(dx_mm * MM_TO_UNIT);
  const yu = Math.round(dy_mm * MM_TO_UNIT);
  let ctrl = 0x80;
  if (xu < 0) ctrl |= 0x20;
  if (yu > 0) ctrl |= 0x40;
  if (is_jump) ctrl |= 0x01;
  return new Uint8Array([ctrl, Math.abs(yu) & 0xFF, Math.abs(xu) & 0xFF]);
}

// Encode one DSZ move record: [y_raw, x_raw, ctrl]. Mirrors decodeRecordDsz.
// ctrl: bit 7 set (as on every DSZ command code); bit 5 = +Y; bit 6 = -X; bit 0 = jump.
function encodeDszMoveRecord(dx_mm, dy_mm, is_jump) {
  const MM_TO_UNIT = 1 / UNIT_TO_MM;
  const xu = Math.round(dx_mm * MM_TO_UNIT);
  const yu = Math.round(dy_mm * MM_TO_UNIT);
  let ctrl = 0x80;
  if (xu < 0) ctrl |= 0x40;
  if (yu > 0) ctrl |= 0x20;
  if (is_jump) ctrl |= 0x01;
  return new Uint8Array([Math.abs(yu) & 0xFF, Math.abs(xu) & 0xFF, ctrl]);
}

// Split a large move into multiple records if needed (max 255 units per axis).
function encodeDsbRecords(dx_mm, dy_mm, is_jump, encode = encodeDsbMoveRecord) {
  const MM_TO_UNIT = 1 / UNIT_TO_MM;
  const MAX_STEP = 255;
  let rx = Math.round(dx_mm * MM_TO_UNIT);
  let ry = Math.round(dy_mm * MM_TO_UNIT);
  const out = [];
  while (Math.abs(rx) > MAX_STEP || Math.abs(ry) > MAX_STEP) {
    const sx = Math.max(-MAX_STEP, Math.min(MAX_STEP, rx));
    const sy = Math.max(-MAX_STEP, Math.min(MAX_STEP, ry));
    out.push(encode(sx * UNIT_TO_MM, sy * UNIT_TO_MM, true));
    rx -= sx;
    ry -= sy;
  }
  out.push(encode(rx * UNIT_TO_MM, ry * UNIT_TO_MM, is_jump));
  return out;
}

const EXPLICIT_FORMATS = {
  dsb: { label: 'DSB', maxNeedle: 15, move: encodeDsbMoveRecord,
         stop: [0xE8, 0, 0], trim: [0xE7, 0, 0], needle: n => [0xE8 + n, 0, 0], end: [0xF8, 0, 0] },
  dsz: { label: 'DSZ', maxNeedle: DSZ_MAX_NEEDLE, move: encodeDszMoveRecord,
         stop: [0, 0, DSZ_STOP], trim: [0, 0, DSZ_TRIM], needle: n => [0, 0, DSZ_NEEDLE_BASE + 2 * (n - 1)], end: null },
};

// Convert DST records → DSB or DSZ byte stream (header + records + end).
// needleMap: optional array where [0] = starting needle, [1..n] = needle for each real CC.
//   Missing entries fall back to sequential (start=1, CC1=2, CC2=3, …).
// DST jumps map 1:1 to jump records (ctrl bit 0); like working Barudan files,
// no trims are inserted around jump sequences.
function convertToExplicit(header, records, needleMap, trimBeforeStop, format) {
  const F = EXPLICIT_FORMATS[format];
  const bufs = [];
  const cmd = bytes => bufs.push(new Uint8Array(bytes));
  const checkNeedle = (n, what) => {
    if (n < 1 || n > F.maxNeedle) throw new Error(`${F.label} supports needles 1–${F.maxNeedle}; ${what} is set to needle ${n}.`);
    return n;
  };
  let colorChangeCount = 0;

  cmd(F.needle(checkNeedle(needleMap && needleMap[0] ? needleMap[0] : 1, 'the starting thread')));

  const header_ccs = header.color_changes >= 0 ? header.color_changes : Infinity;
  let real_ccs_seen = 0;

  for (let ri = 0; ri < records.length; ri++) {
    const rec = records[ri];
    if (rec.is_color_change) {
      const next_is_cc = (ri+1 < records.length) && records[ri+1].is_color_change;
      const is_stop = next_is_cc || (real_ccs_seen >= header_ccs);
      if (is_stop) {
        if (trimBeforeStop) cmd(F.trim);
        cmd(F.stop);
      } else {
        const mapEntry = needleMap && needleMap[real_ccs_seen + 1];
        const needleNo = checkNeedle(mapEntry || (real_ccs_seen + 2), `color change ${real_ccs_seen + 1}`);
        real_ccs_seen++;
        colorChangeCount++;
        cmd(F.needle(needleNo));
      }
    } else {
      for (const r of encodeDsbRecords(rec.dx, rec.dy, rec.is_jump, F.move)) bufs.push(r);
    }
  }
  if (F.end) cmd(F.end);

  const hdr = buildSharedHeader(header, colorChangeCount);
  const total = HEADER_SIZE + bufs.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  out.set(hdr, 0);
  let off = HEADER_SIZE;
  for (const b of bufs) { out.set(b, off); off += b.length; }
  return out;
}

// Convert DSB/DSZ records → DST byte stream (header + records + end).
function convertToDst(header, records) {
  const bufs = [];
  let colorChangeCount = 0;

  for (const rec of records) {
    if (rec.is_explicit_stop) {
      // DST: stop = CC + CC (two consecutive with no displacement)
      bufs.push(...encodeDstRecords(0, 0, 'cc'));
      bufs.push(...encodeDstRecords(0, 0, 'cc'));
    } else if (rec.is_explicit_trim) {
      // DST has no explicit trim — emit 3 zero-displacement jumps (pyembroidery convention)
      bufs.push(...encodeDstRecords(0, 0, 'jump'));
      bufs.push(...encodeDstRecords(0, 0, 'jump'));
      bufs.push(...encodeDstRecords(0, 0, 'jump'));
    } else if (rec.is_color_change) {
      colorChangeCount++;
      bufs.push(...encodeDstRecords(0, 0, 'cc'));
    } else {
      for (const r of encodeDstRecords(rec.dx, rec.dy, rec.is_jump ? 'jump' : 'stitch')) bufs.push(r);
    }
  }
  bufs.push(...encodeDstRecords(0, 0, 'end'));

  const hdr = buildSharedHeader(header, colorChangeCount);
  const total = HEADER_SIZE + bufs.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  out.set(hdr, 0);
  let off = HEADER_SIZE;
  for (const b of bufs) { out.set(b, off); off += b.length; }
  return out;
}
