// The Quality tab's Calibrate suggestions (computeSpeedCalibration in stitch_analyzer/web/index.html)
// must each close the predicted/actual gap on their own when fed back into the speed model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
// A Windows checkout may have CRLF line endings, which the patterns below would otherwise miss.
const read = p => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const page = read('stitch_analyzer/web/index.html');
const grab = re => { const m = page.match(re); assert.ok(m, `not found in index.html: ${re}`); return m[0]; };
const F = vm.createContext({});
vm.runInContext([
  grab(/^function makeDefaultQualityThresholds\(\)[\s\S]*?\n\}\n/m),
  grab(/^const SPEED_FACTOR_PRIORITY = .*$/m),
  grab(/^function stitchLengthReductionFrac\([\s\S]*?\n\}\n/m),
  grab(/^function wideSatinReductionFrac\([\s\S]*?\n\}\n/m),
  grab(/^function analyzeSpeed\([\s\S]*?\n\}\n/m),
  grab(/^function computeSpeedCalibration\([\s\S]*?\n\}\n/m),
  'this.makeDefaultQualityThresholds = makeDefaultQualityThresholds;',
  'this.analyzeSpeed = analyzeSpeed; this.computeSpeedCalibration = computeSpeedCalibration;',
].join('\n'), F, { filename: 'index.html' });

// One fill block: a mix of normal, short and long stitches, plus 15 trims and 13 color changes,
// so the speed model has both stitching time and trim/CC time to work with.
const events = [];
for (let i = 0; i < 3000; i++) {
  events.push({
    distMm: [2.5, 0.6, 3.0, 8.5, 1.8][i % 5],
    hasJump: i % 997 === 0,
    isTrim: i % 200 === 7,
    ccBefore: i % 235 === 11,
  });
}
const blocks = [{ index: 0, stitchType: 'fill' }];
const run = overrides => F.analyzeSpeed(blocks, [events],
  Object.assign(F.makeDefaultQualityThresholds(), { machineSpeedSpm: 700 }, overrides), []);

const base = run({});
const overheadMinutes = (base.trimOverheadSeconds + base.ccOverheadSeconds) / 60;
assert.equal(base.trimCount, 15);
assert.equal(base.ccCount, 13);

for (const factor of [0.85, 1.2]) {
  const actualMinutes = base.totalMinutes * factor;
  const label = factor < 1 ? 'machine ran faster than predicted' : 'machine ran slower than predicted';

  test(`${label}: the suggested Max speed reproduces the real time`, () => {
    const c = F.computeSpeedCalibration({ speed: base }, actualMinutes);
    if (factor < 1) assert.ok(c.suggestedMachineSpeedSpm > 700, 'a too-slow model needs a higher speed');
    else assert.ok(c.suggestedMachineSpeedSpm < 700, 'a too-fast model needs a lower speed');
    const rerun = run({ machineSpeedSpm: c.suggestedMachineSpeedSpm });
    assert.ok(Math.abs(rerun.totalMinutes - actualMinutes) < 1e-6, `${rerun.totalMinutes} vs ${actualMinutes}`);
  });

  test(`${label}: the suggested trim/CC times reproduce the real time`, () => {
    const c = F.computeSpeedCalibration({ speed: base }, actualMinutes);
    assert.ok(c.overheadCanCloseGap);
    const rerun = run({ trimSeconds: c.suggestedTrimSeconds, ccSeconds: c.suggestedCcSeconds });
    assert.ok(Math.abs(rerun.totalMinutes - actualMinutes) < 1e-6, `${rerun.totalMinutes} vs ${actualMinutes}`);
  });
}

test('a gap bigger than all the trim/CC time is reported as one trim/CC time cannot close', () => {
  const c = F.computeSpeedCalibration({ speed: base }, base.totalMinutes - overheadMinutes - 0.5);
  assert.equal(c.overheadCanCloseGap, false);
  assert.ok(c.suggestedMachineSpeedSpm > 700);
});

test('a real time shorter than the trim/CC time alone gets no Max speed suggestion', () => {
  const c = F.computeSpeedCalibration({ speed: base }, overheadMinutes * 0.9);
  assert.equal(c.suggestedMachineSpeedSpm, null);
});
