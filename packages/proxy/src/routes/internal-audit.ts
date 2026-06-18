import { Hono } from "hono";
import { isInternalRequest } from "../middleware/session.js";
import { auditSnapshot, resetAllTrials } from "./admin/internal.js";

const audit = new Hono();

audit.get("/internal/audit", (c) => {
	if (!isInternalRequest(c)) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	return c.json(auditSnapshot());
});

audit.post("/internal/reset-all-trials", async (c) => {
	if (!isInternalRequest(c)) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const result = await resetAllTrials();
	return c.json({ success: true, ...result });
});

export default audit;

