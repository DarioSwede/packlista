-- Create the public.users profile row when the account is created, not on
-- the user's first planner load.
--
-- The profile was previously written client-side by loadAccount() in
-- app.js, which only runs after a successful sign-in. Anyone invited from
-- the admin panel who had not yet signed in therefore had no profile row,
-- and list_packlista_directory() (which reads public.users) could not see
-- them -- so they never showed up in the "Dela packlistan" picker even
-- though the admin list, which reads auth.users through the
-- packlista-admin edge function, listed them as approved accounts.

create or replace function public.handle_new_packlista_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, display_name, updated_at)
  values (
    new.id,
    coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Användare'),
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- on conflict do nothing above keeps the client-side insert in
-- loadAccount() harmless as a fallback, and makes sure a profile row that
-- somehow already exists never turns a signup into an error.
drop trigger if exists on_auth_user_created_packlista on auth.users;
create trigger on_auth_user_created_packlista
  after insert on auth.users
  for each row execute function public.handle_new_packlista_user();

-- Backfill every account that predates the trigger. Display name follows
-- the same rule loadAccount() used (the part of the address before @), so
-- existing profiles and backfilled ones look the same in the picker.
insert into public.users (id, display_name, updated_at)
select account.id,
  coalesce(nullif(split_part(coalesce(account.email, ''), '@', 1), ''), 'Användare'),
  now()
from auth.users account
where not exists (
  select 1 from public.users profile where profile.id = account.id
);

notify pgrst, 'reload schema';
