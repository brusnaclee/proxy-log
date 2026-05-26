const fs = require('fs');
let file = 'packages/proxy/src/routes/admin/internal.ts';
let content = fs.readFileSync(file, 'utf8');

const newGetPeriodStats = 
  async function getTopModels(since: string) {
    return db.select({
      model: requestLogs.model,
      requests: sql<number>\count(*)\,
      tokens: sql<number>\COALESCE(SUM(total_tokens), 0)\,
    })
    .from(requestLogs)
    .where(and(
      eq(requestLogs.apiKeyId, keyId),
      sql\created_at >= \\,
      sql\is_counted_request IS NOT 0\
    ))
    .groupBy(requestLogs.model)
    .orderBy(sql\count(*) DESC\)
    .limit(3)
    .all();
  }

  async function getPeriodStats(since: string) {
    return db.select({;

content = content.replace(/\s*async function getPeriodStats\(since: string\) \{\s*return db\.select\(\{/g, '\n' + newGetPeriodStats);

const newPromiseAll = 
  const [todayStats, monthStats, todayModels, monthModels] = await Promise.all([
    getPeriodStats(todayStr),
    getPeriodStats(monthStr),
    getTopModels(todayStr),
    getTopModels(monthStr),
  ]);;

content = content.replace(/\s*const \[todayStats, monthStats\] = await Promise\.all\(\[\s*getPeriodStats\(todayStr\),\s*getPeriodStats\(monthStr\),\s*\]\);/g, '\n' + newPromiseAll);

content = content.replace('estimatedCost: todayStats?.estimatedCost || 0,', 'estimatedCost: todayStats?.estimatedCost || 0,\n        topModels: todayModels,');
content = content.replace('estimatedCost: monthStats?.estimatedCost || 0,', 'estimatedCost: monthStats?.estimatedCost || 0,\n        topModels: monthModels,');

fs.writeFileSync(file, content);
console.log('Patched internal.ts');
