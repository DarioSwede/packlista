create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.packing_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null default 'Min packlista',
  categories jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.packing_items (
  id uuid primary key default gen_random_uuid(),
  packing_list_id uuid not null references public.packing_lists(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  client_id text not null,
  name text not null,
  category text not null,
  weight integer not null default 0 check (weight >= 0),
  quantity integer not null default 1 check (quantity >= 0),
  weighed boolean not null default false,
  owned boolean not null default false,
  consumable boolean not null default false,
  worn boolean not null default false,
  note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (packing_list_id, client_id)
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  data jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists packing_lists_user_id_idx on public.packing_lists(user_id);
create index if not exists packing_items_list_id_idx on public.packing_items(packing_list_id);
create index if not exists packing_items_user_id_idx on public.packing_items(user_id);
create index if not exists templates_user_id_idx on public.templates(user_id);

alter table public.users enable row level security;
alter table public.packing_lists enable row level security;
alter table public.packing_items enable row level security;
alter table public.templates enable row level security;

drop policy if exists users_select_own on public.users;
drop policy if exists users_insert_own on public.users;
drop policy if exists users_update_own on public.users;
create policy users_select_own on public.users for select to authenticated using ((select auth.uid()) = id);
create policy users_insert_own on public.users for insert to authenticated with check ((select auth.uid()) = id);
create policy users_update_own on public.users for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists packing_lists_select_own on public.packing_lists;
drop policy if exists packing_lists_insert_own on public.packing_lists;
drop policy if exists packing_lists_update_own on public.packing_lists;
drop policy if exists packing_lists_delete_own on public.packing_lists;
create policy packing_lists_select_own on public.packing_lists for select to authenticated
  using ((select auth.uid()) = user_id);
create policy packing_lists_insert_own on public.packing_lists for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy packing_lists_update_own on public.packing_lists for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy packing_lists_delete_own on public.packing_lists for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists packing_items_select_own on public.packing_items;
drop policy if exists packing_items_insert_own on public.packing_items;
drop policy if exists packing_items_update_own on public.packing_items;
drop policy if exists packing_items_delete_own on public.packing_items;
create policy packing_items_select_own on public.packing_items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy packing_items_insert_own on public.packing_items for insert to authenticated
  with check (
    (select auth.uid()) = user_id and exists (
      select 1 from public.packing_lists list
      where list.id = packing_list_id and list.user_id = (select auth.uid())
    )
  );
create policy packing_items_update_own on public.packing_items for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id and exists (
      select 1 from public.packing_lists list
      where list.id = packing_list_id and list.user_id = (select auth.uid())
    )
  );
create policy packing_items_delete_own on public.packing_items for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists templates_select_available on public.templates;
drop policy if exists templates_insert_own on public.templates;
drop policy if exists templates_update_own on public.templates;
drop policy if exists templates_delete_own on public.templates;
create policy templates_select_available on public.templates for select to authenticated
  using (is_public or (select auth.uid()) = user_id);
create policy templates_insert_own on public.templates for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy templates_update_own on public.templates for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy templates_delete_own on public.templates for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update on public.users to authenticated;
grant select, insert, update, delete on public.packing_lists to authenticated;
grant select, insert, update, delete on public.packing_items to authenticated;
grant select, insert, update, delete on public.templates to authenticated;

notify pgrst, 'reload schema';
