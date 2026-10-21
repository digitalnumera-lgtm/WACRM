-- ============================================================================
-- Numera waCRM — inbox workflow, labels, contact profiles and media storage
-- ----------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL Editor for project stvjblztwpohvatdalww, before
-- deploying the Chatwoot-style inbox.
--
-- Safe by design:
--   * Only ADDS new tables, indexes, one view and one private storage bucket. It does not alter, rename or
--     delete any existing table, column, row, policy or function.
--   * Re-running it is harmless (IF NOT EXISTS / OR REPLACE / ON CONFLICT).
--   * Row Level Security is enabled on every new table with no policies, so
--     browsers cannot read or write them directly. Only the CRM server (service
--     role) can, after it has checked the signed-in owner/admin's company.
--   * Existing conversations are marked as already read, so the Unread tab
--     starts empty instead of flagging every historical message.
--
-- This file lives outside supabase/migrations on purpose: the production
-- monitoring schema was recovered/customised and is not reproduced by the
-- upstream migration chain. Do not reset the database to apply it.
-- ============================================================================

begin;

-- 1. Per-conversation workflow: status, snooze, review/read marker, priority.
create table if not exists public.monitoring_thread_meta (
  thread_id       uuid primary key references public.monitoring_threads(id) on delete cascade,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  status          text not null default 'open' check (status in ('open', 'resolved', 'snoozed')),
  -- message_count observed when resolved/snoozed; any newer message reopens it
  status_at_count integer not null default 0 check (status_at_count >= 0),
  snoozed_until   timestamptz,
  -- message_count the management team has reviewed ("read" in this CRM only)
  seen_count      integer not null default 0 check (seen_count >= 0),
  marked_unread   boolean not null default false,
  priority        text not null default 'none' check (priority in ('none', 'low', 'medium', 'high', 'urgent')),
  updated_by      uuid,
  updated_at      timestamptz not null default now()
);
create index if not exists monitoring_thread_meta_account_idx on public.monitoring_thread_meta (account_id);

-- 2. Company labels (Chatwoot-style coloured tags).
create table if not exists public.monitoring_labels (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  color       text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  description text check (description is null or char_length(description) <= 200),
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create unique index if not exists monitoring_labels_account_name_idx on public.monitoring_labels (account_id, lower(name));

-- 3. Labels attached to conversations.
create table if not exists public.monitoring_thread_labels (
  thread_id  uuid not null references public.monitoring_threads(id) on delete cascade,
  label_id   uuid not null references public.monitoring_labels(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  added_by   uuid,
  created_at timestamptz not null default now(),
  primary key (thread_id, label_id)
);
create index if not exists monitoring_thread_labels_label_idx on public.monitoring_thread_labels (account_id, label_id);

-- 4. Contact details per customer phone (shared across every business number).
create table if not exists public.monitoring_contact_profiles (
  account_id uuid not null references public.accounts(id) on delete cascade,
  customer   text not null check (customer ~ '^[0-9]{6,20}$'),
  name       text check (name is null or char_length(name) <= 120),
  email      text check (email is null or char_length(email) <= 200),
  company    text check (company is null or char_length(company) <= 120),
  city       text check (city is null or char_length(city) <= 120),
  notes      text check (notes is null or char_length(notes) <= 2000),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (account_id, customer)
);

alter table public.monitoring_thread_meta      enable row level security;
alter table public.monitoring_labels           enable row level security;
alter table public.monitoring_thread_labels    enable row level security;
alter table public.monitoring_contact_profiles enable row level security;

-- 5. Inbox view: one row per conversation with its computed workflow state.
create or replace view public.monitoring_inbox with (security_invoker = true) as
select
  t.id, t.account_id, t.channel_id, t.customer, t.customer_name, t.lead_status,
  t.last_message_at, t.last_preview, t.last_direction, t.message_count,
  case
    when m.status = 'resolved' and t.message_count <= m.status_at_count then 'resolved'
    when m.status = 'snoozed' and t.message_count <= m.status_at_count and m.snoozed_until > now() then 'snoozed'
    else 'open'
  end as state,
  case
    when m.status = 'snoozed' and t.message_count <= m.status_at_count and m.snoozed_until > now() then m.snoozed_until
  end as snoozed_until,
  greatest(t.message_count - coalesce(m.seen_count, 0), 0) as unread_count,
  coalesce(m.marked_unread, false) as marked_unread,
  (greatest(t.message_count - coalesce(m.seen_count, 0), 0) > 0 or coalesce(m.marked_unread, false)) as is_unread,
  coalesce(m.priority, 'none') as priority,
  coalesce((select array_agg(l.label_id order by l.label_id)
              from public.monitoring_thread_labels l where l.thread_id = t.id), '{}'::uuid[]) as label_ids
from public.monitoring_threads t
left join public.monitoring_thread_meta m on m.thread_id = t.id;

revoke all on public.monitoring_inbox from anon, authenticated;
revoke all on public.monitoring_thread_meta, public.monitoring_labels,
  public.monitoring_thread_labels, public.monitoring_contact_profiles from anon, authenticated;
grant select on public.monitoring_inbox to service_role;
grant all on public.monitoring_thread_meta, public.monitoring_labels,
  public.monitoring_thread_labels, public.monitoring_contact_profiles to service_role;

-- 6. Start with every existing conversation reviewed (Unread tab begins empty).
insert into public.monitoring_thread_meta (thread_id, account_id, seen_count)
select id, account_id, message_count from public.monitoring_threads
on conflict (thread_id) do nothing;

-- 7. Private storage bucket for permanent copies of WhatsApp media (images,
--    voice notes, videos, documents). Not public: only the CRM server reads it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('monitoring-media', 'monitoring-media', false, 33554432)
on conflict (id) do nothing;

commit;

-- Ask PostgREST to pick up the new tables and view immediately.
notify pgrst, 'reload schema';
