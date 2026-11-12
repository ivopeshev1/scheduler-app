/**
 * Public /terms page. Required by Twilio A2P 10DLC campaign
 * registration — carriers will reject the campaign if this URL 404s.
 * Covers the SMS program terms, which Twilio reviewers specifically
 * look for (opt-in methods, STOP/HELP keywords, message frequency,
 * message-and-data-rates disclosure).
 *
 * Plain-prose, no AppHeader — reachable without a session.
 */
export const metadata = { title: "Terms of Service — Scheduler" };

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-10 text-sm leading-6 text-gray-800">
      <h1 className="text-2xl font-semibold mb-2">Terms of Service</h1>
      <p className="text-gray-500 mb-8">Last updated: November 11, 2026</p>

      <p className="mb-4">
        These terms govern your use of Scheduler, the event-staffing platform
        operated by Flair Projects SB (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating or
        using an account on Scheduler, you agree to these terms.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Accounts</h2>
      <p className="mb-4">
        Accounts are created by invitation from a manager at your company. You
        agree to keep your login credentials secure, to provide accurate
        information in your profile, and to only use the platform for shifts
        you are legitimately invited to.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Acceptable use</h2>
      <p className="mb-4">
        You may not use Scheduler to harass other users, misrepresent your
        availability, impersonate anyone, interfere with the service, or attempt
        to access data that is not yours. We may suspend or terminate accounts
        that violate these terms.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">SMS program terms</h2>
      <p className="mb-4">
        If you opt in to SMS notifications in your profile, you consent to
        receive text messages from Flair Projects SB related to shift
        invitations, confirmations, day-before reminders, and schedule changes.
      </p>
      <p className="mb-4">
        <strong>Message frequency varies</strong> based on how many shifts you
        are invited to and confirmed on.
        <strong> Message and data rates may apply</strong> depending on your
        mobile carrier plan.
      </p>
      <p className="mb-4">
        To opt out at any time, reply <strong>STOP</strong> to any text. To get
        help, reply <strong>HELP</strong> or email
        <a href="mailto:info@flairprojectsb.com" className="text-blue-700 underline"> info@flairprojectsb.com</a>.
        You may also disable SMS in your profile settings, or ask your manager
        to remove you from the platform.
      </p>
      <p className="mb-4">
        Carriers are not liable for delayed or undelivered messages. We cannot
        guarantee that a given message will be delivered.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Fees</h2>
      <p className="mb-4">
        Scheduler is provided to staffers at no charge. Your mobile carrier may
        charge you for text messages and data usage per the SMS program terms
        above.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Changes</h2>
      <p className="mb-4">
        We may update these terms. Material changes will be communicated by
        email or an in-app notice. Continued use of the platform after a change
        takes effect constitutes acceptance of the updated terms.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Disclaimers and liability</h2>
      <p className="mb-4">
        Scheduler is provided &ldquo;as is.&rdquo; To the extent permitted by law, we
        disclaim implied warranties and are not liable for indirect, incidental,
        or consequential damages arising from use of the platform.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Contact</h2>
      <p className="mb-4">
        Questions about these terms?
        Email <a href="mailto:info@flairprojectsb.com" className="text-blue-700 underline">info@flairprojectsb.com</a>.
      </p>
    </main>
  );
}
