import { Hono } from "hono";
import { isAuthenticated } from "../../middleware/session.js";
import {
  getQuotaGuardSnapshot,
  manualDisable,
  manualEnable,
  setSchedulerEnabled,
  setProviderExcluded,
  getExcludedProviders,
} from "../../utils/quota-guard.js";

const quotaGuard = new Hono();

const checkAdmin = (c: any) => {
  if (!isAuthenticated(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
};

// GET /admin/quota-guard/status
quotaGuard.get("/quota-guard/status", async (c) => {
  const authErr = checkAdmin(c);
  if (authErr) return authErr;

  const snapshot = getQuotaGuardSnapshot();
  return c.json(snapshot);
});

// POST /admin/quota-guard/disable
quotaGuard.post("/quota-guard/disable", async (c) => {
  const authErr = checkAdmin(c);
  if (authErr) return authErr;

  const body = await c.req.json<{ providerAlias: string; type: "model" | "connection" | "category"; id: string }>();
  if (!body.providerAlias || !body.type || !body.id) {
    return c.json({ error: "Missing providerAlias, type, or id" }, 400);
  }

  const ok = await manualDisable(body.providerAlias, body.type, body.id);
  return c.json({ success: ok });
});

// POST /admin/quota-guard/enable
quotaGuard.post("/quota-guard/enable", async (c) => {
  const authErr = checkAdmin(c);
  if (authErr) return authErr;

  const body = await c.req.json<{ providerAlias: string; type: "model" | "connection" | "category"; id: string }>();
  if (!body.providerAlias || !body.type || !body.id) {
    return c.json({ error: "Missing providerAlias, type, or id" }, 400);
  }

  const ok = await manualEnable(body.providerAlias, body.type, body.id);
  return c.json({ success: ok });
});

// PUT /admin/quota-guard/scheduler
quotaGuard.put("/quota-guard/scheduler", async (c) => {
  const authErr = checkAdmin(c);
  if (authErr) return authErr;

  const body = await c.req.json<{ enabled?: boolean }>();
  if (typeof body.enabled === "boolean") {
    setSchedulerEnabled(body.enabled);
  }

  return c.json({ success: true, enabled: body.enabled });
});

// PUT /admin/quota-guard/provider — toggle guard for a specific provider
quotaGuard.put("/quota-guard/provider", async (c) => {
  const authErr = checkAdmin(c);
  if (authErr) return authErr;

  const body = await c.req.json<{ provider: string; excluded: boolean }>();
  if (!body.provider || typeof body.excluded !== "boolean") {
    return c.json({ error: "Missing provider or excluded" }, 400);
  }

  setProviderExcluded(body.provider, body.excluded);
  return c.json({ success: true, excludedProviders: getExcludedProviders() });
});

export default quotaGuard;
