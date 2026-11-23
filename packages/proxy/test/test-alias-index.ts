/**
 * Verify buildAutoMetaIndex resolves BOTH the published and raw vendor id.
 * This is the bug that made every multiplier Infinity.
 */
import { buildAutoMetaIndex } from '../src/utils/auto-selection.js';

(async () => {
  const idx = await buildAutoMetaIndex();
  console.log('index size:', idx.size);

  // Candidate ids as they arrive from model_monitor (raw upstream vendor).
  const raw = [
    'phantom/amanai/glm-5.3',
    'phantom/amanai/deepseek-v4.1-flash',
    'grok/gcli/grok-4.7',
  ];
  // Published ids as the catalog exposes them.
  const pub = [
    'phantom/vibecode/glm-5.3',
    'phantom/vibecode/deepseek-v4.1-flash',
    'grok/gcli/grok-4.7',
  ];

  let pass = 0, fail = 0;
  const check = (n: string, c: boolean, d = '') => {
    if (c) { pass++; console.log('  PASS  ' + n); }
    else { fail++; console.log('  FAIL  ' + n + (d ? ' -> ' + d : '')); }
  };

  for (const id of pub) {
    const m = idx.get(id);
    check(`published id resolves: ${id}`, !!m, JSON.stringify(m));
  }
  for (const id of raw) {
    const m = idx.get(id);
    check(`raw upstream id resolves: ${id}`, !!m, JSON.stringify(m));
  }

  // The whole point: a resolved entry must carry a finite multiplier.
  const sample = idx.get('phantom/amanai/deepseek-v4.1-flash');
  check('raw id carries a finite multiplier',
    !!sample && Number.isFinite(sample.multiplier as number),
    JSON.stringify(sample));
  check('raw id carries modalities',
    !!sample && Array.isArray(sample.inputModalities) && sample.inputModalities.length > 0,
    JSON.stringify(sample?.inputModalities));

  // Vision flag must survive the alias hop.
  check('vision flag present on raw id',
    !!sample && sample.inputModalities.includes('image'),
    JSON.stringify(sample?.inputModalities));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
