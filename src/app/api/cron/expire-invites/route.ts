import { NextResponse } from "next/server";
import { runExpiryAndCascade } from "@/lib/cascade";

/**
 * Daily cron entrypoint. Vercel Cron hits this once a day (see vercel.json).
 * Also protected by a secret - we accept either:
 *   1. Vercel's automatic `Authorization: Bearer $CRON_SECRET` header (preferred)
 *   2. A manual `?key=AUTH_SECRET` query string, so the manager can trigger
 *      a dry-run from the browser when debugging.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";

  const okByVercel = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const okByManual = process.env.AUTH_SECRET && key === process.env.AUTH_SECRET;

  if (!okByVercel && !okByManual) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runExpiryAndCascade();
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
