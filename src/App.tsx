import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import {
  buildStandings,
  createGlobalKnockoutBracket,
  createQualificationPlan,
  createQualificationPlanForExistingGroups,
  distributeIntoGroups,
  roundName,
  updateBracketWinner,
} from './lib/tournament'
import { calculateRoundScore, emptyParticipantStats, formatPoints } from './lib/scoring'
import type { ParticipantStats, QualificationPlan, RoundStats, TournamentState } from './types'

const STORAGE_KEY = 'das-feelings-turnier:v3'
const LEGACY_STORAGE_KEYS = ['das-feelings-turnier:v2', 'das-feelings-turnier:v1']

const DEFAULT_STATE: TournamentState = {
  participants: [],
  groupCount: 2,
  groups: [],
  stats: {},
  knockoutBracket: null,
}

function loadState(): TournamentState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<TournamentState>
    return {
      participants: Array.isArray(parsed.participants) ? parsed.participants : [],
      groupCount: Number(parsed.groupCount) >= 1 && Number(parsed.groupCount) <= 10 ? Number(parsed.groupCount) : 2,
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      stats: parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {},
      knockoutBracket: parsed.knockoutBracket ?? null,
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

function planText(plan: QualificationPlan | null): string {
  if (!plan) return 'Für eine gruppenübergreifende K.-o.-Phase werden mindestens 8 Teilnehmer und mindestens 2 Gruppen benötigt.'
  return `${plan.groupCount} Gruppen · Top ${plan.qualifiersPerGroup} je Gruppe · ${plan.knockoutSize} Spieler in der K.-o.-Phase · Start im ${roundName(plan.knockoutSize, 0)}`
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
    const timeout = window.setTimeout(() => setNotice(''), 3600)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const participantMap = useMemo(
    () => new Map(state.participants.map((participant) => [participant.id, participant])),
    [state.participants],
  )

  const previewPlan = useMemo(
    () => createQualificationPlan(state.participants.length, state.groupCount),
    [state.participants.length, state.groupCount],
  )

  const activePlan = useMemo(
    () =>
      state.groups.length > 0
        ? createQualificationPlanForExistingGroups(state.participants.length, state.groups.length)
        : previewPlan,
    [previewPlan, state.groups.length, state.participants.length],
  )

  const championId = state.knockoutBracket?.rounds.at(-1)?.[0]?.winnerId ?? null

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
      return {
        ...current,
        participants: [...current.participants, ...newParticipants],
        knockoutBracket: null,
      }
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
        knockoutBracket: null,
      }
    })
  }

  function createGroups() {
    if (state.participants.length === 0) {
      setNotice('Bitte zuerst Teilnehmer hinzufügen. ♡')
      return
    }

    const plan = createQualificationPlan(state.participants.length, state.groupCount)
    const actualGroupCount = plan?.groupCount ?? Math.max(1, Math.min(state.groupCount, state.participants.length))
    const groups = distributeIntoGroups(state.participants, actualGroupCount)
    const stats = Object.fromEntries(state.participants.map((participant) => [participant.id, emptyParticipantStats()]))

    setState((current) => ({
      ...current,
      groupCount: actualGroupCount,
      groups,
      stats,
      knockoutBracket: null,
    }))

    if (!plan) {
      setNotice('Gruppen erstellt. Für die gruppenübergreifende K.-o.-Phase werden mindestens 8 Teilnehmer und 2 Gruppen benötigt.')
    } else if (plan.adjusted) {
      setNotice(
        `Automatisch angepasst: ${plan.requestedGroupCount} gewünschte Gruppen → ${plan.groupCount} Gruppen, damit Top ${plan.qualifiersPerGroup} ein sauberes ${plan.knockoutSize}er-K.O.-Feld ergeben.`,
      )
    } else {
      setNotice(`Gruppen erstellt · Top ${plan.qualifiersPerGroup} je Gruppe ziehen später in die K.-o.-Phase ein.`)
    }
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
        knockoutBracket: null,
      }
    })
  }

  function generateGlobalBracket() {
    if (state.groups.length === 0 || !activePlan) {
      setNotice('Die aktuelle Gruppeneinteilung kann noch keinen regelkonformen K.-o.-Baum bilden.')
      return
    }

    const bracket = createGlobalKnockoutBracket(
      state.groups,
      state.participants,
      state.stats,
      activePlan.qualifiersPerGroup,
    )

    if (bracket.qualifierIds.length !== activePlan.knockoutSize || bracket.rounds.length === 0) {
      setNotice('K.-o.-Baum konnte nicht gruppenübergreifend gesetzt werden. Bitte Gruppen neu auslosen.')
      return
    }

    setState((current) => ({ ...current, knockoutBracket: bracket }))
    setNotice(`${activePlan.knockoutSize} Spieler gesetzt · ${roundName(activePlan.knockoutSize, 0)} kann starten! ✦`)
  }

  function selectWinner(roundIndex: number, matchIndex: number, winnerId: string) {
    setState((current) => {
      if (!current.knockoutBracket) return current
      return {
        ...current,
        knockoutBracket: updateBracketWinner(current.knockoutBracket, roundIndex, matchIndex, winnerId || null),
      }
    })
  }

  function resetTournament() {
    if (!window.confirm('Wirklich alle Teilnehmer, Statistiken, Gruppen und K.-o.-Ergebnisse löschen?')) return
    setState(DEFAULT_STATE)
    setNewName('')
    setBulkNames('')
    localStorage.removeItem(STORAGE_KEY)
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key))
    setNotice('Turnier wurde zurückgesetzt.')
  }

  async function importState(file: File | undefined) {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as Partial<TournamentState>
      if (!Array.isArray(parsed.participants) || !Array.isArray(parsed.groups)) {
        throw new Error('Ungültiges Format')
      }
      setState({
        participants: parsed.participants,
        groupCount: Math.max(1, Math.min(10, Number(parsed.groupCount) || 1)),
        groups: parsed.groups,
        stats: parsed.stats ?? {},
        knockoutBracket: parsed.knockoutBracket ?? null,
      })
      setNotice('Turnierstand importiert. ♡')
    } catch {
      setNotice('Import fehlgeschlagen: Datei ist kein gültiger Turnierstand.')
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  function qualifierLabel(participantId: string | null): string | null {
    if (!participantId || !state.knockoutBracket) return null
    const qualifier = state.knockoutBracket.qualifiers.find((item) => item.participantId === participantId)
    if (!qualifier) return null
    return `${qualifier.groupRank}. · ${qualifier.groupName}`
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero__noise" />
        <div className="hero__sparkle hero__sparkle--one">✦</div>
        <div className="hero__sparkle hero__sparkle--two">♡</div>
        <div className="hero__content container">
          <div className="hero__copy">
            <div className="brand-lockup">
              <span className="brand-lockup__mark">˚ʚ♡ɞ˚</span>
              <span className="brand-lockup__text">brumefeelings community tournament</span>
            </div>
            <p className="eyebrow">VALORANT · 3 Games · Global Knockout</p>
            <h1><span>Feelings</span><br />Turnier</h1>
            <p className="hero__lead">
              Erst die Gruppenphase, dann ein gemeinsamer Fußball-K.O.-Baum. Die besten Seeds jeder Gruppe werden
              automatisch gegen niedriger platzierte Spieler aus <strong>anderen Gruppen</strong> gesetzt.
            </p>
            <div className="hero__meta">
              <span>♡ Top X automatisch</span>
              <span>✦ max. Sechzehntelfinale</span>
              <span>☁ Cross-Group Seeding</span>
            </div>
            <div className="hero__actions">
              <a className="button button--twitch" href="https://www.twitch.tv/brumefeelings" target="_blank" rel="noreferrer">
                Twitch öffnen ↗
              </a>
              <button className="button button--ghost" onClick={() => downloadJson(state)}>Turnier exportieren</button>
              <button className="button button--ghost" onClick={() => importRef.current?.click()}>Import</button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event: ChangeEvent<HTMLInputElement>) => void importState(event.target.files?.[0])}
              />
            </div>
          </div>

          <div className="hero__visual" aria-hidden="true">
            <div className="brume-card">
              <div className="brume-card__shine" />
              <div className="brume-card__logo">
                <span>Brume</span>
                <small>feelings</small>
              </div>
              <div className="brume-card__handle">brumefeelings</div>
              <div className="brume-card__divider" />
              <div className="brume-card__caption">community cup · made with ♡</div>
            </div>
            <span className="floating-heart floating-heart--one">♡</span>
            <span className="floating-heart floating-heart--two">✦</span>
          </div>
        </div>
      </header>

      <nav className="quick-nav" aria-label="Turnier-Navigation">
        <div className="container quick-nav__inner">
          <a href="#teilnehmer">01 Teilnehmer</a>
          <a href="#gruppen">02 Gruppen</a>
          <a href="#wertung">03 KDA</a>
          <a href="#ko-phase">04 K.O.</a>
        </div>
      </nav>

      <main className="container main-grid">
        {notice && <div className="notice" role="status">{notice}</div>}

        <section className="panel panel--featured" id="teilnehmer">
          <div className="section-heading">
            <div>
              <span className="step">01</span>
              <div>
                <p className="section-kicker">ready, set, feelings ♡</p>
                <h2>Teilnehmer</h2>
              </div>
            </div>
            <span className="counter">{state.participants.length} gesamt</span>
          </div>

          <div className="participant-entry">
            <div className="input-row">
              <input
                className="text-input"
                value={newName}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setNewName(event.target.value)}
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === 'Enter') addSingleParticipant()
                }}
                placeholder="Name oder Gamer-Tag"
                aria-label="Teilnehmername"
              />
              <button className="button" onClick={addSingleParticipant}>Hinzufügen ♡</button>
            </div>

            <details className="bulk-add">
              <summary>Mehrere Teilnehmer auf einmal hinzufügen</summary>
              <textarea
                className="text-area"
                value={bulkNames}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setBulkNames(event.target.value)}
                placeholder={'Eine Person pro Zeile\nFeelingsOne\nFeelingsTwo\nFeelingsThree'}
              />
              <button className="button button--secondary" onClick={addBulkParticipants}>Liste übernehmen</button>
            </details>
          </div>

          {state.participants.length === 0 ? (
            <div className="empty-state">Noch keine Teilnehmer eingetragen. Die Lobby wartet ✦</div>
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
              <div>
                <p className="section-kicker">group draw ✦</p>
                <h2>Gruppen auslosen</h2>
              </div>
            </div>
          </div>

          <div className="group-controls">
            <label className="field-label" htmlFor="group-count">Gewünschte Gruppen</label>
            <select
              id="group-count"
              className="select-input"
              value={state.groupCount}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setState((current) => ({
                  ...current,
                  groupCount: Number(event.target.value),
                  knockoutBracket: null,
                }))
              }
            >
              {Array.from({ length: 10 }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
            <button className="button" onClick={createGroups}>
              {state.groups.length > 0 ? 'Neu auslosen' : 'Gruppen erstellen'}
            </button>
          </div>

          <div className="plan-card">
            <div className="plan-card__header">
              <span className="plan-card__icon">♡</span>
              <div>
                <strong>Automatischer Turnierplan</strong>
                <p>{planText(previewPlan)}</p>
              </div>
            </div>
            {previewPlan && (
              <div className="plan-metrics">
                <PlanMetric label="Gruppen" value={previewPlan.groupCount} />
                <PlanMetric label="Weiter je Gruppe" value={`Top ${previewPlan.qualifiersPerGroup}`} />
                <PlanMetric label="K.O.-Feld" value={previewPlan.knockoutSize} />
                <PlanMetric label="Start" value={roundName(previewPlan.knockoutSize, 0)} />
              </div>
            )}
            {previewPlan?.adjusted && (
              <p className="plan-card__adjustment">
                ✦ {previewPlan.requestedGroupCount} Gruppen würden kein regelkonformes K.O.-Feld ergeben. Beim Auslosen werden deshalb automatisch {previewPlan.groupCount} Gruppen erstellt.
              </p>
            )}
          </div>

          <p className="muted">
            Pro Gruppe ziehen mindestens die Top 2 weiter, aber niemals mehr als 50&nbsp;% der Gruppe. Das Gesamtfeld wird
            automatisch auf 4, 8, 16 oder maximal 32 Spieler gebracht.
          </p>
        </section>

        <section className="panel scoring-panel" id="wertung">
          <div className="section-heading">
            <div>
              <span className="step">03</span>
              <div>
                <p className="section-kicker">three games · one ranking</p>
                <h2>KDA-Punktesystem</h2>
              </div>
            </div>
          </div>
          <div className="score-rules">
            <div className="rule"><strong>+1</strong><span>pro Kill</span></div>
            <div className="rule"><strong>+1</strong><span>pro Assist</span></div>
            <div className="rule rule--negative"><strong>−1,5</strong><span>pro Death</span></div>
            <div className="rule"><strong>+3</strong><span>wenn Kills + Assists &gt; Deaths</span></div>
            <div className="rule rule--negative"><strong>−3</strong><span>wenn Kills + Assists &lt; Deaths</span></div>
          </div>
          <p className="formula">Rundenpunkte = K + A − 1,5 × D + Bonus/Malus · Bei K + A = D gibt es keinen Zusatz.</p>
        </section>

        {state.groups.length === 0 ? (
          <section className="panel empty-state empty-state--large">
            Erstelle zuerst Gruppen. Danach erscheinen hier die drei KDA-Spiele, Ranglisten und die gemeinsame K.-o.-Phase.
          </section>
        ) : (
          <>
            {state.groups.map((group) => {
              const standings = buildStandings(group, state.participants, state.stats)
              const qualifiedCount = activePlan?.qualifiersPerGroup ?? 0

              return (
                <section className="panel group-panel" key={group.id}>
                  <div className="section-heading group-title-row">
                    <div>
                      <span className="group-letter">{group.name.replace('Gruppe ', '')}</span>
                      <div>
                        <p className="section-kicker">{group.name}</p>
                        <h2>{group.participantIds.length} Spieler</h2>
                      </div>
                    </div>
                    {qualifiedCount > 0 && <div className="qualification-badge">Top {qualifiedCount} → K.O. ♡</div>}
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
                              {[1, 2, 3].map((round) => <th colSpan={4} key={round}>Game {round}</th>)}
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
                            <h3>Rangliste</h3>
                            <p className="muted">
                              {qualifiedCount > 0
                                ? `Die Top ${qualifiedCount} sind aktuell für die gemeinsame K.-o.-Phase qualifiziert.`
                                : 'Für die aktuelle Gruppenkonstellation ist keine regelkonforme K.-o.-Phase möglich.'}
                            </p>
                          </div>
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
                    </>
                  )}
                </section>
              )
            })}

            <section className="panel knockout-panel" id="ko-phase">
              <div className="knockout-panel__glow" />
              <div className="section-heading knockout-heading">
                <div>
                  <span className="step">04</span>
                  <div>
                    <p className="section-kicker">now it gets serious ✦</p>
                    <h2>Gemeinsame K.-o.-Phase</h2>
                  </div>
                </div>
                {activePlan && <span className="counter counter--accent">{activePlan.knockoutSize} Plätze</span>}
              </div>

              {activePlan ? (
                <>
                  <div className="ko-explainer">
                    <div>
                      <strong>{roundName(activePlan.knockoutSize, 0)}</strong>
                      <span>Start-Runde</span>
                    </div>
                    <div>
                      <strong>Top {activePlan.qualifiersPerGroup}</strong>
                      <span>pro Gruppe</span>
                    </div>
                    <div>
                      <strong>≤ 50 %</strong>
                      <span>jeder Gruppe</span>
                    </div>
                    <div>
                      <strong>Cross-Group</strong>
                      <span>starke Seeds vs. schwächere Seeds</span>
                    </div>
                  </div>

                  <div className="ko-action-row">
                    <div>
                      <h3>Setzliste aus der Gruppenphase</h3>
                      <p className="muted">
                        Bei Top 2 gilt exakt: Gruppenerster gegen Gruppenzweiten einer anderen Gruppe. Wenn Top 4 oder
                        mehr weiterkommen, werden die oberen Platzierungen analog gegen niedrigere Platzierungen anderer
                        Gruppen gesetzt.
                      </p>
                    </div>
                    <button className="button button--ko" onClick={generateGlobalBracket}>
                      {state.knockoutBracket ? 'K.O. aus Ranglisten neu setzen' : 'Gruppenphase abschließen → K.O. starten'}
                    </button>
                  </div>

                  <div className="qualified-overview">
                    {state.groups.map((group) => {
                      const standings = buildStandings(group, state.participants, state.stats).slice(0, activePlan.qualifiersPerGroup)
                      return (
                        <div className="qualified-group" key={`qualified-${group.id}`}>
                          <span>{group.name}</span>
                          {standings.map((row, index) => (
                            <div key={row.participantId}>
                              <b>{index + 1}.</b> {row.name}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>

                  {championId && (
                    <div className="champion-card">
                      <span>˚ʚ♡ɞ˚</span>
                      <p>Feelings Champion</p>
                      <strong>{participantMap.get(championId)?.name ?? 'Sieger'}</strong>
                      <small>ggs ♡</small>
                    </div>
                  )}

                  {state.knockoutBracket && state.knockoutBracket.rounds.length > 0 && (
                    <div className="bracket-section">
                      <div className="bracket">
                        {state.knockoutBracket.rounds.map((round, roundIndex) => (
                          <div className="bracket-round" key={`ko-round-${roundIndex}`}>
                            <div className="round-title">
                              <span>✦</span>
                              <h4>{roundName(state.knockoutBracket?.qualifierIds.length ?? 0, roundIndex)}</h4>
                            </div>
                            <div className="round-matches">
                              {round.map((match, matchIndex) => {
                                const player1 = match.player1Id ? participantMap.get(match.player1Id)?.name : null
                                const player2 = match.player2Id ? participantMap.get(match.player2Id)?.name : null
                                const ready = Boolean(match.player1Id && match.player2Id)
                                return (
                                  <div className="match-card" key={match.id}>
                                    <span className="match-number">Match {matchIndex + 1}</span>
                                    <div className={match.winnerId === match.player1Id ? 'match-player match-player--winner' : 'match-player'}>
                                      <span className="match-player__name">{player1 ?? 'Wartet auf Sieger …'}</span>
                                      {match.player1Id && <small>{qualifierLabel(match.player1Id)}</small>}
                                    </div>
                                    <div className="versus">vs</div>
                                    <div className={match.winnerId === match.player2Id ? 'match-player match-player--winner' : 'match-player'}>
                                      <span className="match-player__name">{player2 ?? 'Wartet auf Sieger …'}</span>
                                      {match.player2Id && <small>{qualifierLabel(match.player2Id)}</small>}
                                    </div>
                                    <label className="winner-select-label">
                                      Sieger
                                      <select
                                        className="winner-select"
                                        disabled={!ready}
                                        value={match.winnerId ?? ''}
                                        onChange={(event: ChangeEvent<HTMLSelectElement>) => selectWinner(roundIndex, matchIndex, event.target.value)}
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
              ) : (
                <div className="empty-state">
                  Diese Teilnehmer-/Gruppenzahl erfüllt die Regeln noch nicht. Für Cross-Group-K.O. brauchst du mindestens 8 Teilnehmer und 2 Gruppen.
                </div>
              )}
            </section>
          </>
        )}

        <section className="panel danger-panel">
          <div>
            <p className="section-kicker">fresh start</p>
            <h2>Turnier zurücksetzen</h2>
            <p className="muted">Löscht alle lokal gespeicherten Teilnehmer, Statistiken, Gruppen und K.-o.-Ergebnisse.</p>
          </div>
          <button className="button button--danger" onClick={resetTournament}>Alles löschen</button>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer__inner">
          <span>Das Feelings-Turnier ˚ʚ♡ɞ˚</span>
          <span>Daten bleiben lokal in diesem Browser.</span>
        </div>
      </footer>
    </div>
  )
}

function PlanMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="plan-metric">
      <strong>{value}</strong>
      <span>{label}</span>
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
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
    />
  )
}

export default App
