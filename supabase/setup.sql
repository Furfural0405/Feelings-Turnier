-- Referenz-Setup für Feelings-Turnier.
-- Die produktive Supabase-Datenbank wurde am 2026-09-03 bereits entsprechend abgesichert.
-- Diese Datei hält das Repository auf demselben Stand.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  approved boolean not null default false,
  role text not null default 'viewer' check (role in ('viewer', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 40),
  submitted_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists participants_name_unique_ci
  on public.participants (lower(trim(name)));

create table if not exists public.tournament_state (
  id smallint primary key check (id = 1),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

insert into public.tournament_state (id, payload)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, approved, role)
  values (new.id, coalesce(new.email, ''), false, 'viewer')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute procedure public.handle_new_user();

create or replace function private.is_approved_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.approved = true
      and p.role = 'admin'
  );
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.is_approved_admin() from public, anon;
grant execute on function private.is_approved_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.participants enable row level security;
alter table public.tournament_state enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.participants from anon, authenticated;
revoke all on table public.tournament_state from anon, authenticated;

grant select, update on table public.profiles to authenticated;
grant insert on table public.participants to anon, authenticated;
grant select, update, delete on table public.participants to authenticated;
grant select, insert, update on table public.tournament_state to authenticated;

drop policy if exists "profile self read" on public.profiles;
drop policy if exists "admin read profiles" on public.profiles;
drop policy if exists "admin update profiles" on public.profiles;
drop policy if exists "public participant signup" on public.participants;
drop policy if exists "admin read participants" on public.participants;
drop policy if exists "admin update participants" on public.participants;
drop policy if exists "admin delete participants" on public.participants;
drop policy if exists "admin read tournament state" on public.tournament_state;
drop policy if exists "admin insert tournament state" on public.tournament_state;
drop policy if exists "admin update tournament state" on public.tournament_state;

create policy "profile self read" on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy "admin read profiles" on public.profiles for select to authenticated
using ((select private.is_approved_admin()));
create policy "admin update profiles" on public.profiles for update to authenticated
using ((select private.is_approved_admin()))
with check ((select private.is_approved_admin()));

create policy "public participant signup" on public.participants for insert to anon, authenticated
with check (
  char_length(trim(name)) between 2 and 40
  and (submitted_by is null or submitted_by = (select auth.uid()))
);
create policy "admin read participants" on public.participants for select to authenticated
using ((select private.is_approved_admin()));
create policy "admin update participants" on public.participants for update to authenticated
using ((select private.is_approved_admin()))
with check ((select private.is_approved_admin()));
create policy "admin delete participants" on public.participants for delete to authenticated
using ((select private.is_approved_admin()));

create policy "admin read tournament state" on public.tournament_state for select to authenticated
using ((select private.is_approved_admin()));
create policy "admin insert tournament state" on public.tournament_state for insert to authenticated
with check ((select private.is_approved_admin()) and id = 1);
create policy "admin update tournament state" on public.tournament_state for update to authenticated
using ((select private.is_approved_admin()))
with check ((select private.is_approved_admin()) and id = 1);
