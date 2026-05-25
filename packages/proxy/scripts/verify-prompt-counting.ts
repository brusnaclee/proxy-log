import { createClient } from "@libsql/client";

const client = createClient({ url: "file:./data/gateway.db" });

async function verify() {
  console.log("=== VERIFICATION REPORT ===\n");
  
  // 1. Check sessions with suspicious ratios
  const suspicious = await client.execute(`
    SELECT 
      session_id,
      request_count,
      prompt_count,
      CAST(request_count AS REAL) / NULLIF(prompt_count, 0) as ratio,
      last_user_message_hash,
      last_message_role,
      last_tool_calls_active
    FROM chat_sessions
    WHERE prompt_count > 0 AND request_count > 0
    ORDER BY ratio DESC
    LIMIT 10
  `);
  
  console.log("Top 10 sessions by request:prompt ratio:");
  console.table(suspicious.rows);
  
  // 2. Check tool call detection
  const toolStats = await client.execute(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN has_tool_calls = 1 THEN 1 ELSE 0 END) as with_tools_old,
      SUM(CASE WHEN actual_tool_calls_in_response = 1 THEN 1 ELSE 0 END) as with_tools_new
    FROM request_logs
  `);
  
  console.log("\nTool call detection:");
  console.table(toolStats.rows);
  
  // 3. Check message role distribution
  const roleStats = await client.execute(`
    SELECT 
      message_role,
      COUNT(*) as count
    FROM request_logs
    WHERE message_role IS NOT NULL
    GROUP BY message_role
    ORDER BY count DESC
  `);
  
  console.log("\nMessage role distribution:");
  console.table(roleStats.rows);
  
  // 4. Overall stats
  const overall = await client.execute(`
    SELECT 
      COUNT(*) as total_sessions,
      SUM(request_count) as total_requests,
      SUM(prompt_count) as total_prompts,
      AVG(CAST(request_count AS REAL) / NULLIF(prompt_count, 0)) as avg_ratio
    FROM chat_sessions
    WHERE prompt_count > 0
  `);
  
  console.log("\nOverall statistics:");
  console.table(overall.rows);
  
  // 5. Check recent sessions with new tracking
  const recent = await client.execute(`
    SELECT 
      session_id,
      request_count,
      prompt_count,
      last_message_role,
      last_tool_calls_active,
      last_seen_at
    FROM chat_sessions
    ORDER BY last_seen_at DESC
    LIMIT 5
  `);
  
  console.log("\nRecent sessions:");
  console.table(recent.rows);
  
  await client.close();
}

verify().catch(console.error);
