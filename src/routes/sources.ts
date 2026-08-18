import { Hono } from "hono";
import { getDb } from "../db/client";
import { sources } from "../db/schema";
import type { RoleContext } from "../middleware/admin";

export const sourcesRouter = new Hono<RoleContext>();

sourcesRouter.get("/sources", async (c) => {
  const db = await getDb();
  const rows = await db.select().from(sources);
  return c.json({ items: rows });
});
