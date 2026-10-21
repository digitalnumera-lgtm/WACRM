# Numera CRM expansion

For the complete system handover, including which additions are still
uncommitted, see the [Numera CRM handbook](numera-crm-handbook.md).

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
| Individual chat inbox | Management split inbox, incoming and phone-app outgoing messages, lead statuses, continuous scrolling; added conversation status, shared CRM read markers and private notes | Global status queues, saved views, tags, assignment and workflow audit |
| Contacts | Company-scoped directory, search, CSV import, related chats | Editable profiles, custom fields, segments, merge with audit, full exports and contact sync |
| Rich messages | Images, audio, video, stickers and documents with authenticated media fetch; reaction text | Reaction attachment to original messages across pages, edits/deletions, reply context, delivery states, unavailable-format presentation |
| Message logs | Added: full stored-body search, number/direction/type/date filters, pagination, page CSV export | Server-side large export jobs, delivery lifecycle filtering and retained source attribution |
| Media | Added: company-scoped searchable library with players/previews and chat links | Durable private object storage, retention policy, archive worker, backup/restore verification |
| Reporting | Added: UTC daily activity, incoming/outgoing volume, per-number and format breakdown, CSV | Response-time metrics, SLA, unread/open workload, team performance; requires reliable assignment/status model |
| Phone numbers | Portfolio discovery, manual entry, activate/pause, encrypted credentials | Eligible Meta Embedded Signup with coexistence, code exchange, subscription verification and lifecycle handling |
| Historical import | CSV/JSON records supported; WabaCRM export was imported | Durable queue and workers for native Meta history/contact events, progress, media enrichment, resume and reconciliation |
| Replies and templates | Management text composer/API implemented with admin checks, company scope, 24-hour window and durable request IDs; legacy transports blocked | Media/template composer, delivery-state reconciliation, reply context and recovery of accepted replies whose inbox write failed |
| Quick replies | Added management-owned text library, search, create/edit/remove, variables and draft insertion | Attachment snippets, categories and keyboard shortcuts |
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

### Number management and inbox navigation

Business numbers now has Active and Removed tabs. Owners/admins can remove a
number from monitoring and restore it later. Removal sets the company-scoped
channel inactive; it retains credentials and saved conversations, skips future
webhook ingestion for that channel, and blocks new CRM replies. It does not
change Meta subscriptions, another provider, or the phone app. Restoring enables
future monitoring; messages missed while inactive are not automatically imported.
The confirmation identifies the affected number before any update.

The inbox has icon navigation, conversation initials, a clear-filters action,
mobile list/detail navigation and explicit Older/Newer messages controls. Saved
history is paginated in groups of 50; these controls do not fetch missing history
from Meta. Lead audit pagination is contained inside the collapsed lead history.

### Continuous inbox scrolling

The inbox now uses timestamp + row-ID cursors rather than page buttons. Open a
chat at the latest message and scroll up to append earlier saved history without
losing the reading position. Scroll down the conversation list to fetch the next
batch. There is no configured total-message or conversation limit in this flow;
it loads the records available in this CRM, not additional history from Meta.
Equal timestamps use a stable ID tie-breaker. Incoming messages are merged by ID,
and polling catches up in ascending batches without replacing older loaded rows.
A new-message button appears when the reader is away from the bottom.

Number and agent selectors synchronize; number choices include labels and put
removed numbers in a separate saved-chat group. The desktop opens the first
matching conversation; mobile retains its list/back flow. The last eight opened
chats are held only in workspace memory for immediate revisits. Lead audit is
fetched on expansion, initial thread/message reads run in parallel, and rich
message ledger lookups are batched. Green outgoing bubbles, white incoming
bubbles with blue labels, date separators and number-specific avatar colors
make directions and conversations easier to distinguish.

### Workspace reply switch

Settings → Allow management replies lets owners/admins enable or disable CRM
replies across the workspace. Existing workspaces default to enabled. Disabling
removes the complete reply panel, access label and customer-window notice.
The server checks the saved setting before reserving or submitting any new
management reply; settings read failures block sending. Already submitted
messages cannot be recalled. Receiving messages, phone-app replies, saved
conversations and media are unaffected.

