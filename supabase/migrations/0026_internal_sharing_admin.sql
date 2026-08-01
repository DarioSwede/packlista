-- Internal presence, permanent owner role and per-list sharing.

alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check check (role in ('user', 'admin', 'owner'));

-- The first existing administrator becomes the permanent site owner.
update public.users
set role = 'owner', updated_at = now()
where id = (
  select id from public.users where role = 'admin' order by created_at limit 1
);

create table if not exists public.packing_list_members (
  packing_list_id uuid not null references public.packing_lists(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  access_level text not null default 'viewer' check (access_level in ('viewer', 'editor')),
  invited_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (packing_list_id, user_id)
);

create index if not exists packing_list_members_user_id_idx
  on public.packing_list_members(user_id);
create index if not exists packing_list_members_invited_by_idx
  on public.packing_list_members(invited_by);

alter table public.packing_list_members enable row level security;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.can_access_packing_list(requested_list_id uuid, require_edit boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.packing_lists list
    where list.id = requested_list_id
      and (
        list.user_id = (select auth.uid())
        or exists (
          select 1
          from public.packing_list_members member
          where member.packing_list_id = list.id
            and member.user_id = (select auth.uid())
            and (not require_edit or member.access_level = 'editor')
        )
      )
  );
$$;

revoke all on function private.can_access_packing_list(uuid, boolean) from public, anon;
grant execute on function private.can_access_packing_list(uuid, boolean) to authenticated;

drop policy if exists packing_lists_select_own on public.packing_lists;
drop policy if exists packing_lists_insert_own on public.packing_lists;
drop policy if exists packing_lists_update_own on public.packing_lists;
drop policy if exists packing_lists_delete_own on public.packing_lists;
create policy packing_lists_select_available on public.packing_lists for select to authenticated
  using ((select private.can_access_packing_list(id, false)));
create policy packing_lists_insert_own on public.packing_lists for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy packing_lists_update_editable on public.packing_lists for update to authenticated
  using ((select private.can_access_packing_list(id, true)))
  with check ((select private.can_access_packing_list(id, true)));
create policy packing_lists_delete_own on public.packing_lists for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists packing_items_select_own on public.packing_items;
drop policy if exists packing_items_insert_own on public.packing_items;
drop policy if exists packing_items_update_own on public.packing_items;
drop policy if exists packing_items_delete_own on public.packing_items;
create policy packing_items_select_available on public.packing_items for select to authenticated
  using ((select private.can_access_packing_list(packing_list_id, false)));
create policy packing_items_insert_editable on public.packing_items for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (select private.can_access_packing_list(packing_list_id, true))
  );
create policy packing_items_update_editable on public.packing_items for update to authenticated
  using ((select private.can_access_packing_list(packing_list_id, true)))
  with check ((select private.can_access_packing_list(packing_list_id, true)));
create policy packing_items_delete_editable on public.packing_items for delete to authenticated
  using ((select private.can_access_packing_list(packing_list_id, true)));

drop policy if exists packing_list_members_select_available on public.packing_list_members;
create policy packing_list_members_select_available on public.packing_list_members for select to authenticated
  using ((select private.can_access_packing_list(packing_list_id, false)));

revoke all on public.packing_list_members from anon, authenticated;
grant select on public.packing_list_members to authenticated;

create or replace function public.list_packlista_presence()
returns table (id uuid, display_name text, avatar_key text, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id,
    coalesce(nullif(profile.display_name, ''), 'Användare')::text,
    profile.avatar_key,
    profile.last_seen_at
  from public.users profile
  where (select auth.uid()) is not null
    and profile.last_seen_at > now() - interval '2 minutes'
  order by profile.last_seen_at desc;
$$;

revoke all on function public.list_packlista_presence() from public, anon;
grant execute on function public.list_packlista_presence() to authenticated;

create or replace function public.list_packlista_directory()
returns table (id uuid, display_name text, avatar_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id,
    coalesce(nullif(profile.display_name, ''), 'Användare')::text,
    profile.avatar_key
  from public.users profile
  where (select auth.uid()) is not null
    and profile.id <> (select auth.uid())
  order by lower(coalesce(nullif(profile.display_name, ''), 'Användare'));
$$;

revoke all on function public.list_packlista_directory() from public, anon;
grant execute on function public.list_packlista_directory() to authenticated;

create or replace function public.list_packlista_members(requested_list_id uuid)
returns table (user_id uuid, display_name text, avatar_key text, access_level text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_access_packing_list(requested_list_id, false) then
    raise exception 'Atkomst nekad' using errcode = '42501';
  end if;
  return query
  select member.user_id,
    coalesce(nullif(profile.display_name, ''), 'Användare')::text,
    profile.avatar_key,
    member.access_level
  from public.packing_list_members member
  join public.users profile on profile.id = member.user_id
  where member.packing_list_id = requested_list_id
  order by lower(coalesce(nullif(profile.display_name, ''), 'Användare'));
end;
$$;

revoke all on function public.list_packlista_members(uuid) from public, anon;
grant execute on function public.list_packlista_members(uuid) to authenticated;

create or replace function public.share_packlista(requested_list_id uuid, target_user_id uuid, requested_access text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_access not in ('viewer', 'editor') then
    raise exception 'Ogiltig behörighet' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.packing_lists
    where id = requested_list_id and user_id = (select auth.uid())
  ) then
    raise exception 'Endast listans ägare kan dela den' using errcode = '42501';
  end if;
  if target_user_id = (select auth.uid()) then
    raise exception 'Ägaren behöver inte läggas till' using errcode = '22023';
  end if;
  insert into public.packing_list_members (packing_list_id, user_id, access_level, invited_by, updated_at)
  values (requested_list_id, target_user_id, requested_access, (select auth.uid()), now())
  on conflict (packing_list_id, user_id) do update
    set access_level = excluded.access_level, updated_at = now();
end;
$$;

revoke all on function public.share_packlista(uuid, uuid, text) from public, anon;
grant execute on function public.share_packlista(uuid, uuid, text) to authenticated;

create or replace function public.unshare_packlista(requested_list_id uuid, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.packing_lists
    where id = requested_list_id and user_id = (select auth.uid())
  ) then
    raise exception 'Endast listans ägare kan ändra delning' using errcode = '42501';
  end if;
  delete from public.packing_list_members
  where packing_list_id = requested_list_id and user_id = target_user_id;
end;
$$;

revoke all on function public.unshare_packlista(uuid, uuid) from public, anon;
grant execute on function public.unshare_packlista(uuid, uuid) to authenticated;

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
    where public.users.id = (select auth.uid()) and public.users.role in ('admin', 'owner')
  ) then
    raise exception 'Administratorsbehörighet krävs' using errcode = '42501';
  end if;
  return query
  select profile.id, coalesce(account.email, '')::text,
    coalesce(profile.display_name, '')::text, profile.role, profile.avatar_key,
    account.created_at, account.last_sign_in_at, profile.last_seen_at,
    profile.last_seen_at > now() - interval '2 minutes'
  from public.users profile
  join auth.users account on account.id = profile.id
  order by profile.created_at desc;
end;
$$;

revoke all on function public.admin_list_packlista_users() from public, anon;
grant execute on function public.admin_list_packlista_users() to authenticated;

notify pgrst, 'reload schema';
