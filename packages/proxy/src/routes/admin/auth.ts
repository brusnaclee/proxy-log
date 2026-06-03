import { Hono } from "hono";
import { db } from "../../db/index.js";
import { adminConfig } from "../../db/schema.js";
import { createSession, destroySession, isAuthenticated } from "../../middleware/session.js";

const auth = new Hono();

auth.post("/login", async (c) => {
  const { password } = await c.req.json<{ password: string }>();
  if (!password) return c.json({ error: "Password is required" }, 400);

  const config = (await db.select().from(adminConfig))[0];
  if (!config) return c.json({ error: "Admin not configured" }, 500);

  const { verify } = await import("@node-rs/argon2");
  const isValid = await verify(config.passwordHash, password);
  if (!isValid) return c.json({ error: "Invalid password" }, 401);

  createSession(c);
  return c.json({ success: true, message: "Logged in successfully" });
});

auth.post("/logout", (c) => {
  destroySession(c);
  return c.json({ success: true, message: "Logged out" });
});

auth.get("/me", (c) => {
  return c.json({ authenticated: isAuthenticated(c) });
});

export default auth;
