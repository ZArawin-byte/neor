-- The bag (shopping list). Run after 001_init.sql: Dashboard -> SQL Editor -> paste -> Run.
create table if not exists public.bag (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists bag_user_idx on public.bag (user_id);
alter table public.bag enable row level security;
drop policy if exists "own bag" on public.bag;
create policy "own bag" on public.bag for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
