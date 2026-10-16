import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Numera Digital — Data deletion requests',
  description: 'How to request deletion of information held in Numera Digital’s internal monitoring CRM without a CRM login.',
}

export default function DataDeletionPage() {
  return <>
    <h1>Data deletion requests</h1>
    <p className="text-sm text-muted-foreground">Last updated: 16 October 2026</p>
    <p>These instructions apply to information held in Numera Digital&apos;s internal conversation-monitoring CRM. Clients, agents and management account holders can submit a request. You do not need a CRM account or login.</p>
    <section><h2>1. Submit your request</h2>
      <p>Email <a href="mailto:digitalnumera@gmail.com?subject=Numera%20CRM%20data%20deletion%20request">digitalnumera@gmail.com</a> with the subject <strong>Numera CRM data deletion request</strong>.</p>
      <ul>
        <li>Provide your name and a reply email address.</li>
        <li>For conversation records, provide your WhatsApp number with country code and, if known, the Numera business number you contacted and approximate dates.</li>
        <li>For a management account, provide the email address used for that account.</li>
        <li>Explain which information you want deleted and whether you are requesting for yourself or as an authorized representative.</li>
      </ul>
      <p>Do not send passwords, access tokens, encryption keys or complete chat histories. Do not send identity documents unless we first explain why a specific verification step is necessary.</p>
    </section>
    <section><h2>2. Verification and review</h2>
      <p>Numera Digital will review the request and may ask for limited additional information to verify your identity, authority and the relevant records. We will communicate the outcome or any additional steps by email. You can request a status update using the same email thread.</p>
      <p>Requests are handled manually, not through an automatic deletion button. Timing depends on verification and the request&apos;s scope, subject to applicable legal deadlines.</p>
    </section>
    <section><h2>3. Scope of deletion</h2>
      <p>Where applicable, the review covers matching CRM conversations, messages, retained webhook payloads, related lead records and audit entries, and management account information. Some information may need to be retained to meet legal obligations, resolve disputes or protect security; any applicable limitation will be explained in the response.</p>
      <p>Deletion from this CRM does not delete messages from another person&apos;s WhatsApp device, Meta&apos;s systems, or a separate service such as WabaCRM. Requests concerning those copies must be handled through the relevant service or account holder. Provider backup copies may remain until their retention period expires.</p>
    </section>
    <section><h2>More information</h2>
      <p>Read our <Link href="/privacy">privacy policy</Link> for details about the information processed and the purpose of this management workspace.</p>
    </section>
  </>
}
