-- Bereits auf dem produktiven Supabase-Projekt angewendet.
-- Transaktionaler Restore eines kompletten Turnier-Backups.

create or replace function public.restore_tournament_backup(
  p_participants jsonb,
  p_state jsonb,
  p_competition jsonb,
  p_scoring jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  participant jsonb;
  restore_team_size integer;
  participant_team_size integer;
  participant_members jsonb;
  participant_name text;
begin
  if not private.is_approved_admin() then
    raise exception 'Nur freigeschaltete Admins dürfen Turnier-Backups wiederherstellen.';
  end if;

  if jsonb_typeof(p_participants) <> 'array'
     or jsonb_typeof(p_state) <> 'object'
     or jsonb_typeof(p_competition) <> 'object'
     or jsonb_typeof(p_scoring) <> 'object' then
    raise exception 'Ungültiges Turnier-Backup.';
  end if;

  restore_team_size := greatest(
    1,
    least(5, coalesce(nullif(p_competition->>'teamSize', '')::integer, 1))
  );

  for participant in select value from jsonb_array_elements(p_participants)
  loop
    participant_name := trim(coalesce(participant->>'name', ''));
    participant_team_size := greatest(
      1,
      least(
        5,
        coalesce(
          nullif(participant->>'teamSize', '')::integer,
          nullif(participant->>'team_size', '')::integer,
          1
        )
      )
    );
    participant_members := coalesce(participant->'members', '[]'::jsonb);

    if participant_name = '' or char_length(participant_name) not between 2 and 40 then
      raise exception 'Ungültiger Teilnehmer-/Teamname im Backup.';
    end if;

    if participant_team_size <> restore_team_size then
      raise exception 'Backup enthält Teilnehmer/Teams mit einer anderen Teamgröße als der gespeicherte Turniermodus.';
    end if;

    if jsonb_typeof(participant_members) <> 'array'
       or jsonb_array_length(participant_members) <> participant_team_size then
      raise exception 'Ungültige Mitgliederliste für %.', participant_name;
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(participant_members) as member(value)
      where char_length(trim(member.value)) not between 2 and 40
    ) then
      raise exception 'Ungültiger Spielername im Team %.', participant_name;
    end if;
  end loop;

  update public.site_settings
  set competition = p_competition,
      scoring = p_scoring,
      updated_at = now(),
      updated_by = auth.uid()
  where id = 1;

  delete from public.participants;

  for participant in select value from jsonb_array_elements(p_participants)
  loop
    insert into public.participants (id, name, team_size, members, submitted_by)
    values (
      (participant->>'id')::uuid,
      trim(participant->>'name'),
      greatest(
        1,
        least(
          5,
          coalesce(
            nullif(participant->>'teamSize', '')::integer,
            nullif(participant->>'team_size', '')::integer,
            1
          )
        )
      ),
      participant->'members',
      null
    );
  end loop;

  insert into public.tournament_state (id, payload, updated_at, updated_by)
  values (1, p_state, now(), auth.uid())
  on conflict (id) do update
  set payload = excluded.payload,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.restore_tournament_backup(jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.restore_tournament_backup(jsonb, jsonb, jsonb, jsonb) from anon;
grant execute on function public.restore_tournament_backup(jsonb, jsonb, jsonb, jsonb) to authenticated;
