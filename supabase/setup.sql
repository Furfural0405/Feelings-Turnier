-- Referenz-Setup für Feelings-Turnier.
-- Ersteller/Admin: turnier.admin@gmx.de
-- Nur dieser Ersteller darf Admin-Zugriffe freischalten oder ablehnen.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  approved boolean not null default false,
  role text not null default 'viewer' check (role in ('viewer', 'admin')),
  created_at timestamptz not null default now(),
  is_creator boolean not null default false,
  access_status text not null default 'pending' check (access_status in ('pending', 'approved', 'rejected'))
);

alter table public.profiles add column if not exists is_creator boolean not null default false;
alter table public.profiles add column if not exists access_status text not null default 'pending';

alter table public.profiles drop constraint if exists profiles_access_status_check;
alter table public.profiles add constraint profiles_access_status_check check (access_status in ('pending', 'approved', 'rejected'));

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 40),
  submitted_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists participants_name_unique_ci on public.participants (lower(trim(name)));

create table if not exists public.tournament_state (
  id smallint primary key check (id = 1),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

insert into public.tournament_state (id, payload) values (1, '{}'::jsonb) on conflict (id) do nothing;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, approved, role, is_creator, access_status)
  values (new.id, coalesce(new.email, ''), false, 'viewer', false, 'pending')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email on auth.users for each row execute procedure public.handle_new_user();

-- Sicherheitshalber fehlende Profile bestehender Auth-Nutzer nachziehen.
insert into public.profiles (id, email, approved, role, is_creator, access_status)
select u.id, coalesce(u.email, ''), false, 'viewer', false, 'pending'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- Bestehende freigeschaltete Accounts als approved markieren.
update public.profiles
set access_status = case when approved then 'approved' else access_status end;

-- Genau dieser Account ist der Ersteller und kann nicht über die Web-App demotet werden.
update public.profiles set is_creator = false;
update public.profiles
set is_creator = true, approved = true, role = 'admin', access_status = 'approved'
where lower(email) = lower('turnier.admin@gmx.de');

create or replace function private.is_approved_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approved = true and p.role = 'admin'
  );
$$;

create or replace function private.is_creator_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.approved = true
      and p.role = 'admin'
      and p.is_creator = true
      and lower(p.email) = lower('turnier.admin@gmx.de')
  );
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.is_approved_admin() from public, anon;
revoke all on function private.is_creator_admin() from public, anon;
grant execute on function private.is_approved_admin() to authenticated;
grant execute on function private.is_creator_admin() to authenticated;

-- Alte Management-Hilfen entfernen, falls eine frühere Version sie angelegt hat.
drop policy if exists "owner read profiles" on public.profiles;
drop policy if exists "owner update profiles" on public.profiles;
drop function if exists private.can_manage_admins();
alter table public.profiles drop column if exists can_manage_admins;

alter table public.profiles enable row level security;
alter table public.participants enable row level security;
alter table public.tournament_state enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.participants from anon, authenticated;
revoke all on table public.tournament_state from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (approved, role, access_status) on public.profiles to authenticated;
grant insert on table public.participants to anon, authenticated;
grant select, update, delete on table public.participants to authenticated;
grant select, insert, update on table public.tournament_state to authenticated;

drop policy if exists "profile self read" on public.profiles;
drop policy if exists "admin read profiles" on public.profiles;
drop policy if exists "admin update profiles" on public.profiles;
drop policy if exists "creator read profiles" on public.profiles;
drop policy if exists "creator update profiles" on public.profiles;

create policy "profile self read" on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy "creator read profiles" on public.profiles for select to authenticated
using ((select private.is_creator_admin()));
create policy "creator update profiles" on public.profiles for update to authenticated
using ((select private.is_creator_admin()) and is_creator = false)
with check ((select private.is_creator_admin()) and is_creator = false);

drop policy if exists "public participant signup" on public.participants;
drop policy if exists "admin read participants" on public.participants;
drop policy if exists "admin update participants" on public.participants;
drop policy if exists "admin delete participants" on public.participants;
create policy "public participant signup" on public.participants for insert to anon, authenticated
with check (char_length(trim(name)) between 2 and 40 and (submitted_by is null or submitted_by = (select auth.uid())));
create policy "admin read participants" on public.participants for select to authenticated using ((select private.is_approved_admin()));
create policy "admin update participants" on public.participants for update to authenticated using ((select private.is_approved_admin())) with check ((select private.is_approved_admin()));
create policy "admin delete participants" on public.participants for delete to authenticated using ((select private.is_approved_admin()));

drop policy if exists "admin read tournament state" on public.tournament_state;
drop policy if exists "admin insert tournament state" on public.tournament_state;
drop policy if exists "admin update tournament state" on public.tournament_state;
create policy "admin read tournament state" on public.tournament_state for select to authenticated using ((select private.is_approved_admin()));
create policy "admin insert tournament state" on public.tournament_state for insert to authenticated with check ((select private.is_approved_admin()) and id = 1);
create policy "admin update tournament state" on public.tournament_state for update to authenticated using ((select private.is_approved_admin())) with check ((select private.is_approved_admin()) and id = 1);

