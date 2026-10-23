-- One database trip instead of two when a signed-in page or API call looks up
-- the user's company and role (the database is far from the web server, so
-- every trip costs about a third of a second).
-- Returns only the caller's own row (auth.uid()); no other user's data.
create or replace function public.current_account_context()
returns table (account_id uuid, account_role text, account_name text)
language sql
stable
security invoker
set search_path = public
as $$
  select p.account_id, p.account_role::text, a.name
  from public.profiles p
  join public.accounts a on a.id = p.account_id
  where p.user_id = (select auth.uid())
  limit 1
$$;

revoke all on function public.current_account_context() from public, anon;
grant execute on function public.current_account_context() to authenticated;
