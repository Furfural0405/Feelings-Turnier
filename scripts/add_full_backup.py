
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src" / "App.tsx"

def main():
    s = APP.read_text(encoding="utf-8")

    old_export = """  function downloadJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `feelings-turnier-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }
"""

    new_export = """  function downloadJson() {
    const backup = {
      format: 'feelings-tournament-backup',
      version: 2,
      exportedAt: new Date().toISOString(),
      competition: normalizeCompetition(competition),
      scoring: normalizeScoring(scoringWeights),
      state,
    }

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `feelings-turnier-vollbackup-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }
"""

    old_import = """  async function importState(file: File | undefined) {
    if (!file || !isAdmin) return
    try {
      const parsed = JSON.parse(await file.text()) as Partial<TournamentState>
      if (!Array.isArray(parsed.groups)) throw new Error('Ungültiges Format')
      const groupRoundCount = clamp(Number(parsed.groupRoundCount) || 3, 1, 7)
      setState((current) => ({
        participants: current.participants,
        groupCount: clamp(Number(parsed.groupCount) || 1, 1, 10),
        groupRoundCount,
        groups: parsed.groups ?? [],
        groupMatches: Array.isArray(parsed.groupMatches) ? parsed.groupMatches : [],
        stats: Object.fromEntries(current.participants.map((participant) => [
          participant.id,
          normalizeParticipantStats(parsed.stats?.[participant.id], groupRoundCount),
        ])),
        knockoutBracket: normalizeBracket(parsed.knockoutBracket),
      }))
      setNotice('Turnierstand importiert.')
    } catch {
      setNotice('Import fehlgeschlagen.')
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }
"""

    new_import = """  async function importState(file: File | undefined) {
    if (!file || !isAdmin || !supabase || !user) return

    try {
      const raw = JSON.parse(await file.text()) as {
        format?: unknown
        version?: unknown
        exportedAt?: unknown
        competition?: unknown
        scoring?: unknown
        state?: Partial<TournamentState>
        participants?: unknown
        groups?: unknown
        groupMatches?: unknown
        stats?: unknown
        knockoutBracket?: KnockoutBracket | null
        groupCount?: unknown
        groupRoundCount?: unknown
      }

      // Neue Vollbackups liegen unter raw.state. Ältere Exporte bestanden
      // direkt aus TournamentState und werden weiterhin unterstützt.
      const parsed = raw.state && typeof raw.state === 'object'
        ? raw.state
        : raw as Partial<TournamentState>

      if (!Array.isArray(parsed.participants)) {
        throw new Error('Dieses Backup enthält keine Teilnehmer-/Teamdaten.')
      }
      if (!Array.isArray(parsed.groups)) {
        throw new Error('Dieses Backup enthält keine gültigen Gruppendaten.')
      }

      const participants = parsed.participants.map(normalizeParticipant)
      const participantIds = new Set<string>()
      const participantNames = new Set<string>()

      for (const participant of participants) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(participant.id)) {
          throw new Error(`Ungültige Teilnehmer-ID bei „${participant.name || 'Unbekannt'}“.`)
        }
        if (participantIds.has(participant.id)) {
          throw new Error('Das Backup enthält doppelte Teilnehmer-IDs.')
        }
        participantIds.add(participant.id)

        const normalizedName = participant.name.trim().toLocaleLowerCase('de')
        if (participantNames.has(normalizedName)) {
          throw new Error(`Der Teilnehmer-/Teamname „${participant.name}“ kommt doppelt vor.`)
        }
        participantNames.add(normalizedName)
      }

      const derivedTeamSize = participants[0]?.teamSize ?? competition.teamSize
      const restoredCompetition = normalizeCompetition(
        raw.competition ?? { ...competition, teamSize: derivedTeamSize },
      )
      const restoredScoring = normalizeScoring(raw.scoring ?? scoringWeights)

      if (participants.some((participant) => participant.teamSize !== restoredCompetition.teamSize)) {
        throw new Error(`Das Backup passt nicht einheitlich zum Modus ${restoredCompetition.teamSize}vs${restoredCompetition.teamSize}.`)
      }

      const groupRoundCount = clamp(Number(parsed.groupRoundCount) || 3, 1, 7)
      const rawStats = parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {}
      const restoredState: TournamentState = {
        participants,
        groupCount: clamp(Number(parsed.groupCount) || 1, 1, 10),
        groupRoundCount,
        groups: parsed.groups,
        groupMatches: Array.isArray(parsed.groupMatches) ? parsed.groupMatches : [],
        stats: Object.fromEntries(participants.map((participant) => [
          participant.id,
          normalizeParticipantStats(rawStats[participant.id], groupRoundCount),
        ])),
        knockoutBracket: normalizeBracket(parsed.knockoutBracket),
      }

      const exportedAt = typeof raw.exportedAt === 'string'
        ? new Date(raw.exportedAt).toLocaleString('de-DE')
        : 'unbekannt'
      const label = restoredCompetition.teamSize === 1 ? 'Teilnehmer' : 'Teams'
      const confirmed = window.confirm(
        `Vollbackup wirklich wiederherstellen?\\n\\nBackup: ${exportedAt}\\nModus: ${restoredCompetition.teamSize}vs${restoredCompetition.teamSize}\\n${label}: ${participants.length}\\n\\nDer aktuell gespeicherte Turnierstand und alle aktuellen Anmeldungen werden vollständig durch dieses Backup ersetzt.`,
      )
      if (!confirmed) return

      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = null
      }

      const { error } = await supabase.rpc('restore_tournament_backup', {
        p_participants: participants,
        p_state: storedState(restoredState),
        p_competition: restoredCompetition,
        p_scoring: restoredScoring,
      })

      if (error) throw error

      setCompetition(restoredCompetition)
      setScoringWeights(restoredScoring)
      setState(restoredState)
      setTeamMembers([])
      setNewName('')
      setBulkNames('')
      setAdminDataLoaded(true)
      setNotice(
        `✓ Vollbackup wiederhergestellt: ${participants.length} ${label}, Modus ${restoredCompetition.teamSize}vs${restoredCompetition.teamSize}, KDA, Gruppen, Ergebnisse und K.O.-Entscheidungen wurden geladen.`,
      )
    } catch (error) {
      setNotice(`Import fehlgeschlagen: ${error instanceof Error ? error.message : 'Ungültiges Backup.'}`)
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }
"""

    old_tools = """            <section className="panel admin-tools"><div><h2>Admin Tools</h2><p className="muted">Turnierstand exportieren/importieren oder Turnierdaten zurücksetzen.</p></div><div className="admin-tools__actions"><button className="button button--ghost" onClick={downloadJson}>Export</button><button className="button button--ghost" onClick={() => importRef.current?.click()}>Import</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importState(event.target.files?.[0])} /><button className="button button--danger" onClick={() => void resetTournament()}>Turnier zurücksetzen</button></div></section>"""
    new_tools = """            <section className="panel admin-tools"><div><h2>Admin Tools</h2><p className="muted">Vollständiges Turnier-Backup inklusive Modus, Teilnehmer/Teams, Spielernamen, KDA, Gruppen, Match-Ergebnissen und K.O.-Entscheidungen.</p></div><div className="admin-tools__actions"><button className="button button--ghost" onClick={downloadJson}>Vollbackup exportieren</button><button className="button button--ghost" onClick={() => importRef.current?.click()}>Backup importieren</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importState(event.target.files?.[0])} /><button className="button button--danger" onClick={() => void resetTournament()}>Turnier zurücksetzen</button></div></section>"""

    if "feelings-tournament-backup" not in s:
        if old_export not in s:
            raise RuntimeError("Export-Funktion konnte nicht gefunden werden.")
        s = s.replace(old_export, new_export, 1)

    if "restore_tournament_backup" not in s:
        if old_import not in s:
            raise RuntimeError("Import-Funktion konnte nicht gefunden werden.")
        s = s.replace(old_import, new_import, 1)

    if "Vollbackup exportieren" not in s and old_tools in s:
        s = s.replace(old_tools, new_tools, 1)

    APP.write_text(s, encoding="utf-8")
    print("Vollständiger Turnier-Backup/Restore-Fix erfolgreich eingebaut.")

if __name__ == "__main__":
    main()
