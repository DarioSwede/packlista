-- Admin user directory, activity status and fixed profile avatars.

alter table public.users
  add column if not exists avatar_key text not null default 'backpack'
    check (avatar_key in ('backpack', 'tent', 'boots', 'compass', 'mountain', 'canoe', 'campfire', 'forest')),
  add column if not exists last_seen_at timestamptz;

grant update (avatar_key, last_seen_at, updated_at) on public.users to authenticated;

create or replace function public.touch_packlista_presence()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Inloggning kravs' using errcode = '42501';
  end if;
  update public.users
  set last_seen_at = now(), updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.touch_packlista_presence() from public;
grant execute on function public.touch_packlista_presence() to authenticated;

create or replace function public.admin_list_packlista_users()
returns table (
  id uuid,
  email text,
  display_name text,
  role text,
  avatar_key text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  last_seen_at timestamptz,
  is_online boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.users
    where public.users.id = auth.uid() and public.users.role = 'admin'
  ) then
    raise exception 'Administratorsbehorighet kravs' using errcode = '42501';
  end if;

  return query
  select
    profile.id,
    coalesce(account.email, '')::text,
    coalesce(profile.display_name, '')::text,
    profile.role,
    profile.avatar_key,
    account.created_at,
    account.last_sign_in_at,
    profile.last_seen_at,
    profile.last_seen_at > now() - interval '2 minutes'
  from public.users as profile
  join auth.users as account on account.id = profile.id
  order by profile.created_at desc;
end;
$$;

revoke all on function public.admin_list_packlista_users() from public;
grant execute on function public.admin_list_packlista_users() to authenticated;

notify pgrst, 'reload schema';
