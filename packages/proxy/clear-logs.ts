import { db } from "./src/db/index.js";
import { requestLogs, chatSessions } from "./src/db/schema.js";

async function clearLogs() {
  console.log("Menghapus data request_logs...");
  await db.delete(requestLogs).run();
  
  console.log("Menghapus data chat_sessions...");
  await db.delete(chatSessions).run();

  console.log("✅ Database berhasil dibersihkan dari logs dan sessions!");
  process.exit(0);
}

clearLogs().catch(err => {
  console.error("Gagal membersihkan database:", err);
  process.exit(1);
});