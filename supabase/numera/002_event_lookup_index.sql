-- Numera waCRM: faster lookups of private notes, saved replies, settings and
-- history-sync progress in the event ledger. Additive and safe to re-run.
-- (Applied to production on 22 October 2026.)
create index if not exists monitoring_events_account_field_idx
  on public.monitoring_events (account_id, field, received_at desc);
