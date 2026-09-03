from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'src' / 'App.tsx'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f'Patch-Stelle nicht gefunden: {label}')
    return text.replace(old, new, 1)


def main() -> None:
    s = APP.read_text(encoding='utf-8')

    s = replace_once(
        s,
        "  const [backgroundUploadBusy, setBackgroundUploadBusy] = useState(false)\n",
        "  const [backgroundUploadBusy, setBackgroundUploadBusy] = useState(false)\n  const [clearingParticipants, setClearingParticipants] = useState(false)\n",
        'clearingParticipants state',
    )

    marker = """  function setGroupRoundCount(rawCount: number) {
"""
    function_block = """  async function removeAllParticipants() {
    if (!supabase || !isAdmin || !user) return

    const participantCount = state.participants.length
    if (participantCount === 0) {
      setNotice('Es sind aktuell keine Teilnehmer eingetragen.')
      return
    }

    const confirmed = window.confirm(
      `Wirklich alle ${participantCount} Teilnehmer gleichzeitig löschen?\\n\\nDabei werden auch Gruppen, KDA-Werte und die K.O.-Phase zurückgesetzt. Diese Aktion kann nicht rückgängig gemacht werden.`,
    )
    if (!confirmed) return

    setClearingParticipants(true)
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }

    const { error: deleteError } = await supabase
      .from('participants')
      .delete()
      .not('id', 'is', null)

    if (deleteError) {
      setClearingParticipants(false)
      setNotice(`Teilnehmer konnten nicht gelöscht werden: ${deleteError.message}`)
      return
    }

    const clearedState: TournamentState = {
      ...state,
      participants: [],
      groups: [],
      stats: {},
      knockoutBracket: null,
    }

    const { error: stateError } = await supabase
      .from('tournament_state')
      .upsert({
        id: 1,
        payload: storedState(clearedState),
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      }, { onConflict: 'id' })

    setState(clearedState)
    setNewName('')
    setBulkNames('')
    setClearingParticipants(false)

    if (stateError) {
      setNotice(`Alle Teilnehmer wurden gelöscht. Der Turnierstand konnte jedoch nicht vollständig gespeichert werden: ${stateError.message}`)
      return
    }

    setNotice(`${participantCount} Teilnehmer wurden gelöscht. Gruppen, KDA-Daten und K.O.-Phase wurden zurückgesetzt.`)
  }

"""
    if 'async function removeAllParticipants()' not in s:
        if marker not in s:
            raise RuntimeError('Patch-Stelle nicht gefunden: removeAllParticipants')
        s = s.replace(marker, function_block + marker, 1)

    old_toolbar = """            <div className=\"admin-toolbar\"><button className=\"button button--ghost\" onClick={() => void refreshParticipants()}>Anmeldungen aktualisieren</button></div>
"""
    new_toolbar = """            <div className=\"admin-toolbar\">
              <div className=\"admin-tools__actions\">
                <button className=\"button button--ghost\" disabled={clearingParticipants} onClick={() => void refreshParticipants()}>Anmeldungen aktualisieren</button>
                <button className=\"button button--danger\" disabled={clearingParticipants || state.participants.length === 0} onClick={() => void removeAllParticipants()}>{clearingParticipants ? 'Wird gelöscht …' : 'Alle Teilnehmer löschen'}</button>
              </div>
            </div>
"""
    s = replace_once(s, old_toolbar, new_toolbar, 'Teilnehmer-Admin-Toolbar')

    APP.write_text(s, encoding='utf-8')
    print('Funktion „Alle Teilnehmer löschen“ erfolgreich eingebaut.')


if __name__ == '__main__':
    main()
