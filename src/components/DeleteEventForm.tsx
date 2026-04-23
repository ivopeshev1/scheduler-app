"use client";

type Props = {
  eventId: string;
  action: (formData: FormData) => Promise<void>;
};

/**
 * Separated into a client component so we can attach an onSubmit confirm()
 * that's strict enough to prevent accidental deletes. The inner form hits a
 * server action that hard-deletes the event - no emails go out, no staff
 * gets notified even if invitations were already sent.
 */
export function DeleteEventForm({ eventId, action }: Props) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const ok = window.confirm(
          "Permanently delete this event?\n\n" +
          "• All positions, invitations, and staff data for this event will be removed.\n" +
          "• Nobody will be notified - even if invitations were already sent.\n" +
          "• This cannot be undone.\n\n" +
          "Click OK to delete."
        );
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="eventId" value={eventId} />
      <button
        type="submit"
        className="btn btn-secondary text-red-700 border-red-300 hover:bg-red-50"
        title="Permanently delete this event without notifying anyone"
      >
        Delete
      </button>
    </form>
  );
}
