-- "Favorit"-flaggan i hover-ikonraden (se app.js -- itemRow()/actionToggle()).
-- Ren markering, ingen viktberäkning eller filtrering kopplad till den (2026-07-31).
alter table public.packing_items
  add column if not exists favorite boolean not null default false;
