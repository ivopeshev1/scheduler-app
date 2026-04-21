import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Lazy connection — avoids crashing the Next build when DATABASE_URL
// is missing (e.g. initial Vercel deploy before the Postgres add-on is attached).
let _db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "Database not configured. Set DATABASE_URL in Vercel Storage → create a Postgres store."
    );
  }
  const sql: NeonQueryFunction<false, false> = neon(url);
  _db = drizzle(sql, { schema });
  return _db;
}

// Proxy so `db.select()...` works while still deferring connection until first call.
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_t, prop) {
    const real = getDb();
    const value = (real as any)[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