-- Öffentliche Header-Inhalte: jeder darf lesen, freigeschaltete Admins dürfen schreiben.
create table if not exists public.site_settings (
  id smallint primary key check (id = 1),
  hero jsonb not null default jsonb_build_object(
    'titleLine1', 'FEELINGS',
    'titleLine2', 'TURNIER',
    'lead', 'Drei KDA-Runden. Automatische Gruppen. Eine globale K.O.-Stage. Ein Champion.',
    'tags', jsonb_build_array('VALORANT VIBES', 'STREAM MODE', 'KDA TRACKING')
  ),
  background jsonb not null default jsonb_build_object(
    'enabled', false,
    'url', '',
    'path', '',
    'fit', 'cover',
    'position', 'center top',
    'repeat', 'no-repeat',
    'opacity', 42,
    'hideDefaultFloral', false
  ),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

insert into public.site_settings (id) values (1) on conflict (id) do nothing;
alter table public.site_settings
  add column if not exists background jsonb not null default '{"enabled":false,"url":"","path":"","fit":"cover","position":"center top","repeat":"no-repeat","opacity":42,"hideDefaultFloral":false}'::jsonb;
update public.site_settings
set background = coalesce(background, '{}'::jsonb) || jsonb_build_object('repeat', coalesce(background->>'repeat', 'no-repeat'))
where id = 1;
alter table public.site_settings enable row level security;
revoke all on table public.site_settings from anon, authenticated;
grant select on table public.site_settings to anon, authenticated;
grant insert, update on table public.site_settings to authenticated;

drop policy if exists "public read site settings" on public.site_settings;
drop policy if exists "admin insert site settings" on public.site_settings;
drop policy if exists "admin update site settings" on public.site_settings;
create policy "public read site settings" on public.site_settings for select to anon, authenticated using (id = 1);
create policy "admin insert site settings" on public.site_settings for insert to authenticated with check ((select private.is_approved_admin()) and id = 1);
create policy "admin update site settings" on public.site_settings for update to authenticated using ((select private.is_approved_admin())) with check ((select private.is_approved_admin()) and id = 1);

-- Öffentliche Website-Bilder. Lesen ist über den Public Bucket möglich; Änderungen nur für freigeschaltete Admins.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-assets', 'site-assets', true, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "approved admins upload site backgrounds" on storage.objects;
drop policy if exists "approved admins read site backgrounds" on storage.objects;
drop policy if exists "approved admins update site backgrounds" on storage.objects;
drop policy if exists "approved admins delete site backgrounds" on storage.objects;

create policy "approved admins upload site backgrounds" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'site-assets'
  and (storage.foldername(name))[1] = 'backgrounds'
  and lower(storage.extension(name)) = any (array['png','jpg','jpeg','webp'])
  and (select private.is_approved_admin())
);
create policy "approved admins read site backgrounds" on storage.objects
for select to authenticated
using (
  bucket_id = 'site-assets'
  and (storage.foldername(name))[1] = 'backgrounds'
  and (select private.is_approved_admin())
);
create policy "approved admins update site backgrounds" on storage.objects
for update to authenticated
using (
  bucket_id = 'site-assets'
  and (storage.foldername(name))[1] = 'backgrounds'
  and (select private.is_approved_admin())
)
with check (
  bucket_id = 'site-assets'
  and (storage.foldername(name))[1] = 'backgrounds'
  and lower(storage.extension(name)) = any (array['png','jpg','jpeg','webp'])
  and (select private.is_approved_admin())
);
create policy "approved admins delete site backgrounds" on storage.objects
for delete to authenticated
using (
  bucket_id = 'site-assets'
  and (storage.foldername(name))[1] = 'backgrounds'
  and (select private.is_approved_admin())
);

-- Supabase-only Registrierung ohne Signup-Bestätigungsmail.
-- Die öffentliche Edge Function ruft diese Rate-Limit-Funktion ausschließlich mit service_role auf.
create table if not exists private.registration_rate_limits (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip_hash text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists registration_rate_limits_email_time_idx
  on private.registration_rate_limits (email_hash, attempted_at desc);
create index if not exists registration_rate_limits_ip_time_idx
  on private.registration_rate_limits (ip_hash, attempted_at desc);

revoke all on table private.registration_rate_limits from public, anon, authenticated;

create or replace function public.check_registration_rate_limit(p_email text, p_ip text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email_hash text;
  v_ip_hash text;
  v_email_attempts integer;
  v_ip_attempts integer;
begin
  v_email_hash := encode(extensions.digest(lower(trim(coalesce(p_email, ''))), 'sha256'), 'hex');
  v_ip_hash := encode(extensions.digest(coalesce(nullif(trim(p_ip), ''), 'unknown'), 'sha256'), 'hex');

  delete from private.registration_rate_limits
  where attempted_at < now() - interval '24 hours';

  select count(*) into v_email_attempts
  from private.registration_rate_limits
  where email_hash = v_email_hash
    and attempted_at >= now() - interval '60 minutes';

  select count(*) into v_ip_attempts
  from private.registration_rate_limits
  where ip_hash = v_ip_hash
    and attempted_at >= now() - interval '15 minutes';

  if v_email_attempts >= 3 or v_ip_attempts >= 8 then
    return false;
  end if;

  insert into private.registration_rate_limits (email_hash, ip_hash)
  values (v_email_hash, v_ip_hash);

  return true;
end;
$$;

revoke all on function public.check_registration_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.check_registration_rate_limit(text, text) to service_role;
