-- In-app feedback: bug reports and feature suggestions.
--
-- Anyone may submit, including the signed-out guest planner, since that
-- is where a first-time visitor is most likely to hit something broken.
-- Nobody may read the table back through PostgREST -- there is no select
-- policy at all -- so submissions are only visible through the
-- admin-only functions at the bottom of this file.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  kind text not null check (kind in ('bug', 'idea')),
  message text not null check (char_length(message) between 3 and 4000),
  contact text check (contact is null or char_length(contact) <= 200),
  page_url text check (page_url is null or char_length(page_url) <= 500),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  status text not null default 'new' check (status in ('new', 'handled')),
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_at_idx on public.feedback(created_at desc);
create index if not exists feedback_status_idx on public.feedback(status);

alter table public.feedback enable row level security;

-- The column checks above are the real guard against junk rows: the
-- insert policy cannot see message length, so both belt and braces are
-- needed. user_id may only be your own -- a signed-out submission leaves
-- it null rather than letting anyone attribute feedback to someone else.
drop policy if exists feedback_insert_any on public.feedback;
create policy feedback_insert_any on public.feedback for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

revoke all on public.feedback from anon, authenticated;
grant insert on public.feedback to anon, authenticated;

create or replace function public.admin_list_feedback()
returns table (
  id uuid, kind text, message text, contact text, page_url text,
  user_agent text, status text, created_at timestamptz, display_name text
)
language plpgsql
stable
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
  select entry.id, entry.kind, entry.message, entry.contact, entry.page_url,
    entry.user_agent, entry.status, entry.created_at,
    coalesce(nullif(profile.display_name, ''), '')::text
  from public.feedback entry
  left join public.users profile on profile.id = entry.user_id
  -- Unhandled first, newest first within each group.
  order by (entry.status = 'handled'), entry.created_at desc;
end;
$$;

revoke all on function public.admin_list_feedback() from public, anon;
grant execute on function public.admin_list_feedback() to authenticated;

create or replace function public.admin_set_feedback_status(entry_id uuid, next_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if next_status not in ('new', 'handled') then
    raise exception 'Ogiltig status' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.users
    where public.users.id = (select auth.uid())
      and (public.users.role = 'admin' or public.users.is_owner)
  ) then
    raise exception 'Administratorsbehörighet krävs' using errcode = '42501';
  end if;
  update public.feedback set status = next_status where id = entry_id;
end;
$$;

revoke all on function public.admin_set_feedback_status(uuid, text) from public, anon;
grant execute on function public.admin_set_feedback_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';
