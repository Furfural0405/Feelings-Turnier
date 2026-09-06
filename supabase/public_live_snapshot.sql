-- Bereits auf dem produktiven Supabase-Projekt angewendet.
-- Öffentliche, gefilterte Turnieransicht.
-- Vor Gruppenstart werden keinerlei Teilnehmer-/Teamnamen ausgegeben.

create or replace function public.get_public_tournament_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with source as (
    select
      s.competition,
      s.scoring,
      t.payload,
      case
        when jsonb_typeof(t.payload->'groups') = 'array'
        then jsonb_array_length(t.payload->'groups')
        else 0
      end as group_count
    from public.site_settings s
    cross join public.tournament_state t
    where s.id = 1 and t.id = 1
  ),
  grouped_ids as (
    select distinct ids.participant_id::uuid as participant_id
    from source src
    cross join lateral jsonb_array_elements(
      case when src.group_count > 0 then src.payload->'groups' else '[]'::jsonb end
    ) as grp(value)
    cross join lateral jsonb_array_elements_text(grp.value->'participantIds') as ids(participant_id)
  ),
  public_participants as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'team_size', p.team_size,
          'members', '[]'::jsonb
        )
        order by p.created_at, p.id
      ),
      '[]'::jsonb
    ) as participants
    from public.participants p
    join grouped_ids g on g.participant_id = p.id
  )
  select jsonb_build_object(
    'competition', src.competition,
    'scoring', src.scoring,
    'participants', case when src.group_count > 0 then pp.participants else '[]'::jsonb end,
    'state', case when src.group_count > 0 then src.payload else null end
  )
  from source src
  cross join public_participants pp;
$$;

revoke all on function public.get_public_tournament_snapshot() from public;
grant execute on function public.get_public_tournament_snapshot() to anon, authenticated;
