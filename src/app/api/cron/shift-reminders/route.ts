import { NextResponse } from "next/server";
import { runShiftReminders } from "@/lib/send-shift-reminders";

/**
 * Hourly cron that sends day-before + morning-of shift reminders. Each
 * staffer's chosen hour is in their local tz, so running the loop every
 * hour is enough to catch everyone's window exactly once.
 *
 * Auth matches the other cron entrypoints: Vercel's bearer secret or a
 * manual ?key= for browser-triggered dry-runs.
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
    const result = await runShiftReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron] shift-reminders failed:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
