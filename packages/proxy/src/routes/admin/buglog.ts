import { Hono } from "hono";
import { db } from "../../db/index.js";
import { requestLogs } from "../../db/schema.js";
import { sql, eq } from "drizzle-orm";

const buglog = new Hono();

// GET /buglog - List deduplicated bug groups
buglog.get("/buglog", async (c) => {
  const days = parseInt(c.req.query("days") || "7");
  const statusFilter = c.req.query("status");
  const limit = 500;

  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const conditions = [
    sql`${requestLogs.createdAt} >= ${sinceDate}`,
    sql`(${requestLogs.statusCode} >= 400 OR ${requestLogs.errorMessage} IS NOT NULL)`,
  ];

  if (statusFilter) {
    const status = parseInt(statusFilter);
    if (!isNaN(status)) {
      conditions.push(eq(requestLogs.statusCode, status));
    }
  }

  const whereClause = sql.join(conditions, sql` AND `);

  const rows = await db.execute(sql`
    SELECT
      ${requestLogs.statusCode} as status_code,
      COALESCE(${requestLogs.errorMessage}, '(no message)') as error_message,
      COALESCE(${requestLogs.model}, '(unknown)') as model,
      COALESCE(${requestLogs.endpointPath}, '(unknown)') as endpoint_path,
      COUNT(*) as count,
      MIN(id) as sample_id,
      MIN(${requestLogs.createdAt}) as first_seen,
      MAX(${requestLogs.createdAt}) as last_seen,
      array_agg(DISTINCT ${requestLogs.apiKeyId}) FILTER (WHERE ${requestLogs.apiKeyId} IS NOT NULL) as affected_users,
      array_agg(DISTINCT ${requestLogs.ideDetected}) FILTER (WHERE ${requestLogs.ideDetected} IS NOT NULL) as ide_detections,
      array_agg(DISTINCT ${requestLogs.provider}) FILTER (WHERE ${requestLogs.provider} IS NOT NULL) as providers
    FROM request_logs
    WHERE ${whereClause}
    GROUP BY ${requestLogs.statusCode}, ${requestLogs.errorMessage}, ${requestLogs.model}, ${requestLogs.endpointPath}
    ORDER BY count DESC
    LIMIT ${limit}
  `);

  const aliasIndex = await (await import("../../utils/vendor-aliases.js")).loadVendorAliasIndex();
  const { publicizeModelString } = await import("../../utils/vendor-aliases.js");
  const data = ((rows as any)?.rows || rows).map((row: any, idx: number) => ({
    id: idx + 1,
    statusCode: row.status_code,
    errorMessage: row.error_message,
    model: publicizeModelString(row.model, aliasIndex),
    endpointPath: row.endpoint_path,
    count: Number(row.count),
    sampleId: row.sample_id,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    affectedUsers: row.affected_users?.length || 0,
    ideDetections: row.ide_detections || [],
    providers: row.providers || [],
    signature: `${row.status_code}|${row.error_message}|${row.model}|${row.endpoint_path}`,
  }));

  const totalResult = await db.execute(sql`
    SELECT COUNT(*) as total FROM request_logs WHERE ${whereClause}
  `);
  const totalRow = (totalResult as any)?.rows?.[0] || (totalResult as any)?.[0];

  return c.json({
    data,
    total: Number(totalRow?.total || 0),
    days,
    limit,
  });
});

// DELETE /buglog/signature - Delete all requests matching a bug signature
buglog.delete("/buglog/signature", async (c) => {
  const body = await c.req.json<{ statusCode: number; errorMessage: string; model: string; endpointPath: string }>();

  const result = await db.execute(sql`
    DELETE FROM request_logs
    WHERE ${requestLogs.statusCode} = ${body.statusCode}
      AND COALESCE(${requestLogs.errorMessage}, '') = ${body.errorMessage || '(no message)'}
      AND COALESCE(${requestLogs.model}, '') = ${body.model || '(unknown)'}
      AND COALESCE(${requestLogs.endpointPath}, '') = ${body.endpointPath || '(unknown)'}
  `);

  return c.json({ success: true, deletedCount: (result as any)?.rowCount || 0 });
});

// DELETE /buglog/clear - Delete all error logs older than N days
buglog.delete("/buglog/clear", async (c) => {
  const days = parseInt(c.req.query("days") || "30");
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    DELETE FROM request_logs
    WHERE ${requestLogs.createdAt} < ${sinceDate}
      AND (${requestLogs.statusCode} >= 400 OR ${requestLogs.errorMessage} IS NOT NULL)
  `);

  return c.json({ success: true, deletedCount: (result as any)?.rowCount || 0 });
});

// DELETE /buglog/all - Delete all error logs
buglog.delete("/buglog/all", async (c) => {
  const result = await db.execute(sql`
    DELETE FROM request_logs
    WHERE ${requestLogs.statusCode} >= 400 OR ${requestLogs.errorMessage} IS NOT NULL
  `);

  return c.json({ success: true, deletedCount: (result as any)?.rowCount || 0 });
});

export default buglog;
