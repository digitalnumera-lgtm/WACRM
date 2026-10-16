# Numera recovery and deployment

The recovery implementation is on `digitalnumera-lgtm/WACRM`, branch
`recovery/wacrm`. It rebuilds the monitoring changes on upstream
`ArnasDon/wacrm` commit `27c6bdf43633d1746410168431a8b0e22b4f2ba6`.
It is not the original unpushed custom source. Original prepared commit
`7025eaa099998d3b031360dd48ab38c7b9f90bce` was not available from GitHub.

## Preserve the original

Do not delete, reset or replace the inaccessible original environment. Its
`/workspace/deployment-artifacts/numera-wacrm-source.zip`, `numera-wacrm.bundle`
and `SHA256SUMS` were not present in this recovery workspace. If they become
accessible, verify their checksums and compare in a separate directory. Preserve
the bundle and full custom history. Recovery archives under
`/workspace/recovery-artifacts` contain this rebuild, not those original files.

## Existing database

Use project `stvjblztwpohvatdalww` at
`https://stvjblztwpohvatdalww.supabase.co`. No schema changes, resets or migration
replays were performed during recovery. The original environment reported 47
applied migrations with checksums in `numera_migrations.applied`; upstream has
46 migration files. Do not blindly run those migrations against this project.

REST schema inspection and isolated live fixture tests confirmed the existing
monitoring tables and RPC contracts. Management API catalog/checksum inspection
remains blocked: the current setup token lacks `database_read`. Once that
permission is available, run:

```sh
NODE_USE_ENV_PROXY=1 node scripts/inspect-numera-schema.mjs
```

This read-only script writes schema and ledger evidence outside the checkout.
Compare the ledger before considering any schema change. Lack of ledger access
does not require a database reset or block the existing application RPCs.

The application reuses `monitoring_channels`, `monitoring_credentials`,
`monitoring_threads`, `monitoring_messages`, `monitoring_events` and
`monitoring_lead_audit`. Existing `create_monitoring_channel` and
`ingest_monitoring_event` RPCs are service-only. `set_monitoring_lead_status`
uses the authenticated manager session to record its actor. Ingest message
arguments are `id`, `customer`, `name`, `direction`, `timestamp`, `kind`, `text`
and `media_id`; these differ from table column names. Credentials and retained
events are service-only; event APIs verify owner/admin and scope by company.

## Implemented behavior

- `/monitoring` is the owner/admin management inbox. Company-scoped access is
  enforced by the server and the existing database policies.
- Each thread identifies its business number and agent label. The existing
  channel `label` supplies the assigned-agent display label; no new agent-user
  assignment schema was introduced. The same customer on two numbers has two
  separate threads.
- Search covers customer number, customer name and latest message preview.
  Number, agent-label and lead-status filters, thread/message/audit pagination,
  lead updates and audit history are available. Visible pages refresh every
  30 seconds.
- `/api/monitoring/webhook` verifies raw-body Meta HMAC signatures, stores
  incoming messages and `smb_message_echoes` phone-app replies through the
  existing atomic RPC, and deduplicates retries. Storage failures return 503
  for retry. Invalid signatures are rejected before persistence.
- Channel creation verifies Meta number/WABA membership through read-only GET
  requests and encrypts credentials with the existing encryption key. It does
  not register numbers, subscribe apps or alter WabaCRM authorization.
- Unsupported/history events are retained for manager review. Media references
  and captions are retained; media playback and durable archiving are not
  implemented. Embedded Signup and historical-chat import are not implemented.

Monitoring-only is the default. Keep `NUMERA_MONITORING_ONLY=true` in production.
Sending, operational inbox, broadcasts, automations, flows, AI APIs, legacy
webhook and public operational APIs are blocked. Mutating Meta requests are
also blocked at the transport boundary. `false` is only a deliberate legacy
mode override, used by upstream regression tests; never deploy that override.

## Secure configuration

Supply these through secure environment settings, never committed `.env` files:

- `NEXT_PUBLIC_SUPABASE_URL` = the existing project URL above
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = existing project anon key
- `SUPABASE_SERVICE_ROLE_KEY` = existing server-only service key
- `NEXT_PUBLIC_SITE_URL` = `https://crm.numeradigital.com`
- `ENCRYPTION_KEY` = the original 64-character hexadecimal key; never replace it
- `META_APP_SECRET` = the Numera Meta Developer app secret
- `META_MONITORING_VERIFY_TOKEN` = the original saved verification secret, or,
  if no original was configured, a user-chosen long random secret stored with
  a password manager and entered identically in Numera's Meta webhook settings
- `NUMERA_MONITORING_ONLY` = `true`

The verify token is not a Meta access token or app secret. It was still missing
from the recovery runtime at validation. GET webhook subscription verification
returns 503 until configured. POST signature/storage behavior was tested using
synthetic signed events without contacting Meta.

