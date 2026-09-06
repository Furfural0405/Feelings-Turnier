alter table public.participants
  add column if not exists team_size smallint not null default 1,
  add column if not exists members jsonb not null default '[]'::jsonb;

alter table public.participants drop constraint if exists participants_team_size_check;
alter table public.participants add constraint participants_team_size_check check (team_size between 1 and 5);

update public.participants
set team_size = 1,
    members = jsonb_build_array(name)
where members is null or jsonb_typeof(members) <> 'array' or jsonb_array_length(members) = 0;

alter table public.site_settings
  add column if not exists competition jsonb not null default jsonb_build_object(
    'teamSize', 1,
    'winPoints', 3,
    'drawPoints', 1,
    'lossPoints', 0
  );

create or replace function public.current_tournament_team_size()
returns integer language sql stable security definer set search_path = '' as $$
  select greatest(1, least(5, coalesce((select nullif(s.competition->>'teamSize','')::integer from public.site_settings s where s.id = 1), 1)));
$$;
revoke all on function public.current_tournament_team_size() from public;
grant execute on function public.current_tournament_team_size() to anon, authenticated;

drop policy if exists "public participant signup" on public.participants;
create policy "public participant signup" on public.participants for insert to anon, authenticated
with check (
  char_length(trim(name)) between 2 and 40
  and team_size = public.current_tournament_team_size()
  and jsonb_typeof(members) = 'array'
  and jsonb_array_length(members) = team_size
  and not exists (select 1 from jsonb_array_elements_text(members) as member(value) where char_length(trim(member.value)) not between 2 and 40)
  and (submitted_by is null or submitted_by = (select auth.uid()))
);
