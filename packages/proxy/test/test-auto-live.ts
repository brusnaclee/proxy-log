/**
 * End-to-end assertion on LIVE catalog data:
 * every candidate returned for an image request must be vision-capable.
 */
import { rankAutoCandidates, buildAutoMetaIndex } from '../src/utils/auto-selection.js';
import { getOnlineModelsByLatency } from './src/utils/model-catalog.js';
import { isAutoCompatible } from './src/utils/model-catalog.js';

(async () => {
  let pass = 0, fail = 0;
  const check = (n: string, c: boolean, d = '') => {
    if (c) { pass++; console.log('  PASS  ' + n); }
    else { fail++; console.log('  FAIL  ' + n + (d ? ' -> ' + d : '')); }
  };

  const raw = await getOnlineModelsByLatency();
  const pool = raw.filter((m: any) => isAutoCompatible(m.modelId));
  const meta = await buildAutoMetaIndex();
  const key = (m: any) => `${m.provider}/${m.modelId}`;

  console.log(`online pool: ${pool.length}, meta index: ${meta.size}`);

  // --- how many pool entries actually resolve metadata (the alias fix)? ---
  const resolved = pool.filter((m: any) => meta.get(key(m)));
  const withMult = resolved.filter((m: any) => {
    const v = meta.get(key(m))?.multiplier;
    return typeof v === 'number' && Number.isFinite(v);
  });
  check(`every pool entry resolves metadata (${resolved.length}/${pool.length})`,
    resolved.length === pool.length,
    `unresolved: ${pool.filter((m: any) => !meta.get(key(m))).map(key).join(', ')}`);
  check(`every resolved entry has a finite multiplier (${withMult.length}/${pool.length})`,
    withMult.length === pool.length);

  // --- text: cheap first, expensive last ---
  const textRanked = rankAutoCandidates(pool as any, {
    needsVision: false,
    metaFor: (pm: string) => meta.get(pm) ?? null,
  });
  const mults = textRanked.map((r: any) => r.multiplier);
  const sortedAsc = [...mults].sort((a, b) => a - b);
  check('text pool is ordered cheapest-first',
    JSON.stringify(mults) === JSON.stringify(sortedAsc),
    mults.slice(0, 5).join(','));
  check('text pick is NOT gpt-6-astra (25x)',
    !String(textRanked[0]?.modelId).includes('astra'), String(textRanked[0]?.modelId));
  check('text pick is NOT claude-opus-5.5 (8.3x)',
    !String(textRanked[0]?.modelId).includes('opus-5.5'), String(textRanked[0]?.modelId));
  console.log(`        -> text picks: ${textRanked[0]?.modelId} (${textRanked[0]?.multiplier}x)`);

  // --- image: every result must be vision-capable ---
  const imgRanked = rankAutoCandidates(pool as any, {
    needsVision: true,
    metaFor: (pm: string) => meta.get(pm) ?? null,
  });
  const nonVision = imgRanked.filter((r: any) => !r.vision);
  check(`image pool contains ONLY vision models (${imgRanked.length} candidates)`,
    nonVision.length === 0,
    nonVision.map((r: any) => r.modelId).join(','));
  check('image pool is smaller than text pool (filter is active)',
    imgRanked.length < textRanked.length,
    `img=${imgRanked.length} text=${textRanked.length}`);
  check('image pick is vision-capable', imgRanked[0]?.vision === true);
  console.log(`        -> image picks: ${imgRanked[0]?.modelId} (${imgRanked[0]?.multiplier}x)`);

  // --- the text-only models MUST be absent from the image pool ---
  const textOnlyIds = pool
    .filter((m: any) => !(meta.get(key(m))?.inputModalities || []).includes('image'))
    .map(key);
  const leaked = imgRanked.filter((r: any) => textOnlyIds.includes(key(r)));
  check(`no text-only model leaks into image pool (${textOnlyIds.length} text-only)`,
    leaked.length === 0, leaked.map(key).join(','));

  // --- expensive models are present but last ---
  const expensive = imgRanked.filter((r: any) => r.multiplier > 6);
  if (expensive.length) {
    const firstExpensive = imgRanked.findIndex((r: any) => r.multiplier > 6);
    check('expensive models are ordered after cheap ones',
      imgRanked.slice(0, firstExpensive).every((r: any) => r.multiplier <= 6));
  } else {
    check('no expensive model in image pool (all <= 6x)', true);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