`SUPABASE_ACCESS_TOKEN` is setup-only. Platform Git authentication already
supports pushes; `WACRM_GITHUB_PUSH_TOKEN` is unnecessary here. Neither setup
token should be deployed to the CRM. Do not print or copy secret values into
logs, scripts, Git, deployment archives or chat.

## Build and start

Use the existing isolated checkout at `/workspace/WACRM`; do not create a
worktree unless explicitly requested. Node 24 was used in this cloud environment.
The lockfile is unchanged. Preserve TLS verification and configured proxy trust.

```sh
cd /workspace/WACRM
npm ci --cache /workspace/.npm
npm run typecheck
npm run lint
npm test -- --maxWorkers=4
NODE_USE_ENV_PROXY=1 npm run build
HOSTNAME=127.0.0.1 PORT=3000 NODE_USE_ENV_PROXY=1 npm start
```

`NODE_USE_ENV_PROXY=1` is needed for Node 24 requests through this cloud proxy.
The build's postbuild step copies static assets and public files into
`.next/standalone`. `npm start` runs that server. Restart it in each new task;
processes do not survive environment publication. For an external Node hosting
service, use its supplied `PORT` and `HOSTNAME=0.0.0.0`; set public environment
values before building. Do not expose a development server to production.

Required outbound hosts include the Supabase project, `api.supabase.com` for
optional inspection, `graph.facebook.com`, and `fonts.googleapis.com` /
`fonts.gstatic.com` during builds. Package-manager access is also needed.

## Validation and production activation

Validated on 2026-10-15: production build and standalone startup, TypeScript,
1,180 tests across 102 files, and lint with zero errors (40 upstream warnings).
Live isolated database tests passed company/agent isolation, per-number threads,
message names/media metadata, duplicate retries, phone-app echoes, all five lead
statuses with audit actors, unsupported-event retention and transaction rollback.
Signed HTTP webhook delivery and retry deduplication passed against the existing
database. Authenticated desktop/mobile browser checks passed rendering, lead
updates, number filtering and retained-event access. All temporary synthetic
accounts and their data were removed. Fixture echo tests do not establish
production Meta Coexistence delivery.

Production activation still requires hosting this source with the secure
configuration, setting the Numera webhook callback to
`https://crm.numeradigital.com/api/monitoring/webhook`, and verifying authorized
production Coexistence delivery for each intended number. Keep the existing
`wabacrm.com` integration, phone apps, number registrations and app subscriptions
unchanged. Its authorization cannot be transferred to Numera. Do not reconnect
the deliberately disconnected number. No production Meta change was performed.

There are five agent numbers across Pakistan and UAE. Domain ownership and
Hostinger hosting are in separate accounts. The reported Supabase Auth Site URL
is `https://crm.numeradigital.com` with `https://crm.numeradigital.com/**` allowed.
Keep both existing WordPress sites unchanged. No production deployment or domain
change was performed during this recovery.

## Webhook delivery diagnostics

Hostinger runtime logs now emit `[monitoring-webhook]` JSON records for each
POST: a `received` marker and a terminal outcome, correlated by a server-generated
request ID (also returned in `X-Monitoring-Request-Id`). Only fixed labels and
counts are logged, never payloads, request headers, Meta IDs, credentials,
customer text or database exception details.

`signature_rejected` means HMAC validation failed. `payload_rejected` means the
signed envelope could not be parsed. `delivery_failed` returns 503; its outcome
counts distinguish `channel_lookup_failed`, `channel_not_found`,
`ambiguous_routing` and `transaction_failed`. `channel_paused` means an existing
paused channel was intentionally skipped. `transaction_completed` includes
idempotent retries; it does not imply a newly inserted message. `acknowledged`
with zero batches or only paused channels does not establish message storage.
An unexpected persistence exception remains a generic `delivery_failed`.

Meta dashboard samples can use dummy WABA/phone IDs that do not match configured
channels. Do not add these dummy IDs to a customer account or bypass routing to
make a dashboard test pass. After deploying this version, repeat the test and
inspect the new runtime log entries to determine its actual outcome. A Meta UI
success notice alone does not prove storage in this database.

## Public privacy and deletion instructions

`/privacy` and `/data-deletion` are public pages for Numera Digital's internal,
management-only monitoring workspace. Both publish the owner-approved contact
address digitalnumera@gmail.com. Deletion requests are handled manually by that
inbox; no automated data-deletion callback or automatic retention schedule is
implemented. Review the policy against actual operations before submitting it
to Meta, and keep it current as integrations or retention practices change.

After deployment, verify both URLs open without login. In Meta app settings,
use `/privacy` for the privacy-policy URL and `/data-deletion` as the data-deletion
instructions URL (not a callback URL), prefixed with the deployed HTTPS origin.
These pages do not themselves grant Meta App Review approval, publish the Meta
app, or authorize production Coexistence.
