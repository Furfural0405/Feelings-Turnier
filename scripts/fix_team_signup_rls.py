
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src" / "App.tsx"

def main():
    s = APP.read_text(encoding="utf-8")

    old = """  async function submitParticipant(name: string) {
    const cleaned = name.trim()
    if (!cleaned) return false
    if (!supabase) {
      setNotice('Supabase ist noch nicht konfiguriert.')
      return false
    }

    const teamSize = competition.teamSize
    const members = teamSize === 1
      ? [cleaned]
      : Array.from({ length: teamSize }, (_, index) => (teamMembers[index] ?? '').trim())

    if (teamSize > 1 && members.some((member) => member.length < 2)) {
      setNotice(`Bitte für alle ${teamSize} Teammitglieder einen Namen oder Gamer-Tag eintragen.`)
      return false
    }

    const { error } = await supabase.from('participants').insert({
      name: cleaned,
      team_size: teamSize,
      members,
      submitted_by: user?.id ?? null,
    })
    if (error) {
      if (error.code === '23505') setNotice(teamSize === 1 ? 'Dieser Gamer-Tag ist bereits angemeldet.' : 'Dieser Teamname ist bereits angemeldet.')
      else setNotice(`Anmeldung fehlgeschlagen: ${error.message}`)
      return false
    }

    setNotice(teamSize === 1 ? '✓ Gamer-Tag wurde für das Turnier angemeldet.' : `✓ Team „${cleaned}“ wurde für das ${teamSize}vs${teamSize}-Turnier angemeldet.`)
    setTeamMembers([])
    if (isAdmin) await refreshParticipants()
    return true
  }
"""

    new = """  async function submitParticipant(name: string) {
    const cleaned = name.trim()
    if (!supabase) {
      setNotice('Supabase ist noch nicht konfiguriert.')
      return false
    }

    if (cleaned.length < 2 || cleaned.length > 40) {
      setNotice(competition.teamSize === 1
        ? 'Der Gamer-Tag muss zwischen 2 und 40 Zeichen lang sein.'
        : 'Der Teamname muss zwischen 2 und 40 Zeichen lang sein.')
      return false
    }

    // Den aktiven Modus unmittelbar vor der Anmeldung serverseitig prüfen.
    // Dadurch kann ein noch geöffnetes Browserfenster niemals mit einem
    // veralteten lokalen Modus gegen die RLS-Policy laufen.
    const { data: serverTeamSizeRaw, error: modeError } = await supabase.rpc('current_tournament_team_size')
    if (modeError) {
      setNotice(`Aktiver Turniermodus konnte nicht geprüft werden: ${modeError.message}`)
      return false
    }

    const serverTeamSize = clamp(Number(serverTeamSizeRaw) || 1, 1, 5)
    if (serverTeamSize !== competition.teamSize) {
      setCompetition((current) => ({ ...current, teamSize: serverTeamSize }))
      setTeamMembers([])
      setNewName('')
      setNotice(`Der Turniermodus wurde inzwischen auf ${serverTeamSize}vs${serverTeamSize} geändert. Die Anmeldung wurde aktualisiert – bitte Daten erneut eingeben.`)
      return false
    }

    const teamSize = serverTeamSize
    const members = teamSize === 1
      ? [cleaned]
      : Array.from({ length: teamSize }, (_, index) => (teamMembers[index] ?? '').trim())

    if (members.length !== teamSize || members.some((member) => member.length < 2 || member.length > 40)) {
      setNotice(`Bitte für alle ${teamSize} Teammitglieder einen Namen oder Gamer-Tag mit 2 bis 40 Zeichen eintragen.`)
      return false
    }

    // submitted_by wird bei öffentlichen Turnieranmeldungen bewusst NULL
    // gelassen. Die Admin-Berechtigung wird für die Verwaltung separat über
    // profiles/RLS geprüft. Dadurch kann eine stale Auth-Session die öffentliche
    // Insert-Policy nicht blockieren.
    const { error } = await supabase.from('participants').insert({
      name: cleaned,
      team_size: teamSize,
      members,
      submitted_by: null,
    })

    if (error) {
      if (error.code === '23505') {
        setNotice(teamSize === 1 ? 'Dieser Gamer-Tag ist bereits angemeldet.' : 'Dieser Teamname ist bereits angemeldet.')
      } else if (error.code === '42501' || error.message.toLowerCase().includes('row-level security')) {
        setNotice(`Anmeldung wurde von der Sicherheitsregel abgelehnt. Aktiver Modus: ${teamSize}vs${teamSize}. Bitte Seite einmal neu laden und erneut versuchen.`)
      } else {
        setNotice(`Anmeldung fehlgeschlagen: ${error.message}`)
      }
      return false
    }

    setNotice(teamSize === 1
      ? '✓ Gamer-Tag wurde für das Turnier angemeldet.'
      : `✓ Team „${cleaned}“ wurde für das ${teamSize}vs${teamSize}-Turnier angemeldet.`)
    setTeamMembers([])
    if (isAdmin) await refreshParticipants()
    return true
  }
"""

    if "serverTeamSizeRaw" in s and "submitted_by: null" in s:
        print("Team-Anmelde-RLS-Fix ist bereits eingebaut.")
        return

    if old not in s:
        raise RuntimeError("Die aktuelle submitParticipant-Funktion konnte nicht eindeutig gefunden werden.")

    s = s.replace(old, new, 1)
    APP.write_text(s, encoding="utf-8")
    print("Team-Anmelde-RLS-Fix erfolgreich eingebaut.")

if __name__ == "__main__":
    main()
