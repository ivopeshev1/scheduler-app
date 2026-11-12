import { NextResponse } from "next/server";
import { runShiftReminders } from "@/lib/send-shift-reminders";

/**
 * Shift-reminders dispatch route. Intended to be hit once an hour so
 * each staffer's chosen local-time reminder window gets picked up
 * exactly once.
 *
 * Note: Vercel's Hobby plan caps crons to DAILY schedules, so the
 * hourly schedule can't live in vercel.json yet. Options:
 *   - Upgrade the Vercel project to Pro and add
 *     { path: "/api/cron/shift-reminders", schedule: "0 * * * *" } to
 *     vercel.json.
 *   - Point a free external cron service (cron-job.org, EasyCron,
 *     Google Cloud Scheduler on free tier) at
 *     https://<deploy>/api/cron/shift-reminders?key=<AUTH_SECRET>
 *     every hour.
 * Until one of those is wired up, reminders fire only on manual
 * invocation of this endpoint.
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
