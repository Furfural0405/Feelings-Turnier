
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src" / "App.tsx"

def main():
    s = APP.read_text(encoding="utf-8")

    if "Moduswechsel gespeichert." not in s:
        pattern = re.compile(
            r"  async function saveCompetitionSettings\(\) \{.*?\n  async function saveScoringSettings\(\) \{",
            re.S,
        )
        replacement = """  async function saveCompetitionSettings() {
    if (!supabase || !isAdmin || !user) return
    const cleaned = normalizeCompetition(competition)
    setCompetition(cleaned)
    setSiteSaving(true)
    const { error } = await supabase
      .from('site_settings')
      .update({ competition: cleaned, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq('id', 1)
    setSiteSaving(false)
    setNotice(error
      ? `Tabellenwertung konnte nicht gespeichert werden: ${error.message}`
      : 'Tabellenwertung wurde veröffentlicht.')
  }

  async function changeTeamSize(rawTeamSize: number) {
    if (!supabase || !isAdmin || !user) return

    const nextTeamSize = clamp(rawTeamSize, 1, 5)
    if (nextTeamSize === competition.teamSize) {
      setNotice(`${nextTeamSize}vs${nextTeamSize} ist bereits der aktive Turniermodus.`)
      return
    }

    const participantCount = state.participants.length
    if (participantCount > 0) {
      const confirmed = window.confirm(
        `Turniermodus wirklich von ${competition.teamSize}vs${competition.teamSize} auf ${nextTeamSize}vs${nextTeamSize} ändern?\\n\\nDabei werden alle ${participantCount} vorhandenen Anmeldungen sowie Gruppen, Match-Ergebnisse, KDA-Daten und die K.O.-Phase gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.`,
      )
      if (!confirmed) return
    }

    setSiteSaving(true)

    if (participantCount > 0) {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = null
      }

      const { error: deleteError } = await supabase
        .from('participants')
        .delete()
        .not('id', 'is', null)

      if (deleteError) {
        setSiteSaving(false)
        setNotice(`Moduswechsel abgebrochen: Anmeldungen konnten nicht gelöscht werden: ${deleteError.message}`)
        return
      }

      const clearedState: TournamentState = {
        ...state,
        participants: [],
        groups: [],
        groupMatches: [],
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

      if (stateError) {
        setSiteSaving(false)
        setNotice(`Anmeldungen wurden gelöscht, der Turnierstand konnte aber nicht vollständig zurückgesetzt werden: ${stateError.message}`)
        return
      }
    }

    const nextCompetition = normalizeCompetition({ ...competition, teamSize: nextTeamSize })
    const { error } = await supabase
      .from('site_settings')
      .update({
        competition: nextCompetition,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq('id', 1)

    setSiteSaving(false)

    if (error) {
      setNotice(`Turniermodus konnte nicht gespeichert werden: ${error.message}`)
      return
    }

    setCompetition(nextCompetition)
    setTeamMembers([])
    setNewName('')
    setBulkNames('')
    setNotice(`Moduswechsel gespeichert. ${nextTeamSize}vs${nextTeamSize} ist jetzt aktiv.`)
  }

  async function saveScoringSettings() {"""
        s2, count = pattern.subn(replacement, s, count=1)
        if count != 1:
            raise RuntimeError("Funktionsblock für Turniermodus konnte nicht gefunden werden.")
        s = s2

    old_mode = """                    <label>Turniermodus<select className="select-input" value={competition.teamSize} onChange={(event) => changeTeamSize(Number(event.target.value))}>{[1,2,3,4,5].map((size) => <option key={size} value={size}>{size}vs{size}{size === 1 ? ' · Einzelspieler' : ` · ${size} Spieler pro Team`}</option>)}</select></label>"""
    new_mode = """                    <div className="settings-wide">
                      <span className="field-label">Turniermodus · aktiv: {competition.teamSize}vs{competition.teamSize}</span>
                      <div className="admin-tools__actions" style={{ justifyContent: 'flex-start', marginTop: '8px' }}>
                        {[1,2,3,4,5].map((size) => <button
                          type="button"
                          key={size}
                          className={competition.teamSize === size ? 'button button--twitch' : 'button button--ghost'}
                          disabled={siteSaving}
                          onClick={() => void changeTeamSize(size)}
                        >{size}vs{size}{size === 1 ? ' · Einzel' : ' · Team'}</button>)}
                      </div>
                      <span className="muted" style={{ marginTop: '8px', display: 'block' }}>Modus wird sofort gespeichert.</span>
                    </div>"""
    if "Modus wird sofort gespeichert." not in s:
        if old_mode not in s:
            raise RuntimeError("Turniermodus-Dropdown konnte nicht gefunden werden.")
        s = s.replace(old_mode, new_mode, 1)

    old_warning = """                  {state.participants.length > 0 && <p className="settings-warning">Der Modus ist gesperrt, solange Anmeldungen vorhanden sind. Zum Wechsel zwischen 1vs1 und Teammodus zuerst alle Teilnehmer/Teams löschen.</p>}"""
    new_warning = """                  {state.participants.length > 0 && <p className="settings-warning">Beim Wechsel des Turniermodus erscheint eine Sicherheitsabfrage. Nach Bestätigung werden vorhandene Anmeldungen, Gruppen, Match-Ergebnisse, KDA-Daten und die K.O.-Phase automatisch zurückgesetzt.</p>}"""
    if old_warning in s:
        s = s.replace(old_warning, new_warning, 1)

    old_button = """                  <button className="button button--twitch" disabled={siteSaving} onClick={() => void saveCompetitionSettings()}>{siteSaving ? 'Wird gespeichert …' : 'Turniermodus & Wertung veröffentlichen'}</button>"""
    new_button = """                  <button className="button button--twitch" disabled={siteSaving} onClick={() => void saveCompetitionSettings()}>{siteSaving ? 'Wird gespeichert …' : 'Tabellenwertung veröffentlichen'}</button>"""
    if old_button in s:
        s = s.replace(old_button, new_button, 1)

    APP.write_text(s, encoding="utf-8")
    print("Moduswechsel-Hotfix erfolgreich eingebaut.")

if __name__ == "__main__":
    main()
