-- Security hardening from the Supabase security advisor (22 Oct 2026).
-- Safe to run more than once. Changes no data.

begin;

-- 1. Account-management functions check auth.uid() themselves, but signed-out
--    visitors have no reason to call them at all.
do $$
declare f text;
begin
  foreach f in array array[
    'public.remove_account_member(uuid)',
    'public.set_member_role(uuid, public.account_role_enum)',
    'public.transfer_account_ownership(uuid)',
    'public.touch_presence(text)',
    'public.redeem_invitation(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- 2. Pin search_path on helper functions so they cannot be redirected to
--    look-alike objects in another schema.
alter function public.update_updated_at_column() set search_path = public, pg_temp;
alter function public._bcast_cols_for_status(text) set search_path = public, pg_temp;
alter function public.update_ai_configs_updated_at() set search_path = public, pg_temp;
alter function public.update_ai_knowledge_documents_updated_at() set search_path = public, pg_temp;

commit;
