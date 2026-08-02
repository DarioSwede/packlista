-- Custom categories belong to one authenticated user and are reusable across
-- that user's packlists. RLS prevents categories leaking between accounts.

create table if not exists public.user_categories (
  user_id uuid not null references auth.users(id) on delete cascade,
  category_key text not null,
  name text not null check (char_length(name) between 1 and 30),
  icon text not null default '📦' check (char_length(icon) between 1 and 8),
  color text not null default '#2f934d' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, category_key)
);

create unique index if not exists user_categories_user_name_idx
  on public.user_categories (user_id, lower(name));

alter table public.user_categories enable row level security;

create policy "Users read own categories"
  on public.user_categories for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create own categories"
  on public.user_categories for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update own categories"
  on public.user_categories for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete own categories"
  on public.user_categories for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_categories to authenticated;

-- Preserve categories users already created inside their own lists.
insert into public.user_categories (user_id, category_key, name, icon, color)
select distinct on (list.user_id, category->>'id')
  list.user_id,
  category->>'id',
  coalesce(nullif(category->>'name', ''), 'Egen kategori'),
  coalesce(nullif(category->>'icon', ''), '📦'),
  case when coalesce(category->>'color', '') ~ '^#[0-9A-Fa-f]{6}$'
    then category->>'color' else '#2f934d' end
from public.packing_lists as list
cross join lateral jsonb_array_elements(coalesce(list.categories, '[]'::jsonb)) as category
where category->>'id' like 'egen-%'
on conflict do nothing;
