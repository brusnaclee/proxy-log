// Smoke-test the hand-rolled PNG chart renderer with realistic history data.
const { renderRequestsChart, renderLineChart } = require('./src/chart-png.js');
const fs = require('node:fs');

const history = {
  model: 'phantom/vibecode/glm-5.3-flash',
  range: '7d',
  bucket: 'day',
  points: [
    { t: '2026-11-12T00:00:00Z', req: 12, ok: 12, fail: 0, p50: 4200, p95: 6100, tps: 98, inTok: 12000, outTok: 3400, cachedTok: 900 },
    { t: '2026-11-13T00:00:00Z', req: 4, ok: 2, fail: 2, p50: 5100, p95: 7300, tps: 71, inTok: 4000, outTok: 900, cachedTok: 100 },
    { t: '2026-11-14T00:00:00Z', req: 18, ok: 18, fail: 0, p50: 3900, p95: 5200, tps: 112, inTok: 21000, outTok: 6100, cachedTok: 2000 },
    { t: '2026-11-15T00:00:00Z', req: 9, ok: 8, fail: 1, p50: 4800, p95: 6800, tps: 88, inTok: 9800, outTok: 2700, cachedTok: 700 },
    { t: '2026-11-16T00:00:00Z', req: 0, ok: 0, fail: 0, p50: null, p95: null, tps: null, inTok: 0, outTok: 0, cachedTok: 0 },
    { t: '2026-11-17T00:00:00Z', req: 21, ok: 21, fail: 0, p50: 3350, p95: 4700, tps: 124, inTok: 24500, outTok: 7200, cachedTok: 3100 },
    { t: '2026-11-18T00:00:00Z', req: 7, ok: 7, fail: 0, p50: 4100, p95: 5900, tps: 101, inTok: 8100, outTok: 2200, cachedTok: 550 },
  ],
  totals: { req: 71, ok: 68, fail: 3, successRate: 95.77, p50: 4200, p95: 6500, tps: 99.5, inTok: 79400, outTok: 22500, cachedTok: 7350, activeDays: 6 },
};

fs.writeFileSync('test-requests.png', renderRequestsChart(history));
fs.writeFileSync('test-latency.png', renderLineChart(history, 'p50', [59, 130, 246, 255], 'LATENCY P50'));
fs.writeFileSync('test-tps.png', renderLineChart(history, 'tps', [168, 85, 247, 255], 'THROUGHPUT'));

for (const f of ['test-requests.png', 'test-latency.png', 'test-tps.png']) {
  const b = fs.readFileSync(f);
  const sigOk = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  console.log(`${f}: ${b.length}b png=${sigOk} ${w}x${h}`);
}
