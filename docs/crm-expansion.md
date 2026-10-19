# Numera CRM expansion

Requested outcome: one company-owned CRM covering the inbox, contact management,
media, reporting, number onboarding and operational workflows the owner values in
WabaCRM, Chatwoot and respond.io. This is a capability scope, not a claim of complete
parity with every feature or subscription tier of those products.

## Access and operating model

The previously approved production model remains owner/admin monitoring, with
agents using their existing WhatsApp Business phone apps. A question about whether
management or agents should also send from this CRM is pending. No transport guard
has been removed and no campaign, AI reply or external message has been activated.
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
| Replies and templates | Upstream sending, template, reaction and media code exists; blocked in monitoring mode | Adapt to monitoring channels/threads, explicit roles, service-window rules, status reconciliation and idempotency |
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
4. Optional management/agent composer and templates once the access model is
   resolved. Test with isolated fixtures before any real message is sent.
5. Campaigns, workflows, AI, other channels and advanced reporting as separately
   testable integrations. Never expose a menu item that merely simulates success.

## Current report/export limits

Message logs export the visible page (up to 50 records), explicitly labelled in
the UI. Reports include at most 10,000 most recent stored records for the selected
UTC period. A partial report states the included and total count and carries that
coverage label in CSV. Delivery/read rates are not inferred from outgoing counts.
Media is fetched on demand from Meta, not archived by this change.
