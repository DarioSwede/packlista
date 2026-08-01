-- Keep the existing frontend's admin role compatible while recording a
-- permanent owner separately. The owner flag is never client-writable.

alter table public.users
  add column if not exists is_owner boolean not null default false;

update public.users
set is_owner = true, role = 'admin', updated_at = now()
where role = 'owner';

create unique index if not exists users_single_owner_idx
  on public.users (is_owner)
  where is_owner;

create or replace function public.admin_list_packlista_users()
returns table (
  id uuid, email text, display_name text, role text, avatar_key text,
  created_at timestamptz, last_sign_in_at timestamptz,
  last_seen_at timestamptz, is_online boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.users
    where public.users.id = (select auth.uid())
      and (public.users.role = 'admin' or public.users.is_owner)
  ) then
    raise exception 'Administratorsbehörighet krävs' using errcode = '42501';
  end if;
  return query
  select profile.id, coalesce(account.email, '')::text,
    coalesce(profile.display_name, '')::text,
    case when profile.is_owner then 'owner' else profile.role end::text,
    profile.avatar_key, account.created_at, account.last_sign_in_at,
    profile.last_seen_at, profile.last_seen_at > now() - interval '2 minutes'
  from public.users profile
  join auth.users account on account.id = profile.id
  order by profile.created_at desc;
end;
$$;

revoke all on function public.admin_list_packlista_users() from public, anon;
grant execute on function public.admin_list_packlista_users() to authenticated;

notify pgrst, 'reload schema';
