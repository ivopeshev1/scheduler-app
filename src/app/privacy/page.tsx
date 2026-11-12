/**
 * Public /privacy page. Required by Twilio A2P 10DLC campaign
 * registration — carriers will reject the campaign if this URL 404s
 * or if it omits the mobile-number-non-sharing clause, the message
 * frequency note, or the "message and data rates may apply"
 * disclosure. All three are below in the SMS section.
 *
 * Plain-prose, no AppHeader — this must be reachable without a
 * session, both for Twilio reviewers and for end users who follow
 * the link from the opt-in page.
 */
export const metadata = { title: "Privacy Policy — Scheduler" };

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-10 text-sm leading-6 text-gray-800">
      <h1 className="text-2xl font-semibold mb-2">Privacy Policy</h1>
      <p className="text-gray-500 mb-8">Last updated: November 11, 2026</p>

      <p className="mb-4">
        Scheduler is operated by Flair Projects SB (&ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy
        explains what personal data we collect from staffers and managers who use
        Scheduler, how we use it, and the choices you have.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">What we collect</h2>
      <p className="mb-4">
        When a manager invites you to the platform and you complete your profile,
        we collect: your name, email address, mobile phone number, city, date of
        birth, uniform size, emergency contact name and phone number, a profile
        photo (optional), and the role / rate information your manager configures
        for you. For each shift you accept, we store the shift details
        (date, time, venue, client, position, rate, notes).
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">How we use it</h2>
      <p className="mb-4">
        We use your information solely to operate Scheduler: matching you to
        shifts, calculating pay, notifying you about shift invitations and
        changes, and giving your manager the roster and contact information they
        need to run the event. We do not sell your personal information. We do
        not use it for advertising.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">SMS notifications</h2>
      <p className="mb-4">
        If you opt in to SMS during profile setup, we will text you about shift
        invitations, confirmations, day-before reminders, and schedule changes
        or cancellations from a US long code operated by Flair Projects SB.
      </p>
      <p className="mb-4">
        <strong>Message frequency varies</strong> based on how many shifts you
        are invited to and confirmed on; most staffers receive between 0 and
        10 messages per week.
        <strong> Message and data rates may apply</strong> depending on your
        mobile carrier plan.
      </p>
      <p className="mb-4">
        <strong>We do not share or sell your mobile phone number or any SMS opt-in
        information with third parties or affiliates for marketing or promotional
        purposes.</strong> Your mobile number is used only to deliver the SMS
        notifications you opted in to receive.
      </p>
      <p className="mb-4">
        You can opt out of SMS at any time by replying <strong>STOP</strong> to
        any text, by turning off SMS in your profile settings, or by asking your
        manager to remove you from the platform. Reply <strong>HELP</strong> for
        support information.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Who can see your information</h2>
      <p className="mb-4">
        Within your company, managers with roster access can see your name,
        phone number, email, role, and the shifts you&apos;re on. Other staffers
        who are confirmed on the same shift can see your name, role, and phone
        number through the shift roster. Nothing is visible to people outside
        your company.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Service providers</h2>
      <p className="mb-4">
        We use the following vendors to operate Scheduler: Vercel (hosting),
        Neon (database), Resend (email delivery), and Twilio (SMS delivery).
        These providers process data on our behalf under their own security and
        privacy terms, and do not receive your information for their own use.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Retention and deletion</h2>
      <p className="mb-4">
        We retain your profile and shift history while your account is active.
        If your manager removes you from the platform, your account is archived
        and your personal fields (phone, DOB, emergency contact, photo) are
        cleared. You may request full deletion by asking your manager or
        emailing us at the address below.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Contact</h2>
      <p className="mb-4">
        Questions about this policy or your data?
        Email <a href="mailto:info@flairprojectsb.com" className="text-blue-700 underline">info@flairprojectsb.com</a>.
      </p>
    </main>
  );
}
