/**
 * Public /sms-opt-in page. Built for Twilio A2P 10DLC review: reviewers
 * can't log in, so this page shows exactly how staff opt in to texts
 * (the checkbox and its wording, as it appears on the staff profile
 * page), what we send, how often, and how to opt out.
 *
 * Plain-prose, no AppHeader: must be reachable without a session.
 */
export const metadata = { title: "SMS Opt-In — Scheduler by Flair Projects SB" };

export default function SmsOptInPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-10 text-sm leading-6 text-gray-800">
      <h1 className="text-2xl font-semibold mb-2">Shift text messages: how staff opt in</h1>
      <p className="text-gray-500 mb-8">Scheduler, operated by Flair Projects SB</p>

      <p className="mb-4">
        Scheduler is the staffing tool Flair Projects SB uses to schedule its event
        staff (bartenders, bar backs and event leads). Staff can choose to get text
        messages about their shifts. Texts are only sent to staff who opt in
        themselves, and opting in is never required to work with us.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">How opt-in works</h2>
      <ol className="list-decimal pl-5 mb-4 space-y-1">
        <li>A manager invites the staff member to Scheduler by email.</li>
        <li>The staff member signs in and opens their profile page (My profile).</li>
        <li>They enter their mobile number and confirm it with a 6-digit code.</li>
        <li>
          They check the box &ldquo;Text me about my shifts&rdquo; (shown below) and
          save. The box is unchecked by default.
        </li>
      </ol>

      <p className="mb-2 font-medium">The opt-in checkbox, exactly as staff see it:</p>
      <div className="border border-gray-300 rounded-lg p-4 mb-4 bg-white">
        <div className="text-xs font-medium text-gray-600 mb-1">Mobile phone</div>
        <div className="border border-gray-300 rounded px-3 py-2 text-gray-400 mb-3">(555) 555-0123</div>
        <label className="flex items-start gap-2">
          <input type="checkbox" disabled className="mt-0.5" aria-label="Text me about my shifts (example)" />
          <span className="text-sm">
            <span className="font-medium">Text me about my shifts</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Shift invites, day-before reminders, and schedule changes sent to this
              number by Flair Projects SB. Message frequency varies. Msg &amp; data
              rates may apply. Reply STOP to any text to opt out. See our{" "}
              <a href="/privacy" className="underline">privacy policy</a> and{" "}
              <a href="/terms" className="underline">terms</a>.
            </span>
          </span>
        </label>
      </div>
      <p className="mb-4 text-gray-500 text-xs">
        This is a non-working example for reference. The real checkbox is on the staff
        profile page after sign-in.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">What we send</h2>
      <p className="mb-2">
        Shift invitations, shift confirmations, day-before shift reminders, and
        schedule changes or cancellations. No marketing or promotional messages.
        Example messages:
      </p>
      <ul className="list-disc pl-5 mb-4 space-y-1">
        <li>&ldquo;Flair Projects SB: You&rsquo;ve been invited to work Bartender at Private Home, Malibu on Thu, Dec 3. Open [link] to accept or decline. Reply STOP to opt out.&rdquo;</li>
        <li>&ldquo;Flair Projects SB: Reminder - you&rsquo;re on shift tomorrow (Thu, Dec 3) at Private Home, Malibu, check in at 4:00 PM. Reply STOP to opt out.&rdquo;</li>
      </ul>

      <h2 className="text-lg font-semibold mt-8 mb-2">Frequency, cost and opting out</h2>
      <ul className="list-disc pl-5 mb-4 space-y-1">
        <li>Message frequency varies with how many shifts you&rsquo;re invited to.</li>
        <li>Message and data rates may apply.</li>
        <li>Reply <strong>STOP</strong> to any text to opt out at any time, or uncheck the box in your profile.</li>
        <li>
          Reply <strong>HELP</strong> for help, or email{" "}
          <a href="mailto:info@flairprojectsb.com" className="underline">info@flairprojectsb.com</a>.
        </li>
        <li>Carriers are not liable for delayed or undelivered messages.</li>
      </ul>
      <p className="mb-4">
        <strong>We do not share or sell your mobile number or SMS opt-in information
        with third parties or affiliates for marketing or promotional purposes.</strong>
      </p>

      <p className="mt-8">
        <a href="/privacy" className="underline">Privacy policy</a>
        {" · "}
        <a href="/terms" className="underline">Terms of service</a>
      </p>
    </main>
  );
}
