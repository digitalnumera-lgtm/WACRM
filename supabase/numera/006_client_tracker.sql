-- Numera: Client Tracker panel (a separate panel next to the WhatsApp CRM).
--
-- Safe to run more than once. Nothing here touches WhatsApp data.
-- All tables are server-only (RLS on, no policies, no grants to browser
-- roles): people reach tracker data only through /api/tracker routes, which
-- check the company owner or the person's tracker access level.

-- 1. Who may open the tracker, and how much they see.
--    view    = deals, clients and statuses (no amounts)
--    amounts = also totals, paid, owed and payments
--    full    = also commission (and editing, when it is added)
--    The company owner always has full access and needs no row.
create table if not exists public.tracker_access (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  level      text not null check (level in ('view', 'amounts', 'full')),
  granted_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

-- 2. The private link to the Google Apps Script web app, and its key
--    (encrypted with the server's ENCRYPTION_KEY).
create table if not exists public.tracker_connection (
  account_id    uuid primary key references public.accounts(id) on delete cascade,
  webapp_url    text check (webapp_url is null or webapp_url like 'https://script.google.com/macros/s/%/exec'),
  encrypted_key text,
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

-- 3. The latest copy of the Sheet (refreshed when someone opens the tracker).
create table if not exists public.tracker_snapshot (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  data       jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.tracker_access enable row level security;
alter table public.tracker_connection enable row level security;
alter table public.tracker_snapshot enable row level security;
revoke all on public.tracker_access, public.tracker_connection, public.tracker_snapshot from anon, authenticated;
grant all on public.tracker_access, public.tracker_connection, public.tracker_snapshot to service_role;
