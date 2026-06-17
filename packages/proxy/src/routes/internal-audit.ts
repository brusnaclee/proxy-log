import { Hono } from "hono";
import { isInternalRequest } from "../middleware/session.js";
import { auditSnapshot } from "./admin/internal.js";

const audit = new Hono();

audit.get("/internal/audit", (c) => {
	if (!isInternalRequest(c)) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	return c.json(auditSnapshot());
});

export default audit;
