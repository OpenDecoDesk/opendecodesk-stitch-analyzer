// The drawing's SVG export (buildSvg in stitch_analyzer/web/index.html) must be well-formed XML:
// strict renderers such as rsvg refuse a file with a raw < or & in its text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
// A Windows checkout may have CRLF line endings, which the patterns below would otherwise miss.
const read = p => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const F = vm.createContext({ TextDecoder, TextEncoder, atob, btoa });
vm.runInContext(read('stitch_analyzer/web/formats.js'), F, { filename: 'formats.js' });

// buildSvg lives in the page's inline script, which also drives the DOM, so only its pieces are run here.
const page = read('stitch_analyzer/web/index.html');
const grab = re => { const m = page.match(re); assert.ok(m, `not found in index.html: ${re}`); return m[0]; };
vm.runInContext([
  grab(/^const COLOR_PALETTE = .*$/m),
  grab(/^const xmlEscape = .*$/m),
  grab(/^function buildSvg\([\s\S]*?\n\}\n/m),
].join('\n'), F, { filename: 'index.html' });

const FIXTURES = JSON.parse(read('tests/fixtures/conversions.json'));
const fromHex = h => Uint8Array.from(h.match(/../g), b => parseInt(b, 16));

// Every < opens a tag and every & starts an entity; anything else means invalid XML.
const strayMarkup = svg => [...svg.matchAll(/<(?![A-Za-z/!?])|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g)]
  .map(m => svg.slice(Math.max(0, m.index - 30), m.index + 30));

for (const [name, fx] of Object.entries(FIXTURES)) {
  test(`${name}: the SVG's legend and title are escaped`, () => {
    const { header, records } = F.loadDstBytes(fromHex(fx.dst).buffer);
    const svg = F.buildSvg(records, header, 7, 1, 'R&D <draft>.dst', 3);
    assert.deepEqual(strayMarkup(svg), []);
    assert.match(svg, />Short \(&lt; 1 mm\)</);
    assert.match(svg, />Long \(&gt; 7 mm\)</);
    assert.match(svg, />R&amp;D &lt;draft&gt;\.dst</);
  });
}
