-- Run in Supabase SQL editor after creating a project.
-- Dashboard → SQL → New query → paste & run.

-- Optional: profiles row per auth user (avatar lives in auth.users metadata for MVP).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Per-user app state (JSON blob) — sync target for cloud boards.
create table if not exists public.app_states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_states enable row level security;

create policy "Users read own app state"
  on public.app_states for select
  using (auth.uid() = user_id);

create policy "Users upsert own app state"
  on public.app_states for insert
  with check (auth.uid() = user_id);

create policy "Users update own app state"
  on public.app_states for update
  using (auth.uid() = user_id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1));
  insert into public.app_states (user_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
