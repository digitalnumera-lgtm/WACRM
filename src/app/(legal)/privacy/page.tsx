import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Numera Digital — Privacy policy',
  description: 'How Numera Digital handles information in its internal WhatsApp conversation monitoring workspace.',
}

export default function PrivacyPage() {
  return <>
    <h1>Privacy policy</h1>
    <p className="text-sm text-muted-foreground">Last updated: 16 October 2026</p>
    <section><h2>Who operates this workspace</h2>
      <p>Numera Digital operates this CRM as an internal management workspace to review business conversations between its agents and clients. Access is intended for authorized owners and administrators. Agents continue using their existing WhatsApp Business apps; clients and agents do not need a login to this management workspace.</p>
      <p>Questions about this policy or your information can be sent to <a href="mailto:digitalnumera@gmail.com">digitalnumera@gmail.com</a>.</p>
    </section>
    <section><h2>Information processed</h2>
      <p>Depending on the authorized integration and events received, the workspace may process:</p>
      <ul>
        <li>Client phone numbers, WhatsApp identifiers and profile names supplied with messages.</li>
        <li>Incoming messages and outgoing agent phone-app replies, message timestamps, delivery-related events, media identifiers and captions.</li>
        <li>Business number identifiers, agent labels, conversation lead statuses and the history of management changes.</li>
        <li>Webhook event payloads, including unsupported or history events retained for review. Retaining an event does not mean historical chats have been imported.</li>
        <li>Management account information, authentication sessions and operational logs. Channel access credentials are stored encrypted.</li>
      </ul>
      <p>Media references are not a durable archive of the underlying media. The workspace does not automatically gain access to all WhatsApp conversations on a device; receipt depends on the business number&apos;s authorization and supported integration.</p>
    </section>
    <section><h2>Purpose and access</h2>
      <p>Numera Digital uses this information for management oversight, customer-service follow-up, lead tracking, accountability, security and troubleshooting. The CRM is configured for monitoring: sending messages, broadcasts, automations and AI replies are disabled.</p>
      <p>Application access to conversations is restricted to authorized company owners and administrators and scoped to their company. Infrastructure administrators and service providers may process information as needed to operate and support the service. Numera Digital is responsible for providing appropriate notices and obtaining any authorization required for monitoring business conversations.</p>
    </section>
    <section><h2>Service providers and disclosures</h2>
      <p>The integration uses Meta/WhatsApp for messaging events, Supabase for authentication and database storage, and Hostinger for application hosting. These providers process relevant information under their own terms and privacy policies. Depending on provider configurations, information may be processed outside your country. Information may also be disclosed when required by applicable law or to protect the service and its users.</p>
    </section>
    <section><h2>Storage, security and retention</h2>
      <p>The application uses HTTPS, role-based access restrictions, webhook signature verification and encryption of stored channel credentials. No system can guarantee absolute security.</p>
      <p>The current workspace has no automatic age-based deletion schedule. Stored conversations and events remain until they are removed through an administrative process. Numera Digital reviews retention and deletion requests in light of business needs and applicable legal requirements. Copies in provider backups may remain until those backups expire under the provider&apos;s retention arrangements.</p>
    </section>
    <section><h2>Cookies and local storage</h2>
      <p>Management login uses authentication cookies. Browser storage may retain interface preferences such as theme. These support access to and operation of the workspace.</p>
    </section>
    <section><h2>Your requests</h2>
      <p>Clients whose conversations are stored, agents whose business activity is monitored, and management account holders can contact Numera Digital to request information, correction or deletion of their data, or raise a concern. Applicable rights depend on your jurisdiction. We may need to verify your identity and connection to the affected records before acting.</p>
      <p>See <Link href="/data-deletion">data deletion instructions</Link> for the request process. A CRM login is not required to submit a request.</p>
    </section>
    <section><h2>Changes to this policy</h2>
      <p>Updates will be posted on this page with a revised date. Contact Numera Digital if you need clarification about how this workspace handles your information.</p>
    </section>
  </>
}
