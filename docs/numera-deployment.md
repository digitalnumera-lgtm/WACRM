# Numera recovery checkpoint

This is a partial recovery, not the original unpushed customization. Original
upstream: `ArnasDon/wacrm` at `27c6bdf43633d1746410168431a8b0e22b4f2ba6`.
Original prepared commit: `7025eaa099998d3b031360dd48ab38c7b9f90bce` on
`codex/numera-monitoring`; it was not fetchable from GitHub during recovery.

## Preservation

Do not delete, reset or replace the inaccessible original environment. Its
`/workspace/deployment-artifacts/numera-wacrm-source.zip`, `numera-wacrm.bundle`
and `SHA256SUMS` must remain recoverable. None was present in this recovery
workspace. When accessible, verify checksums and extract into a separate
directory before comparing; preserve the bundle and full custom history.

Never reset the existing Supabase database or blindly replay migrations.
Project: `stvjblztwpohvatdalww`, URL:
`https://stvjblztwpohvatdalww.supabase.co`. The prior environment reportedly
applied 47 migrations and recorded their checksums in
`numera_migrations.applied`. Upstream contains only 46 migrations: the missing
monitoring schema must be recovered from the existing project or backup.

Restore the original secure runtime bindings through environment settings:
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`,
`META_APP_SECRET`, `META_MONITORING_VERIFY_TOKEN`. Keep the encryption key stable.
For schema inspection only, restore `SUPABASE_ACCESS_TOKEN`; do not deploy it.
Git push works with platform authentication; no temporary push token is needed.

Run `node scripts/inspect-numera-schema.mjs` after restoring management access.
It uses a read-only transaction, reads monitoring table definitions, policies,
functions and the checksum ledger, and writes outside the checkout. Compare
the ledger with upstream SHA256 checksums before any migration consideration.
It does not read monitoring credentials, message contents or auth-user records.

## Current behavior and outstanding work

Monitoring-only is the default (`NUMERA_MONITORING_ONLY` unset or `true`).
Operational inbox, sending, broadcasts, automations, flows, AI APIs, public
operational APIs and the legacy webhook are blocked at middleware. Mutating
Meta requests are also blocked at the transport boundary, including number
registration and app subscription. `false` is an explicit legacy-mode override,
used only to exercise upstream regression tests; do not use it in production.

Event normalization covers incoming messages, `smb_message_echoes` phone-app
replies, status observations, per-number/customer thread identity and stable
deduplication keys. Unsupported/history changes are retained by the normalizer.
These tests validate fixtures, not live Meta Coexistence delivery.

Remaining: inspect/recover the monitoring schema, implement compatible
transactional persistence and company-scoped owner/admin access, signed
`/api/monitoring/webhook`, encrypted channel configuration, management inbox,
search, number/agent filters, pagination, lead statuses and audit trail. There is
no deployed monitoring endpoint or complete monitoring UI at this checkpoint.
Embedded Signup, historical import and durable media archiving are unimplemented.

## Existing production services

Keep `wabacrm.com` and all existing Meta authorizations, phone apps, registration
and subscriptions unchanged. Five agent numbers span Pakistan and UAE; previous
reported connection states were two connected and one intentionally disconnected.
Do not reconnect the deliberately disconnected number. WabaCRM authorization
cannot be transferred to this app. Production Coexistence and delivery are
unverified and must be tested without disrupting the current service.

Final domain: `https://crm.numeradigital.com`; Supabase's reported Auth Site URL
matches it, with `https://crm.numeradigital.com/**` allowed. Domain and hosting
are in different accounts. Do not change either existing WordPress site or
publish this partial checkpoint to production.

## Development

Use the existing isolated checkout; do not create a worktree unless requested.
From `/workspace/WACRM`, run `npm ci --cache /workspace/.npm`, `npm run typecheck`,
`npm run lint` and `npm test -- --maxWorkers=4`. Use `npm run dev -- --hostname
127.0.0.1` only with the original runtime configuration. Live integration
readiness cannot be claimed from placeholder credentials or a compiled build.
