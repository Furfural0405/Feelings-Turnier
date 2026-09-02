import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildStandings,
  createKnockoutBracket,
  distributeIntoGroups,
  qualifierCount,
  roundName,
  updateBracketWinner,
} from './lib/tournament'
import { calculateRoundScore, emptyParticipantStats, formatPoints } from './lib/scoring'
import type { ParticipantStats, RoundStats, TournamentState } from './types'

const STORAGE_KEY = 'das-feelings-turnier:v1'

const DEFAULT_STATE: TournamentState = {
  participants: [],
  groupCount: 2,
  groups: [],
  stats: {},
  brackets: {},
}

function loadState(): TournamentState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<TournamentState>
    return {
      participants: Array.isArray(parsed.participants) ? parsed.participants : [],
      groupCount: Number(parsed.groupCount) >= 1 && Number(parsed.groupCount) <= 10 ? Number(parsed.groupCount) : 2,
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      stats: parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {},
      brackets: parsed.brackets && typeof parsed.brackets === 'object' ? parsed.brackets : {},
    }
  } catch {
    return DEFAULT_STATE
  }
}

function downloadJson(data: TournamentState) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `feelings-turnier-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function App() {
  const [state, setState] = useState<TournamentState>(loadState)
  const [newName, setNewName] = useState('')
  const [bulkNames, setBulkNames] = useState('')
  const [notice, setNotice] = useState('')
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 2800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const participantMap = useMemo(
    () => new Map(state.participants.map((participant) => [participant.id, participant])),
    [state.participants],
  )

  function addNames(names: string[]) {
    const cleaned = names.map((name) => name.trim()).filter(Boolean)
    if (cleaned.length === 0) return

    setState((current) => {
      const existing = new Set(current.participants.map((participant) => participant.name.trim().toLocaleLowerCase('de')))
      const newParticipants = cleaned
        .filter((name) => {
          const key = name.toLocaleLowerCase('de')
          if (existing.has(key)) return false
          existing.add(key)
          return true
        })
        .map((name) => ({ id: crypto.randomUUID(), name }))

      if (newParticipants.length === 0) return current
      return { ...current, participants: [...current.participants, ...newParticipants] }
    })
  }

  function addSingleParticipant() {
    if (!newName.trim()) return
    addNames([newName])
    setNewName('')
  }

  function addBulkParticipants() {
    const names = bulkNames.split(/[\n,;]+/)
    addNames(names)
    setBulkNames('')
  }

  function removeParticipant(participantId: string) {
    setState((current) => {
      const stats = { ...current.stats }
      delete stats[participantId]
      return {
        ...current,
        participants: current.participants.filter((participant) => participant.id !== participantId),
        groups: current.groups.map((group) => ({
          ...group,
          participantIds: group.participantIds.filter((id) => id !== participantId),
        })),
        stats,
        brackets: {},
      }
    })
  }

  function createGroups() {
    if (state.participants.length === 0) {
      setNotice('Bitte zuerst Teilnehmer hinzufügen.')
      return
    }

    const groups = distributeIntoGroups(state.participants, state.groupCount)
    const stats = Object.fromEntries(state.participants.map((participant) => [participant.id, emptyParticipantStats()]))
    setState((current) => ({ ...current, groups, stats, brackets: {} }))
    setNotice('Gruppen erstellt – KDA-Statistiken wurden zurückgesetzt.')
  }

  function updateStat(participantId: string, roundIndex: number, field: keyof RoundStats, rawValue: string) {
    const value = Math.max(0, Math.trunc(Number(rawValue) || 0))
    setState((current) => {
      const participantStats = current.stats[participantId] ?? emptyParticipantStats()
      const rounds = participantStats.rounds.map((round, index) =>
        index === roundIndex ? { ...round, [field]: value } : { ...round },
      ) as ParticipantStats['rounds']

      return {
        ...current,
        stats: {
          ...current.stats,
          [participantId]: { rounds },
        },
      }
    })
  }

  function generateBracket(groupId: string) {
    const group = state.groups.find((item) => item.id === groupId)
    if (!group) return
    const standings = buildStandings(group, state.participants, state.stats)
    const count = qualifierCount(group.participantIds.length)
    const qualifierIds = standings.slice(0, count).map((row) => row.participantId)
    const bracket = createKnockoutBracket(groupId, qualifierIds)
    setState((current) => ({
      ...current,
      brackets: { ...current.brackets, [groupId]: bracket },
    }))
    setNotice(`${group.name}: K.-o.-Baum aus der aktuellen Rangliste erstellt.`)
  }

  function selectWinner(groupId: string, roundIndex: number, matchIndex: number, winnerId: string) {
    setState((current) => {
      const bracket = current.brackets[groupId]
      if (!bracket) return current
      return {
        ...current,
        brackets: {
          ...current.brackets,
          [groupId]: updateBracketWinner(bracket, roundIndex, matchIndex, winnerId || null),
        },
      }
    })
  }

  function resetTournament() {
    if (!window.confirm('Wirklich alle Teilnehmer, Statistiken, Gruppen und K.-o.-Bäume löschen?')) return
    setState(DEFAULT_STATE)
    setNewName('')
    setBulkNames('')
    localStorage.removeItem(STORAGE_KEY)
    setNotice('Turnier wurde zurückgesetzt.')
  }

  async function importState(file: File | undefined) {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as TournamentState
      if (!Array.isArray(parsed.participants) || !Array.isArray(parsed.groups)) {
        throw new Error('Ungültiges Format')
      }
      setState({
        participants: parsed.participants,
        groupCount: Math.max(1, Math.min(10, Number(parsed.groupCount) || 1)),
        groups: parsed.groups,
        stats: parsed.stats ?? {},
        brackets: parsed.brackets ?? {},
      })
      setNotice('Turnierstand importiert.')
    } catch {
      setNotice('Import fehlgeschlagen: Datei ist kein gültiger Turnierstand.')
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero__glow" />
        <div className="hero__content container">
          <div>
            <p className="eyebrow">KDA • Gruppenphase • K.-o.-System</p>
            <h1>Das Feelings-Turnier</h1>
            <p className="hero__lead">
              Teilnehmer verwalten, zufällig auf 1–10 Gruppen verteilen, drei KDA-Runden werten und daraus automatisch
              die K.-o.-Phase setzen.
            </p>
          </div>
          <div className="hero__actions">
            <button className="button button--ghost" onClick={() => downloadJson(state)}>Turnier exportieren</button>
            <button className="button button--ghost" onClick={() => importRef.current?.click()}>Turnier importieren</button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => void importState(event.target.files?.[0])}
            />
          </div>
        </div>
      </header>

      <main className="container main-grid">
        {notice && <div className="notice" role="status">{notice}</div>}

        <section className="panel" id="teilnehmer">
          <div className="section-heading">
            <div>
              <span className="step">01</span>
              <h2>Teilnehmer</h2>
            </div>
            <span className="counter">{state.participants.length} gesamt</span>
          </div>

          <div className="participant-entry">
            <div className="input-row">
              <input
                className="text-input"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addSingleParticipant()
                }}
                placeholder="Name oder Gamer-Tag"
                aria-label="Teilnehmername"
              />
              <button className="button" onClick={addSingleParticipant}>Hinzufügen</button>
            </div>

            <details className="bulk-add">
              <summary>Mehrere Teilnehmer auf einmal hinzufügen</summary>
              <textarea
                className="text-area"
                value={bulkNames}
                onChange={(event) => setBulkNames(event.target.value)}
                placeholder={'Eine Person pro Zeile\nFeelingsOne\nFeelingsTwo\nFeelingsThree'}
              />
              <button className="button button--secondary" onClick={addBulkParticipants}>Liste übernehmen</button>
            </details>
          </div>

          {state.participants.length === 0 ? (
            <div className="empty-state">Noch keine Teilnehmer eingetragen.</div>
          ) : (
            <div className="chips">
              {state.participants.map((participant, index) => (
                <div className="chip" key={participant.id}>
                  <span className="chip__index">{index + 1}</span>
                  <span>{participant.name}</span>
                  <button
                    className="chip__remove"
                    onClick={() => removeParticipant(participant.id)}
                    aria-label={`${participant.name} entfernen`}
                    title="Entfernen"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel" id="gruppen">
          <div className="section-heading">
            <div>
              <span className="step">02</span>
              <h2>Gruppen auslosen</h2>
            </div>
          </div>

          <div className="group-controls">
            <label className="field-label" htmlFor="group-count">Anzahl der Gruppen</label>
            <select
              id="group-count"
              className="select-input"
              value={state.groupCount}
              onChange={(event) => setState((current) => ({ ...current, groupCount: Number(event.target.value) }))}
            >
              {Array.from({ length: 10 }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
            <button className="button" onClick={createGroups}>
              {state.groups.length > 0 ? 'Neu auslosen & Statistik zurücksetzen' : 'Gruppen erstellen'}
            </button>
          </div>

          <p className="muted">
            Die Teilnehmer werden zufällig und möglichst gleichmäßig verteilt. Bei einer Neuauslosung werden KDA-Werte
            und K.-o.-Bäume bewusst zurückgesetzt.
          </p>
        </section>

        <section className="panel scoring-panel" id="wertung">
          <div className="section-heading">
            <div>
              <span className="step">03</span>
              <h2>Punktesystem</h2>
            </div>
          </div>
          <div className="score-rules">
            <div className="rule"><strong>+1</strong><span>pro Kill</span></div>
            <div className="rule"><strong>+1</strong><span>pro Assist</span></div>
            <div className="rule rule--negative"><strong>−1,5</strong><span>pro Death</span></div>
            <div className="rule"><strong>+3</strong><span>wenn Kills + Assists &gt; Deaths</span></div>
            <div className="rule rule--negative"><strong>−3</strong><span>wenn Kills + Assists &lt; Deaths</span></div>
          </div>
          <p className="formula">Rundenpunkte = K + A − 1,5 × D + Bonus/Malus. Bei Gleichstand K + A = D gibt es 0 Zusatzpunkte.</p>
        </section>

        {state.groups.length === 0 ? (
          <section className="panel empty-state empty-state--large">
            Erstelle zuerst Gruppen. Danach erscheinen hier KDA-Erfassung, Ranglisten und K.-o.-Bäume.
          </section>
        ) : (
          state.groups.map((group) => {
            const standings = buildStandings(group, state.participants, state.stats)
            const qualifiedCount = qualifierCount(group.participantIds.length)
            const bracket = state.brackets[group.id]
            const championId =
              group.participantIds.length === 1
                ? group.participantIds[0]
                : bracket?.rounds.at(-1)?.[0]?.winnerId ?? null

            return (
              <section className="panel group-panel" key={group.id}>
                <div className="section-heading group-title-row">
                  <div>
                    <span className="step">{group.name}</span>
                    <h2>{group.participantIds.length} Spieler</h2>
                  </div>
                  {championId && <div className="champion-badge">🏆 {participantMap.get(championId)?.name ?? 'Sieger'}</div>}
                </div>

                {group.participantIds.length === 0 ? (
                  <div className="empty-state">Diese Gruppe ist leer.</div>
                ) : (
                  <>
                    <h3>Gruppenphase · 3 Spiele</h3>
                    <div className="stats-wrap">
                      <table className="stats-table">
                        <thead>
                          <tr>
                            <th rowSpan={2}>Spieler</th>
                            {[1, 2, 3].map((round) => <th colSpan={4} key={round}>Spiel {round}</th>)}
                            <th rowSpan={2}>Gesamt</th>
                          </tr>
                          <tr>
                            {[1, 2, 3].flatMap((round) => [
                              <th key={`${round}-k`}>K</th>,
                              <th key={`${round}-a`}>A</th>,
                              <th key={`${round}-d`}>D</th>,
                              <th key={`${round}-p`}>Pkt.</th>,
                            ])}
                          </tr>
                        </thead>
                        <tbody>
                          {group.participantIds.map((participantId) => {
                            const participant = participantMap.get(participantId)
                            const participantStats = state.stats[participantId] ?? emptyParticipantStats()
                            const total = participantStats.rounds.reduce((sum, round) => sum + calculateRoundScore(round), 0)
                            return (
                              <tr key={participantId}>
                                <th className="player-cell">{participant?.name ?? 'Unbekannt'}</th>
                                {participantStats.rounds.flatMap((round, roundIndex) => [
                                  <td key={`${participantId}-${roundIndex}-k`}><StatInput value={round.kills} onChange={(value) => updateStat(participantId, roundIndex, 'kills', value)} /></td>,
                                  <td key={`${participantId}-${roundIndex}-a`}><StatInput value={round.assists} onChange={(value) => updateStat(participantId, roundIndex, 'assists', value)} /></td>,
                                  <td key={`${participantId}-${roundIndex}-d`}><StatInput value={round.deaths} onChange={(value) => updateStat(participantId, roundIndex, 'deaths', value)} /></td>,
                                  <td className={calculateRoundScore(round) < 0 ? 'points points--negative' : 'points'} key={`${participantId}-${roundIndex}-p`}>
                                    {formatPoints(calculateRoundScore(round))}
                                  </td>,
                                ])}
                                <td className={total < 0 ? 'total total--negative' : 'total'}>{formatPoints(total)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="standings-section">
                      <div className="subheading-row">
                        <div>
                          <h3>Rangliste & Qualifikation</h3>
                          <p className="muted">
                            {qualifiedCount === 0
                              ? 'Keine Qualifikation möglich.'
                              : qualifiedCount === 1
                                ? 'Einzelspieler ist automatisch Gruppensieger.'
                                : `Top ${qualifiedCount} qualifizieren sich für ${roundName(qualifiedCount, 0)}.`}
                          </p>
                        </div>
                        {qualifiedCount >= 2 && (
                          <button className="button button--secondary" onClick={() => generateBracket(group.id)}>
                            {bracket ? 'K.-o.-Baum neu setzen' : 'K.-o.-Baum erstellen'}
                          </button>
                        )}
                      </div>

                      <div className="standings-list">
                        {standings.map((row, index) => (
                          <div className={`standing ${index < qualifiedCount ? 'standing--qualified' : ''}`} key={row.participantId}>
                            <span className="standing__rank">{index + 1}</span>
                            <strong>{row.name}</strong>
                            <span className="standing__kda">{row.kills} K · {row.assists} A · {row.deaths} D</span>
                            <span className={row.totalPoints < 0 ? 'standing__points standing__points--negative' : 'standing__points'}>
                              {formatPoints(row.totalPoints)} Pkt.
                            </span>
                            {index < qualifiedCount && <span className="qualified-tag">Q</span>}
                          </div>
                        ))}
                      </div>
                    </div>

                    {bracket && bracket.rounds.length > 0 && (
                      <div className="bracket-section">
                        <div className="subheading-row">
                          <div>
                            <h3>K.-o.-Phase</h3>
                            <p className="muted">Sieger eines Spiels auswählen; die nächste Runde wird automatisch befüllt.</p>
                          </div>
                        </div>
                        <div className="bracket">
                          {bracket.rounds.map((round, roundIndex) => (
                            <div className="bracket-round" key={`${group.id}-round-${roundIndex}`}>
                              <h4>{roundName(bracket.qualifierIds.length, roundIndex)}</h4>
                              <div className="round-matches">
                                {round.map((match, matchIndex) => {
                                  const player1 = match.player1Id ? participantMap.get(match.player1Id)?.name : null
                                  const player2 = match.player2Id ? participantMap.get(match.player2Id)?.name : null
                                  const ready = Boolean(match.player1Id && match.player2Id)
                                  return (
                                    <div className="match-card" key={match.id}>
                                      <span className="match-number">Spiel {matchIndex + 1}</span>
                                      <div className={match.winnerId === match.player1Id ? 'match-player match-player--winner' : 'match-player'}>
                                        <span>{player1 ?? 'Wartet auf Sieger …'}</span>
                                      </div>
                                      <div className={match.winnerId === match.player2Id ? 'match-player match-player--winner' : 'match-player'}>
                                        <span>{player2 ?? 'Wartet auf Sieger …'}</span>
                                      </div>
                                      <label className="winner-select-label">
                                        Sieger
                                        <select
                                          className="winner-select"
                                          disabled={!ready}
                                          value={match.winnerId ?? ''}
                                          onChange={(event) => selectWinner(group.id, roundIndex, matchIndex, event.target.value)}
                                        >
                                          <option value="">– auswählen –</option>
                                          {match.player1Id && <option value={match.player1Id}>{player1}</option>}
                                          {match.player2Id && <option value={match.player2Id}>{player2}</option>}
                                        </select>
                                      </label>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            )
          })
        )}

        <section className="panel danger-panel">
          <div>
            <h2>Turnier zurücksetzen</h2>
            <p className="muted">Löscht alle lokal gespeicherten Teilnehmer, Statistiken, Gruppen und K.-o.-Ergebnisse.</p>
          </div>
          <button className="button button--danger" onClick={resetTournament}>Alles löschen</button>
        </section>
      </main>

      <footer className="footer">
        <div className="container">Das Feelings-Turnier · Daten werden nur in diesem Browser gespeichert.</div>
      </footer>
    </div>
  )
}

function StatInput({ value, onChange }: { value: number; onChange: (value: string) => void }) {
  return (
    <input
      className="stat-input"
      type="number"
      min="0"
      step="1"
      inputMode="numeric"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export default App
