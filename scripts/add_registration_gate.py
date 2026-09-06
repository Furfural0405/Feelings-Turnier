
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src" / "App.tsx"
TYPES = ROOT / "src" / "types.ts"
STYLES = ROOT / "src" / "styles.css"
TOURNAMENT = ROOT / "src" / "lib" / "tournament.ts"

def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"{label} konnte im aktuellen Repository-Stand nicht gefunden werden.")
    return text.replace(old, new, 1)

def main():
    app = APP.read_text(encoding="utf-8")
    types = TYPES.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")
    tournament = TOURNAMENT.read_text(encoding="utf-8")

    types = replace_once(
        types,
        '''export type CompetitionSettings = {
  teamSize: number
  winPoints: number
  drawPoints: number
  lossPoints: number
}''',
        '''export type CompetitionSettings = {
  teamSize: number
  winPoints: number
  drawPoints: number
  lossPoints: number
  registrationEnabled: boolean
}''',
        "CompetitionSettings",
    )

    app = replace_once(
        app,
        "const DEFAULT_COMPETITION: CompetitionSettings = { teamSize: 1, winPoints: 3, drawPoints: 1, lossPoints: 0 }",
        "const DEFAULT_COMPETITION: CompetitionSettings = { teamSize: 1, winPoints: 3, drawPoints: 1, lossPoints: 0, registrationEnabled: true }",
        "DEFAULT_COMPETITION",
    )

    app = replace_once(
        app,
        '''  return {
    teamSize: clamp(Number(candidate.teamSize) || 1, 1, 5),
    winPoints: safeNumber(candidate.winPoints, 3),
    drawPoints: safeNumber(candidate.drawPoints, 1),
    lossPoints: safeNumber(candidate.lossPoints, 0),
  }''',
        '''  return {
    teamSize: clamp(Number(candidate.teamSize) || 1, 1, 5),
    winPoints: safeNumber(candidate.winPoints, 3),
    drawPoints: safeNumber(candidate.drawPoints, 1),
    lossPoints: safeNumber(candidate.lossPoints, 0),
    registrationEnabled: candidate.registrationEnabled !== false,
  }''',
        "normalizeCompetition",
    )

    app = replace_once(
        app,
        '''  const isAdmin = Boolean(profile?.approved && profile.role === 'admin')
  const isCreator = Boolean(isAdmin && profile?.is_creator)
  const participantMap = useMemo(''',
        '''  const isAdmin = Boolean(profile?.approved && profile.role === 'admin')
  const isCreator = Boolean(isAdmin && profile?.is_creator)
  const registrationIsOpen = competition.registrationEnabled && state.groups.length === 0
  const participantMap = useMemo(''',
        "registrationIsOpen",
    )

    app = replace_once(
        app,
        '''    const cleaned = normalizeCompetition(competition)
    setCompetition(cleaned)''',
        '''    const cleaned = normalizeCompetition({
      ...competition,
      registrationEnabled: competition.registrationEnabled && state.groups.length === 0,
    })
    setCompetition(cleaned)''',
        "saveCompetitionSettings Registrierungsschutz",
    )

    marker = "  async function changeTeamSize(rawTeamSize: number) {"
    if "async function setRegistrationEnabled" not in app:
        insert = '''  async function setRegistrationEnabled(enabled: boolean) {
    if (!supabase || !isAdmin) return

    if (enabled && state.groups.length > 0) {
      setNotice('Die Anmeldung kann nicht geöffnet werden, solange eine Gruppenphase existiert. Setze zuerst das Turnier zurück.')
      return
    }

    setSiteSaving(true)
    const { error } = await supabase.rpc('set_tournament_registration_enabled', {
      p_enabled: enabled,
    })
    setSiteSaving(false)

    if (error) {
      setNotice(`Anmeldestatus konnte nicht geändert werden: ${error.message}`)
      return
    }

    setCompetition((current) => ({ ...current, registrationEnabled: enabled }))
    if (!enabled) {
      setNewName('')
      setTeamMembers([])
    }
    setNotice(enabled
      ? '✓ Turnier-Anmeldung ist jetzt geöffnet.'
      : 'Turnier-Anmeldung wurde geschlossen.')
  }

'''
        if marker not in app:
            raise RuntimeError("Einfügepunkt für setRegistrationEnabled nicht gefunden.")
        app = app.replace(marker, insert + marker, 1)

    submit_marker = '''    if (!supabase) {
      setNotice('Supabase ist noch nicht konfiguriert.')
      return false
    }

    if (cleaned.length < 2 || cleaned.length > 40) {'''
    submit_replacement = '''    if (!supabase) {
      setNotice('Supabase ist noch nicht konfiguriert.')
      return false
    }

    const { data: registrationOpenRaw, error: registrationError } = await supabase.rpc('current_tournament_registration_open')
    if (registrationError) {
      setNotice(`Anmeldestatus konnte nicht geprüft werden: ${registrationError.message}`)
      return false
    }
    if (registrationOpenRaw !== true) {
      setCompetition((current) => ({ ...current, registrationEnabled: false }))
      setNewName('')
      setTeamMembers([])
      setNotice('Die Turnier-Anmeldung ist aktuell geschlossen.')
      return false
    }

    if (cleaned.length < 2 || cleaned.length > 40) {'''
    app = replace_once(app, submit_marker, submit_replacement, "serverseitige Anmeldeprüfung")

    app = replace_once(
        app,
        '''  async function addBulkParticipants() {
    if (!supabase || !isAdmin || competition.teamSize !== 1) return''',
        '''  async function addBulkParticipants() {
    if (!supabase || !isAdmin || competition.teamSize !== 1) return
    if (!registrationIsOpen) {
      setNotice('Die Turnier-Anmeldung ist aktuell geschlossen.')
      return
    }''',
        "Bulk-Anmeldesperre",
    )

    old_groups = '''  function createGroups() {
    if (!isAdmin) return
    if (state.participants.length < 1) {
      setNotice('Bitte zuerst Teilnehmer hinzufügen.')
      return
    }

    const plan = createQualificationPlan(state.participants.length, state.groupCount)
    const actualGroupCount = plan?.groupCount ?? Math.max(1, Math.min(state.groupCount, state.participants.length))
    const groups = distributeIntoGroups(state.participants, actualGroupCount)
    const stats = Object.fromEntries(state.participants.map((participant) => [participant.id, emptyParticipantStats(state.groupRoundCount)]))
    const groupMatches = createGroupMatches(groups)

    setState((current) => ({ ...current, groupCount: actualGroupCount, groups, groupMatches, stats, knockoutBracket: null }))
    if (!plan) setNotice('Gruppen erstellt. Eine K.O.-Phase benötigt mindestens 4 Teilnehmer.')
    else if (plan.adjusted) setNotice(`Automatisch angepasst: ${plan.requestedGroupCount} → ${plan.groupCount} Gruppen. ${planText(plan)}`)
    else setNotice(`Gruppen erstellt. ${planText(plan)}`)
  }'''
    new_groups = '''  async function createGroups() {
    if (!isAdmin || !supabase) return
    if (state.participants.length < 1) {
      setNotice('Bitte zuerst Teilnehmer hinzufügen.')
      return
    }

    const { error: registrationError } = await supabase.rpc('set_tournament_registration_enabled', {
      p_enabled: false,
    })
    if (registrationError) {
      setNotice(`Gruppenphase konnte nicht gestartet werden, weil die Anmeldung nicht geschlossen werden konnte: ${registrationError.message}`)
      return
    }

    const plan = createQualificationPlan(state.participants.length, state.groupCount)
    const actualGroupCount = plan?.groupCount ?? Math.max(1, Math.min(state.groupCount, state.participants.length))
    const groups = distributeIntoGroups(state.participants, actualGroupCount)
    const stats = Object.fromEntries(state.participants.map((participant) => [participant.id, emptyParticipantStats(state.groupRoundCount)]))
    const groupMatches = createGroupMatches(groups)

    setCompetition((current) => ({ ...current, registrationEnabled: false }))
    setNewName('')
    setTeamMembers([])
    setState((current) => ({ ...current, groupCount: actualGroupCount, groups, groupMatches, stats, knockoutBracket: null }))

    const prefix = 'Anmeldung automatisch geschlossen. '
    if (!plan) setNotice(`${prefix}Gruppen erstellt. Eine K.O.-Phase benötigt mindestens 4 Teilnehmer.`)
    else if (plan.adjusted) setNotice(`${prefix}Automatisch angepasst: ${plan.requestedGroupCount} → ${plan.groupCount} Gruppen. ${planText(plan)}`)
    else setNotice(`${prefix}Gruppen erstellt. ${planText(plan)}`)
  }'''
    app = replace_once(app, old_groups, new_groups, "automatische Schließung beim Gruppenstart")

    old_registration = '''          <p className="muted">{isAdmin ? 'Als Admin siehst du alle Anmeldungen und kannst sie verwalten.' : competition.teamSize === 1 ? 'Trage deinen Gamer-Tag ein. Bereits angemeldete Namen bleiben für Besucher unsichtbar.' : `Trage zuerst den Teamnamen und anschließend alle ${competition.teamSize} Teammitglieder ein. Bereits angemeldete Teams bleiben für Besucher unsichtbar.`}</p>
          <div className="input-row participant-submit">
            <input className="text-input" value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && competition.teamSize === 1) void addSingleParticipant() }} placeholder={competition.teamSize === 1 ? 'Name oder Gamer-Tag' : 'Teamname'} maxLength={40} />
            <button className="button" onClick={() => void addSingleParticipant()}>{competition.teamSize === 1 ? 'Für Turnier anmelden' : 'Team anmelden'}</button>
          </div>
          {competition.teamSize > 1 && newName.trim() && <div className="team-member-fields">
            {Array.from({ length: competition.teamSize }, (_, index) => <label key={index}>Spieler {index + 1}<input className="text-input" value={teamMembers[index] ?? ''} onChange={(event) => setTeamMembers((current) => Array.from({ length: competition.teamSize }, (_, memberIndex) => memberIndex === index ? event.target.value : current[memberIndex] ?? ''))} placeholder="Name oder Gamer-Tag" maxLength={40} /></label>)}
          </div>}'''
    new_registration = '''          <div className={registrationIsOpen ? 'registration-status registration-status--open' : 'registration-status registration-status--closed'}>
            <strong>{registrationIsOpen ? 'ANMELDUNG GEÖFFNET' : 'ANMELDUNG GESCHLOSSEN'}</strong>
            <span>{registrationIsOpen ? `Anmeldungen für ${competition.teamSize}vs${competition.teamSize} sind möglich.` : state.groups.length > 0 ? 'Die Gruppenphase wurde bereits erstellt. Weitere Anmeldungen sind gesperrt.' : 'Ein Admin hat die Turnier-Anmeldung aktuell deaktiviert.'}</span>
          </div>
          {registrationIsOpen ? <>
            <p className="muted">{isAdmin ? 'Als Admin siehst du alle Anmeldungen und kannst sie verwalten.' : competition.teamSize === 1 ? 'Trage deinen Gamer-Tag ein. Bereits angemeldete Namen bleiben für Besucher unsichtbar.' : `Trage zuerst den Teamnamen und anschließend alle ${competition.teamSize} Teammitglieder ein. Bereits angemeldete Teams bleiben für Besucher unsichtbar.`}</p>
            <div className="input-row participant-submit">
              <input className="text-input" value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && competition.teamSize === 1) void addSingleParticipant() }} placeholder={competition.teamSize === 1 ? 'Name oder Gamer-Tag' : 'Teamname'} maxLength={40} />
              <button className="button" onClick={() => void addSingleParticipant()}>{competition.teamSize === 1 ? 'Für Turnier anmelden' : 'Team anmelden'}</button>
            </div>
            {competition.teamSize > 1 && newName.trim() && <div className="team-member-fields">
              {Array.from({ length: competition.teamSize }, (_, index) => <label key={index}>Spieler {index + 1}<input className="text-input" value={teamMembers[index] ?? ''} onChange={(event) => setTeamMembers((current) => Array.from({ length: competition.teamSize }, (_, memberIndex) => memberIndex === index ? event.target.value : current[memberIndex] ?? ''))} placeholder="Name oder Gamer-Tag" maxLength={40} /></label>)}
            </div>}
          </> : <div className="registration-closed"><strong>Für dieses Turnier sind derzeit keine weiteren Anmeldungen möglich.</strong><span>Der Anmeldestatus wird von der Turnierleitung verwaltet.</span></div>}'''
    app = replace_once(app, old_registration, new_registration, "öffentliche Anmeldemaske")

    app = replace_once(
        app,
        '{competition.teamSize === 1 && <details className="bulk-add">',
        '{competition.teamSize === 1 && registrationIsOpen && <details className="bulk-add">',
        "Bulk-UI bei geschlossener Anmeldung",
    )

    settings_anchor = '''                    <label>Punkte pro Sieg<input className="text-input" type="number" min="0" max="20" step="0.5" value={competition.winPoints} onChange={(event) => setCompetition((current) => ({ ...current, winPoints: Number(event.target.value || 0) }))} /></label>'''
    settings_insert = '''                    <div className="settings-wide registration-admin-card">
                      <div>
                        <span className="field-label">Turnier-Anmeldung</span>
                        <strong>{registrationIsOpen ? 'Geöffnet' : 'Geschlossen'}</strong>
                        <small>{state.groups.length > 0 ? 'Gruppenphase aktiv · Anmeldung ist fest gesperrt.' : competition.registrationEnabled ? 'Neue Teilnehmer/Teams können sich anmelden.' : 'Neue Anmeldungen sind manuell deaktiviert.'}</small>
                      </div>
                      <button
                        type="button"
                        className={registrationIsOpen ? 'button button--danger' : 'button button--twitch'}
                        disabled={siteSaving || (!registrationIsOpen && state.groups.length > 0)}
                        onClick={() => void setRegistrationEnabled(!registrationIsOpen)}
                      >{registrationIsOpen ? 'Anmeldung schließen' : state.groups.length > 0 ? 'Durch Gruppenphase gesperrt' : 'Anmeldung öffnen'}</button>
                    </div>
                    <label>Punkte pro Sieg<input className="text-input" type="number" min="0" max="20" step="0.5" value={competition.winPoints} onChange={(event) => setCompetition((current) => ({ ...current, winPoints: Number(event.target.value || 0) }))} /></label>'''
    app = replace_once(app, settings_anchor, settings_insert, "Admin-Anmeldeschalter")

    app = replace_once(
        app,
        '<button className="button" onClick={createGroups}>Gruppen automatisch erstellen</button>',
        '<button className="button" onClick={() => void createGroups()}>Gruppen automatisch erstellen</button>',
        "async Gruppenbutton",
    )

    css = '''
.registration-status{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 14px;border-radius:12px;border:1px solid var(--border);font-size:.82rem}.registration-status strong{font-size:.76rem;letter-spacing:.08em}.registration-status span{color:var(--muted);text-align:right}.registration-status--open{border-color:rgba(104,235,174,.28);background:rgba(104,235,174,.06)}.registration-status--open strong{color:#9ef1c6}.registration-status--closed{border-color:rgba(255,127,189,.28);background:rgba(255,127,189,.07)}.registration-status--closed strong{color:#ff9bc9}.registration-closed{display:grid;gap:5px;padding:18px;border-radius:14px;border:1px dashed rgba(255,127,189,.22);background:rgba(15,10,24,.48)}.registration-closed strong{color:#ffe9f4}.registration-closed span{color:var(--muted);font-size:.82rem}.registration-admin-card{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px;border-radius:14px;border:1px solid rgba(145,71,255,.20);background:linear-gradient(120deg,rgba(145,71,255,.10),rgba(255,127,189,.05))}.registration-admin-card>div{display:grid;gap:4px}.registration-admin-card strong{font-size:1rem;color:#fff}.registration-admin-card small{color:var(--muted);line-height:1.45}
@media(max-width:700px){.registration-status,.registration-admin-card{align-items:flex-start;flex-direction:column}.registration-status span{text-align:left}.registration-admin-card .button{width:100%}}
'''
    if ".registration-status{" not in styles:
        styles = styles.rstrip() + "\n" + css.strip() + "\n"

    tournament = replace_once(
        tournament,
        """const DEFAULT_COMPETITION: CompetitionSettings = {
  teamSize: 1,
  winPoints: 3,
  drawPoints: 1,
  lossPoints: 0,
}""",
        """const DEFAULT_COMPETITION: CompetitionSettings = {
  teamSize: 1,
  winPoints: 3,
  drawPoints: 1,
  lossPoints: 0,
  registrationEnabled: true,
}""",
        "DEFAULT_COMPETITION in tournament.ts",
    )

    APP.write_text(app, encoding="utf-8")
    TYPES.write_text(types, encoding="utf-8")
    STYLES.write_text(styles, encoding="utf-8")
    TOURNAMENT.write_text(tournament, encoding="utf-8")
    print("Anmeldeschalter und automatische Gruppen-Sperre erfolgreich eingebaut.")

if __name__ == "__main__":
    main()
