-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.closet_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  image_path text,
  created_at timestamptz default now()
);
create index if not exists closet_items_user_idx on public.closet_items (user_id);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists orders_user_idx on public.orders (user_id);

-- Row Level Security: even if the anon key leaks, a user can only ever touch their own rows.
-- (The FastAPI server uses the service-role key and filters by the verified user id.)
alter table public.profiles enable row level security;
alter table public.closet_items enable row level security;
alter table public.orders enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "own items" on public.closet_items;
create policy "own items" on public.closet_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own orders" on public.orders;
create policy "own orders" on public.orders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Private bucket for closet + mirror photos (served via short-lived signed URLs only).
insert into storage.buckets (id, name, public)
values ('closet', 'closet', false)
on conflict (id) do nothing;
