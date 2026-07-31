-- Kontoinställningar (byt namn / byt lösenord / ta bort konto), 2026-07-31.

-- Byt namn: 0022 revoked ALL update privileges on public.users (to stop
-- self-serve role escalation via the `role` column), which also silently
-- broke the ability to ever update display_name. Re-grant it, but only
-- for the two columns a user should ever touch on their own row -- `id`
-- and `role` stay untouchable via the client. The row-level restriction
-- (only your own row) already exists as the `users_update_own` policy
-- from 0020 and doesn't need to change.
grant update (display_name, updated_at) on public.users to authenticated;

-- Ta bort konto: there's no client-safe way to delete your own
-- auth.users row directly (that table isn't exposed to PostgREST at
-- all), so this is the standard Supabase pattern -- a security-definer
-- function that only ever deletes auth.uid()'s own row. It runs with the
-- privileges of whoever owns the function (the migration-running role,
-- effectively "postgres" in the Supabase SQL editor), not the calling
-- user's, which is what lets it reach into auth.users at all. Deleting
-- from auth.users cascades through public.users -> packing_lists ->
-- packing_items/templates automatically (see the "on delete cascade"
-- foreign keys in 0020), so this one call cleans up everything.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

notify pgrst, 'reload schema';
