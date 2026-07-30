alter table public.users
  add column if not exists role text not null default 'user'
  check (role in ('user', 'admin'));

drop policy if exists users_insert_own on public.users;
create policy users_insert_own on public.users for insert to authenticated
  with check ((select auth.uid()) = id and role = 'user');

revoke insert, update, delete on public.users from authenticated;
grant select on public.users to authenticated;
grant insert (id, display_name, updated_at) on public.users to authenticated;
