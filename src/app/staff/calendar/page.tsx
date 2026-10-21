import { redirect } from "next/navigation";
import { monthSlug } from "@/lib/month-grid";

/**
 * /staff/calendar bare entry — redirect to the current month so the URL
 * is always deep-linkable to a specific month.
 */
export default function StaffCalendarIndex() {
  const now = new Date();
  redirect(`/staff/calendar/${monthSlug(now.getUTCFullYear(), now.getUTCMonth() + 1)}`);
}
