# Numera CRM expansion

Requested outcome: one company-owned CRM covering the inbox, contact management,
media, reporting, number onboarding and operational workflows the owner values in
WabaCRM, Chatwoot and respond.io. This is a capability scope, not a claim of complete
parity with every feature or subscription tier of those products.

## Access and operating model

The owner selected management-only sending: owners/admins can reply from this CRM,
and agents continue using their existing WhatsApp Business phone apps. The new
management text-reply endpoint uses the monitoring channel/thread model. Legacy
agent sending, campaigns and AI reply transports remain blocked. No customer
message was sent during implementation or validation.
Connecting an existing number must preserve its working provider until a tested
onboarding/migration procedure is available.

## Inventory and delivery criteria

| Area | Current evidence | Work required for the expanded CRM |
| --- | --- | --- |
| Individual chat inbox | Management split inbox, incoming and phone-app outgoing messages, lead statuses, pagination | Unread/read state, open/resolved/snoozed queues, saved views, private notes, tags, assignment and audit |
| Contacts | Company-scoped directory, search, CSV import, related chats | Editable profiles, custom fields, segments, merge with audit, full exports and contact sync |
| Rich messages | Images, audio, video, stickers and documents with authenticated media fetch; reaction text | Reaction attachment to original messages across pages, edits/deletions, reply context, delivery states, unavailable-format presentation |
| Message logs | Added: full stored-body search, number/direction/type/date filters, pagination, page CSV export | Server-side large export jobs, delivery lifecycle filtering and retained source attribution |
| Media | Added: company-scoped searchable library with players/previews and chat links | Durable private object storage, retention policy, archive worker, backup/restore verification |
| Reporting | Added: UTC daily activity, incoming/outgoing volume, per-number and format breakdown, CSV | Response-time metrics, SLA, unread/open workload, team performance; requires reliable assignment/status model |
| Phone numbers | Portfolio discovery, manual entry, activate/pause, encrypted credentials | Eligible Meta Embedded Signup with coexistence, code exchange, subscription verification and lifecycle handling |
| Historical import | CSV/JSON records supported; WabaCRM export was imported | Durable queue and workers for native Meta history/contact events, progress, media enrichment, resume and reconciliation |
| Replies and templates | Management text composer/API implemented with admin checks, company scope, 24-hour window and durable request IDs; legacy transports blocked | Media/template composer, delivery-state reconciliation, reply context and recovery of accepted replies whose inbox write failed |
| Quick replies | Must audit reusable upstream UI/data before exposing | Saved snippets, variables, attachment support, permission checks |
| Teams | Upstream agents/account-role/invitation code exists | Integrate per-number and conversation access; assignment/audit; production role tests |
| Pipelines | Upstream pipelines exist; management lead-status changes work | Unify contacts, conversations and deals; ownership, stages, custom fields, reporting |
| Broadcasts | Upstream broadcasts exist; transport blocked | Verified consent and opt-outs, templates, scheduling, queue/retries, per-number throttling and campaign reports |
| Workflows/chatbots | Upstream automations/flows exist; blocked | Unified events, worker execution, retries, approvals where configured, logs and human handover |
| AI assistance | Upstream AI/provider/knowledge-base code exists; blocked | Configured provider, scoped retrieval, draft assistance, usage controls and evaluated human handover |
| Other channels/calling | Not established by this audit | Separate integrations, provider credentials, channel-specific policies and tests |
| Administration | Company role checks, private media access and lead audit exist | Unified settings, retention, backups, connection health, job monitoring and audit export |

An existing upstream route is not evidence that it works with the management
schema. Do not change NUMERA_MONITORING_ONLY to false as a shortcut: legacy
conversation storage differs from monitoring_channels/threads/messages.

## Meta history constraints verified against official documentation

Source, retrieved 2026-10-19:
https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users

- Coexistence onboarding requires the app owner to be a Solution Partner or Tech
  Provider according to the current requirements. App eligibility/configuration
  for Numera is not verified. Publication or an ordinary access token alone does
  not establish this capability.
- The phone owner approves sharing through the WhatsApp Business app. The app
  captures FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING and exchanges the OAuth code
  on its server. Registration of an already registered coexistence number is
  skipped.
- Contact and history sync must be initiated within 24 hours of onboarding via
  the SMB App Data API; this is not unrestricted retrieval of arbitrary history.
- Shared history can cover 180 days of individual chats. Group chats are excluded.
- History media identifiers arrive separately, and are provided only for media
  sent within 14 days of onboarding. Six months of text does not mean six months
  of recoverable attachments.
- History is chunked/phased and may arrive out of order. Capture durably before
  asynchronous processing. Deduplicate by channel plus original message ID;
  enrich placeholders when media arrives without incrementing message counts.
- Consent refusal (2593109), incomplete phases, contact removal, provider removal
  and expired access need visible states rather than a false success message.

Current webhook retains history and contact-sync payloads for review; it does not
yet perform that complete import workflow. Do not tell users to disconnect or
re-onboard as a workaround before readiness and a migration plan are established.

## Delivery order

1. Management data access: searchable logs, media library, truthful reports and
   exports; shipped code in this change, subject to deployment.
2. Native history pipeline and connection health, then eligible coexistence
   onboarding. Stage any required database migrations and worker setup separately;
   do not reset or replay the existing production schema.
3. Unified conversation model: status, notes, labels, assignments, contacts and
   durable media. Backfill existing messages without breaking current IDs.
4. Management-only composer and templates. Text replies are implemented; media
   and templates remain. Agents keep using their phones. Test with isolated
   fixtures and simulated Meta transport before any real message is sent.
5. Campaigns, workflows, AI, other channels and advanced reporting as separately
   testable integrations. Never expose a menu item that merely simulates success.

## Current report/export limits

Message logs export the visible page (up to 50 records), explicitly labelled in
the UI. Reports include at most 10,000 most recent stored records for the selected
UTC period. A partial report states the included and total count and carries that
coverage label in CSV. Delivery/read rates are not inferred from outgoing counts.
Media is fetched on demand from Meta, not archived by this change.

## Management replies

`POST /api/monitoring/threads/:id/reply` accepts an explicit text reply and a UUID
request ID after owner/admin authentication. It resolves the customer and sender
from the company-owned thread; the browser cannot supply a recipient or token.
The latest eligible incoming message must be less than 24 hours old. Meta remains
authoritative, including whether an imported message opened a service window.

An insert into `monitoring_events` reserves the request ID using its existing
primary key before the transport call. Retries reuse that ID. Explicit Graph
client errors are recorded as rejected; timeouts and ambiguous responses remain
uncertain and do not automatically retry the transport. Accepted means accepted
by Meta, not delivered or read. Results are recorded in the inbox through the
existing ingest RPC. Uncertain outcomes and accepted replies with failed inbox
writes remain in Events for review. Automatic reconciliation is not implemented.

The composer retains an in-flight request ID and text in browser session storage
so a refresh can check its status. It clears that draft on acceptance. Rate limits
are per process (30 attempts per manager per minute); multi-instance deployments
will need a shared rate limiter. The legacy monitoring-mode guard stays enabled;
the dedicated management endpoint is the deliberately scoped sending path.
