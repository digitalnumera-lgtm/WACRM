-- Numera waCRM: team access with custom roles, and media storage housekeeping.
--
-- Safe to run more than once. Nothing here changes messages, numbers or
-- credentials. All new tables are server-only (RLS on, no policies, no grants
-- to browser roles): team members reach CRM data only through the
-- /api/monitoring routes, which check their role and assigned numbers.

-- 1. Custom roles: a name plus the CRM actions the role may perform.
create table if not exists public.monitoring_roles (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (description is null or char_length(description) <= 200),
  permissions text[] not null default '{}' check (permissions <@ array[
    'view_inbox', 'view_media', 'view_contacts', 'edit_contacts', 'manage_conversations',
    'edit_lead_stage', 'apply_labels', 'write_notes', 'view_reports', 'export_data',
    'manage_labels', 'manage_numbers', 'manage_settings'
  ]::text[]),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists monitoring_roles_account_name_idx on public.monitoring_roles (account_id, lower(name));

-- 2. A team member's role and the business numbers they may see.
--    channel_ids null = every number. Owners and admins never need a row.
create table if not exists public.monitoring_member_access (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role_id     uuid not null references public.monitoring_roles(id) on delete restrict,
  channel_ids uuid[],
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (account_id, user_id)
);
create index if not exists monitoring_member_access_role_idx on public.monitoring_member_access (role_id);

-- 3. Email-bound invitations. The link token stays in account_invitations;
--    this row binds it to one email address and the access to grant.
--    role_id null = invite as an admin (full access).
create table if not exists public.monitoring_invites (
  invitation_id uuid primary key references public.account_invitations(id) on delete cascade,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  email         text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role_id       uuid references public.monitoring_roles(id) on delete cascade,
  channel_ids   uuid[],
  created_at    timestamptz not null default now()
);
create index if not exists monitoring_invites_account_idx on public.monitoring_invites (account_id);

-- 4. Storage settings per company.
create table if not exists public.monitoring_storage_settings (
  account_id      uuid primary key references public.accounts(id) on delete cascade,
  cap_mb          integer not null default 800 check (cap_mb between 50 and 100000),
  idle_days       integer check (idle_days is null or idle_days between 1 and 365),
  auto_save       text[] not null default array['image', 'audio', 'sticker']
                  check (auto_save <@ array['image', 'audio', 'sticker', 'video', 'document']::text[]),
  last_cleanup_at timestamptz,
  last_cleanup    jsonb,
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now()
);

-- 5. When a conversation was last opened in the CRM (keeps its media stored).
alter table public.monitoring_thread_meta add column if not exists opened_at timestamptz;

alter table public.monitoring_roles enable row level security;
alter table public.monitoring_member_access enable row level security;
alter table public.monitoring_invites enable row level security;
alter table public.monitoring_storage_settings enable row level security;
revoke all on public.monitoring_roles, public.monitoring_member_access, public.monitoring_invites, public.monitoring_storage_settings from anon, authenticated;

-- 6. Redeeming an email-bound invitation: the signed-in email must match, and
--    the chosen role and numbers are granted in the same transaction. This runs
--    inside redeem_invitation, so a mismatch rolls the whole redemption back.
create or replace function public.monitoring_invite_redeemed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.monitoring_invites%rowtype;
  v_email  text;
begin
  if old.accepted_at is not null or new.accepted_at is null then
    return new;
  end if;
  select * into v_invite from public.monitoring_invites where invitation_id = new.id;
  if not found then
    return new;
  end if;
  select lower(email) into v_email from auth.users where id = new.accepted_by_user_id;
  if v_email is distinct from v_invite.email then
    raise exception 'This invitation was sent to a different email address. Sign out, then sign in or sign up with the invited email.'
      using errcode = '23505';
  end if;
  if v_invite.role_id is not null then
    insert into public.monitoring_member_access (account_id, user_id, role_id, channel_ids, updated_by)
    values (v_invite.account_id, new.accepted_by_user_id, v_invite.role_id, v_invite.channel_ids, new.created_by_user_id)
    on conflict (account_id, user_id) do update
      set role_id = excluded.role_id, channel_ids = excluded.channel_ids,
          updated_by = excluded.updated_by, updated_at = now();
  end if;
  return new;
end;
$$;
revoke all on function public.monitoring_invite_redeemed() from public, anon, authenticated;

drop trigger if exists monitoring_invite_redeemed on public.account_invitations;
create trigger monitoring_invite_redeemed
  before update of accepted_at on public.account_invitations
  for each row execute function public.monitoring_invite_redeemed();

-- 7. Lead stage changes by team members (server-side, after the API has
--    checked their role and numbers). Same audit trail as the admin function.
create or replace function public.monitoring_set_lead_status_as(p_account uuid, p_thread uuid, p_status text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare t public.monitoring_threads;
begin
  select * into strict t from public.monitoring_threads where id = p_thread and account_id = p_account for update;
  if p_status not in ('new', 'contacted', 'qualified', 'won', 'lost') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  if t.lead_status = p_status then return; end if;
  update public.monitoring_threads set lead_status = p_status where id = t.id;
  insert into public.monitoring_lead_audit (account_id, thread_id, changed_by, previous_status, new_status)
  values (t.account_id, t.id, p_actor, t.lead_status, p_status);
end;
$$;
revoke all on function public.monitoring_set_lead_status_as(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.monitoring_set_lead_status_as(uuid, uuid, text, uuid) to service_role;

-- 8. Record that a conversation was opened (at most one write per hour).
create or replace function public.monitoring_touch_thread(p_account uuid, p_thread uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  -- A new row keeps the defaults (unread, open): opening is not "reading".
  insert into public.monitoring_thread_meta (thread_id, account_id, opened_at)
  select t.id, t.account_id, now()
  from public.monitoring_threads t
  where t.id = p_thread and t.account_id = p_account
  on conflict (thread_id) do update set opened_at = now()
  where monitoring_thread_meta.opened_at is null or monitoring_thread_meta.opened_at < now() - interval '1 hour';
$$;
revoke all on function public.monitoring_touch_thread(uuid, uuid) from public, anon, authenticated;
grant execute on function public.monitoring_touch_thread(uuid, uuid) to service_role;

-- 9. Storage used by this company's saved media.
create or replace function public.monitoring_media_usage(p_account uuid)
returns table (objects bigint, bytes bigint)
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select count(*)::bigint, coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'monitoring-media' and o.name like p_account::text || '/%';
$$;
revoke all on function public.monitoring_media_usage(uuid) from public, anon, authenticated;
grant execute on function public.monitoring_media_usage(uuid) to service_role;

-- 10. Which saved files to remove. A file's "last used" time is the later of
--     when it was saved and when its conversation was last opened.
--     'idle': last used more than p_idle_days ago (only when that rule is on).
--     'cap':  storage is over p_cap_bytes, so the least recently used files go
--             first until usage is back under 90% of the cap.
--     Files are deleted by the app through the Storage API, never by SQL.
create or replace function public.monitoring_media_cleanup_candidates(p_account uuid, p_idle_days integer, p_cap_bytes bigint, p_limit integer default 500)
returns table (name text, bytes bigint, reason text)
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  with objs as (
    select o.name,
           coalesce((o.metadata ->> 'size')::bigint, 0) as bytes,
           greatest(o.created_at, coalesce(o.updated_at, o.created_at), coalesce(meta.opened_at, o.created_at)) as last_used
    from storage.objects o
    left join public.monitoring_messages msg
      on msg.account_id = p_account
     and msg.id = case when split_part(o.name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then split_part(o.name, '/', 2)::uuid end
    left join public.monitoring_thread_meta meta on meta.thread_id = msg.thread_id
    where o.bucket_id = 'monitoring-media' and o.name like p_account::text || '/%'
  ),
  idle as (
    select objs.name, objs.bytes, 'idle'::text as reason
    from objs
    where p_idle_days is not null and objs.last_used < now() - make_interval(days => p_idle_days)
  ),
  kept as (
    select objs.name, objs.bytes,
           sum(objs.bytes) over (order by objs.last_used desc, objs.name rows unbounded preceding) as running
    from objs
    where not exists (select 1 from idle where idle.name = objs.name)
  ),
  over_cap as (
    select kept.name, kept.bytes, 'cap'::text as reason
    from kept
    where (select coalesce(sum(k.bytes), 0) from kept k) > p_cap_bytes
      and kept.running > (p_cap_bytes * 9) / 10
  )
  select * from idle
  union all
  select * from over_cap
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;
revoke all on function public.monitoring_media_cleanup_candidates(uuid, integer, bigint, integer) from public, anon, authenticated;
grant execute on function public.monitoring_media_cleanup_candidates(uuid, integer, bigint, integer) to service_role;

-- 11. Claim the right to run cleanup (one run per company per interval).
create or replace function public.monitoring_claim_cleanup(p_account uuid, p_min_minutes integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_claimed boolean;
begin
  insert into public.monitoring_storage_settings (account_id) values (p_account) on conflict (account_id) do nothing;
  update public.monitoring_storage_settings
     set last_cleanup_at = now()
   where account_id = p_account
     and (last_cleanup_at is null or last_cleanup_at < now() - make_interval(mins => greatest(p_min_minutes, 0)))
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;
revoke all on function public.monitoring_claim_cleanup(uuid, integer) from public, anon, authenticated;
grant execute on function public.monitoring_claim_cleanup(uuid, integer) to service_role;

-- 12. Starter roles for each company (edit or delete them in Settings → Team).
insert into public.monitoring_roles (account_id, name, description, permissions)
select a.id, 'Supervisor', 'Reviews chats, adds notes and labels, sees reports',
       array['view_inbox', 'view_media', 'view_contacts', 'manage_conversations', 'edit_lead_stage', 'apply_labels', 'write_notes', 'view_reports']
from public.accounts a
where exists (select 1 from public.monitoring_channels c where c.account_id = a.id)
on conflict do nothing;
insert into public.monitoring_roles (account_id, name, description, permissions)
select a.id, 'Auditor', 'Read-only: chats, media and contacts',
       array['view_inbox', 'view_media', 'view_contacts']
from public.accounts a
where exists (select 1 from public.monitoring_channels c where c.account_id = a.id)
on conflict do nothing;

-- 13. Address-book contacts are shared across every number, so only owners
--     and admins read them directly. Team members see contacts through the
--     CRM API, limited to their assigned numbers.
drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select using (public.is_account_member(account_id, 'admin'::public.account_role_enum));
