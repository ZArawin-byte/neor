-- Bookmark-table boards and archived looks. Run after 001_init.sql.
-- ids are text because the browser makes them (so an offline save keeps its id once it syncs).
create table if not exists public.boards (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists boards_user_idx on public.boards (user_id);

create table if not exists public.looks (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists looks_user_idx on public.looks (user_id);

alter table public.boards enable row level security;
alter table public.looks enable row level security;
drop policy if exists "own boards" on public.boards;
create policy "own boards" on public.boards for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own looks" on public.looks;
create policy "own looks" on public.looks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