The setting is stored as one deterministic company-owned `management_settings`
record in the private `monitoring_events` ledger. It has `needs_review=false`
and is anchored to the oldest existing channel to satisfy the ledger's foreign
key. Soft removal preserves this anchor. A workspace must have a business number
before saving the setting. This uses the recovered schema without a migration.
Only the authenticated company can read/change its setting through the
owner/admin endpoint. Open workspaces refresh the setting on focus and at the
existing 30-second refresh interval; the sending endpoint always checks storage.

### Management inbox tools (uncommitted feature work)

Each conversation has Open/Resolved/Snoozed controls and Mark read/Mark unread.
Snooze presets are one hour, four hours, one day and one week. Resolution and
snoozing record the message count observed by the manager. Any subsequent stored
message, including a phone-app reply or historical import, makes the effective
status Open; snoozes also expire at their scheduled time. Status is derived when
metadata is read, with no background scheduler required. Status badges are
visible in the conversation list. Global status/unread queue filters are not
implemented in this change.

Read state is shared by management within the company. It includes both inbound
and outbound messages because managers review agents' phone activity. Existing
messages start unread until explicitly marked read. Opening a conversation does
not mark every loaded or historical message read automatically. Mark read records
only the message count observed in the open conversation, so a newer arrival
cannot be silently acknowledged by a stale screen. Mark unread adds a manual
flag. Neither operation sends WhatsApp read receipts or changes another provider.

Internal notes are immutable management-only records, separate from WhatsApp
messages and reports. Notes remain available with management replies disabled.
The browser reuses its request ID when retrying a failed note submission, and
the API prevents duplicate inserts or reusing an ID for different content. Notes
load only when expanded and use timestamp/ID cursors in batches of 30.

Saved replies has a searchable library with create, edit and confirmed removal.
Supported variables are `{{name}}`, `{{phone}}` and `{{agent}}`; insertion expands
them as plain text and appends to the draft. It never sends automatically or
bypasses the management reply switch or WhatsApp reply window. These shortcuts
are not approved Meta templates. The picker/library shows up to 100 title matches
and explicitly asks the user to refine search when there are more. Version
checks reject conflicting edits or removals instead of overwriting another
manager's update.

These additions use namespaced, company-scoped records in the existing private
event ledger: `management_thread_status`, `management_thread_read`,
`management_note` and `management_quick_reply`. Status and read markers have
separate deterministic IDs, preventing one control from overwriting the other.
Notes and quick-reply creation use idempotent request IDs. No schema migration
or webhook/provider change is required. Service-ledger access follows owner/admin
authentication and explicit company/thread ownership checks. Secondary metadata
requests are batched by 100 conversation IDs and do not block message loading.

### Media access recovery

The media endpoint now distinguishes rejected Meta tokens, missing permissions,
unavailable attachments, unsupported types, the 32 MB size limit, rate limits and
network/timeouts. It returns safe error codes without Meta's raw error messages.
The native image/audio/video error handler runs an authenticated diagnostic and
shows the relevant recovery action. A successful server download that the browser
cannot decode offers an attachment download. All successful and failed media
responses remain private and uncached; role/company checks and trusted media-host
restrictions still apply.

Settings → Meta access accepts a fresh token and an explicit selection of existing
business numbers. The server first confirms company ownership of every selected
channel, then verifies each phone number against its stored WhatsApp Business
Account through read-only Meta calls. It updates encrypted credentials in one
database statement only after all numbers verify. A rejected token or partial
account access does not change any stored credentials. Channel activation,
messages, webhook subscriptions and other providers are not modified.

Token renewal requires a newly generated token from the company's own waCRM Meta
app. Use a system-user token with assigned WhatsApp assets where available, with
`whatsapp_business_management` and `whatsapp_business_messaging` permissions.
`business_management` is additionally needed for portfolio discovery. Tokens can
still be revoked when users, apps or asset access change. Neither this UI nor the
server can generate a replacement Meta login session automatically. Verification
establishes access to the selected numbers; it cannot restore a media file Meta
no longer retains. Persistent media archival remains separate work.
