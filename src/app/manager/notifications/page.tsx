import { redirect } from "next/navigation";

/**
 * Notification rules were folded back into /manager/settings. Keep this route
 * around as a redirect so older bookmarks / links from earlier sessions still
 * land somewhere sensible instead of 404'ing.
 */
export default function NotificationSettingsRedirect() {
  redirect("/manager/settings");
}
