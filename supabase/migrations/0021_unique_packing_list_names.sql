-- List names identify the user's lists in the switcher and must be unique per user.
create unique index if not exists packing_lists_user_name_unique_idx
  on public.packing_lists (user_id, lower(trim(name)));

alter table public.packing_lists
  add constraint packing_lists_name_not_blank
  check (length(trim(name)) > 0);
