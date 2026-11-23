/**
 * Verify auto-selection policy: cheap-first, vision-gated, expensive-last.
 * Run with: node --experimental-strip-types test-auto-selection.ts
 */
import {
  rankAutoCandidates,
  requestHasImage,
  AUTO_MAX_MULTIPLIER,
} from '../src/utils/auto-selection.ts';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

// ── fixtures: real multipliers from the live catalog ────────────────────────
const MULT: Record<string, number> = {
  'phantom/vibecode/gpt-6-astra': 25,
  'phantom/vibecode/claude-opus-5.5': 8.3,
  'phantom/vibecode/gpt-5.6-sol': 8.3,
  'phantom/vibecode/claude-sonnet-4.6': 6.3,
  'phantom/vibecode/glm-5.3': 4.7,
  'phantom/vibecode/deepseek-v4.1-flash': 2.1,
  'phantom/vibecode/qwen3.8-flash': 2.5,
};
const VISION = new Set([
  'phantom/vibecode/gpt-6-astra',
  'phantom/vibecode/claude-opus-5.5',
  'phantom/vibecode/gpt-5.6-sol',
  'phantom/vibecode/claude-sonnet-4.6',
  'phantom/vibecode/glm-5.3',
  'phantom/vibecode/deepseek-v4.1-flash',
  'phantom/vibecode/qwen3.8-flash',
]);
// text-only cheap model
const TEXT_ONLY_CHEAP = 'phantom/vibecode/text-only-cheap';
MULT[TEXT_ONLY_CHEAP] = 1.5;

function mk(id: string, latency: number) {
  const [provider, ...rest] = id.split('/');
  return { modelId: rest.join('/'), provider, latencyMs: latency, baseUrl: '' };
}
const metaFor = (pm: string) => {
  if (!(pm in MULT)) return null;
  return { multiplier: MULT[pm], inputModalities: VISION.has(pm) ? ['text', 'image'] : ['text'] };
};

console.log('\n== 1. cheap model leads, expensive model is last ==');
{
  const pool = [
    mk('phantom/vibecode/gpt-6-astra', 100),        // fastest but 25x
    mk('phantom/vibecode/deepseek-v4.1-flash', 3000), // slowest but 2.1x
    mk('phantom/vibecode/glm-5.3', 800),
  ];
  const r = rankAutoCandidates(pool, { needsVision: false, metaFor });
  check('first pick is the cheapest, not the fastest',
    r[0].modelId.includes('deepseek'), r[0].modelId);
  check('gpt-6-astra (25x) is last', r[r.length - 1].modelId.includes('astra'),
    r[r.length - 1].modelId);
}

console.log('\n== 2. image request only sees vision models ==');
{
  const pool = [
    mk(TEXT_ONLY_CHEAP, 50),                 // cheapest overall but text-only
    mk('phantom/vibecode/deepseek-v4.1-flash', 900),
  ];
  const r = rankAutoCandidates(pool, { needsVision: true, metaFor });
  check('text-only cheap model excluded from image request',
    !r.some(x => x.modelId.includes('text-only')), r.map(x => x.modelId).join(','));
  check('a vision model is chosen', r.length > 0 && r[0].vision === true);
}

console.log('\n== 3. no vision model -> empty list, not a wrong pick ==');
{
  const pool = [mk(TEXT_ONLY_CHEAP, 50)];
  const r = rankAutoCandidates(pool, { needsVision: true, metaFor });
  check('returns empty so caller errors clearly', r.length === 0, String(r.length));
}

console.log('\n== 4. text request may use a vision model (superset is fine) ==');
{
  const pool = [mk('phantom/vibecode/deepseek-v4.1-flash', 500)];
  const r = rankAutoCandidates(pool, { needsVision: false, metaFor });
  check('vision model allowed for text', r.length === 1);
}

console.log('\n== 5. expensive only reachable as fallback ==');
{
  const pool = [
    mk('phantom/vibecode/deepseek-v4.1-flash', 900),
    mk('phantom/vibecode/claude-opus-5.5', 200),
    mk('phantom/vibecode/gpt-6-astra', 300),
  ];
  const r = rankAutoCandidates(pool, { needsVision: false, metaFor });
  const cheapIdx = r.findIndex(x => x.multiplier <= 3);
  const expIdx = r.findIndex(x => x.multiplier > AUTO_MAX_MULTIPLIER);
  check('cheap tier comes before expensive tier', cheapIdx < expIdx,
    `cheap@${cheapIdx} expensive@${expIdx}`);
  check('pool still contains the expensive models (fallback preserved)',
    r.length === 3);
}

console.log('\n== 6. missing metadata fails safe ==');
{
  const pool = [mk('unknown/model-x', 100)];
  const r = rankAutoCandidates(pool, { needsVision: false, metaFor: () => null });
  check('unknown model still rankable for text', r.length === 1);
  const rv = rankAutoCandidates(pool, { needsVision: true, metaFor: () => null });
  check('unknown model NOT used for image (treated text-only)', rv.length === 0);
}

console.log('\n== 7. requestHasImage detects every client shape ==');
{
  check('openai image_url',
    requestHasImage({ messages: [{ role: 'user', content: [
      { type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: 'data:...' } }] }] }));
  check('anthropic source base64 image',
    requestHasImage({ messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } }] }] }));
  check('gemini inlineData',
    requestHasImage({ contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: 'image/jpeg', data: 'x' } }] }] }));
  check('plain text is not an image',
    !requestHasImage({ messages: [{ role: 'user', content: 'hello' }] }));
  check('empty body is not an image', !requestHasImage({}));
  check('null body is not an image', !requestHasImage(null));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
