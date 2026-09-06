
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src" / "App.tsx"
STYLES = ROOT / "src" / "styles.css"

def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"{label} konnte im aktuellen Repository-Stand nicht gefunden werden.")
    return text.replace(old, new, 1)

def main():
    app = APP.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    app = replace_once(
        app,
        "function planText(plan: QualificationPlan | null): string {",
        """function normalizePublicTournamentState(value: unknown): TournamentState | null {
  const candidate = value && typeof value === 'object'
    ? value as { participants?: unknown; state?: unknown }
    : {}
  const payload = candidate.state && typeof candidate.state === 'object'
    ? candidate.state as Partial<StoredTournamentState>
    : null

  if (!payload || !Array.isArray(payload.groups) || payload.groups.length === 0) return null

  const participants = Array.isArray(candidate.participants)
    ? candidate.participants.map(normalizeParticipant).filter((participant) => participant.id && participant.name)
    : []
  const groupRoundCount = clamp(Number(payload.groupRoundCount) || 3, 1, 7)
  const rawStats = payload.stats && typeof payload.stats === 'object'
    ? payload.stats as Record<string, ParticipantStats>
    : {}

  return {
    participants,
    groupCount: clamp(Number(payload.groupCount) || payload.groups.length, 1, 10),
    groupRoundCount,
    groups: payload.groups,
    groupMatches: Array.isArray(payload.groupMatches) ? payload.groupMatches : [],
    stats: Object.fromEntries(participants.map((participant) => [
      participant.id,
      normalizeParticipantStats(rawStats[participant.id], groupRoundCount),
    ])),
    knockoutBracket: normalizeBracket(payload.knockoutBracket),
  }
}

function planText(plan: QualificationPlan | null): string {""",
        "öffentliche Snapshot-Normalisierung",
    )

    app = replace_once(
        app,
        """function App() {
  const [state, setState] = useState<TournamentState>(DEFAULT_STATE)""",
        """function App() {
  const [state, setState] = useState<TournamentState>(DEFAULT_STATE)
  const [publicState, setPublicState] = useState<TournamentState | null>(null)""",
        "publicState",
    )

    app = replace_once(
        app,
        "  const registrationIsOpen = competition.registrationEnabled && state.groups.length === 0",
        "  const registrationIsOpen = competition.registrationEnabled && (isAdmin ? state.groups.length === 0 : (publicState?.groups.length ?? 0) === 0)",
        "öffentlicher Gruppenstatus für Anmeldung",
    )

    auth_effect_marker = """  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }"""
    live_effect = """  useEffect(() => {
    if (!supabase || isAdmin) {
      if (isAdmin) setPublicState(null)
      return
    }

    let cancelled = false

    async function refreshPublicTournament() {
      const { data, error } = await supabase!.rpc('get_public_tournament_snapshot')
      if (cancelled || error || !data) return

      const snapshot = data as {
        competition?: unknown
        scoring?: unknown
        participants?: unknown
        state?: unknown
      }

      if (snapshot.competition) setCompetition(normalizeCompetition(snapshot.competition))
      if (snapshot.scoring) setScoringWeights(normalizeScoring(snapshot.scoring))
      setPublicState(normalizePublicTournamentState(snapshot))
    }

    void refreshPublicTournament()
    const interval = window.setInterval(() => void refreshPublicTournament(), 2000)
    const onFocus = () => void refreshPublicTournament()
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [isAdmin])

"""
    if "get_public_tournament_snapshot" not in app:
        if auth_effect_marker not in app:
            raise RuntimeError("Einfügepunkt für automatische Zuschauer-Aktualisierung nicht gefunden.")
        app = app.replace(auth_effect_marker, live_effect + auth_effect_marker, 1)

    scoring_old = """        <section className="panel scoring-panel">
          <div className="section-heading"><div><span className="step">02</span><h2>KDA-Wertung</h2></div></div>
          <div className="score-rules">
            <div className="rule"><strong>+{formatPoints(scoringWeights.kill)}</strong><span>Kill</span></div>
            <div className="rule"><strong>+{formatPoints(scoringWeights.assist)}</strong><span>Assist</span></div>
            <div className="rule rule--negative"><strong>−{formatPoints(scoringWeights.death)}</strong><span>Death</span></div>
            <div className="rule"><strong>+{formatPoints(scoringWeights.positiveBonus)}</strong><span>K + A &gt; D</span></div>
            <div className="rule rule--negative"><strong>−{formatPoints(scoringWeights.negativePenalty)}</strong><span>K + A &lt; D</span></div>
          </div>
        </section>

        {!isAdmin ? (
          <section className="panel locked-panel"><div className="lock-icon">⌁</div><div><p className="eyebrow">ADMIN CHANNEL</p><h2>Turniersteuerung geschützt</h2><p className="muted">Gruppen, Ranglisten, Teilnehmernamen, KDA-Eingaben und K.O.-Matches sind nur für freigeschaltete Accounts sichtbar.</p>{user && !profile?.approved && <p className="pending-note">Dein Account ist angemeldet, wartet aber noch auf Freischaltung.</p>}</div></section>
        ) : (
          <>"""
    scoring_new = """        {isAdmin && <section className="panel scoring-panel">
          <div className="section-heading"><div><span className="step">02</span><h2>KDA-Wertung</h2></div></div>
          <div className="score-rules">
            <div className="rule"><strong>+{formatPoints(scoringWeights.kill)}</strong><span>Kill</span></div>
            <div className="rule"><strong>+{formatPoints(scoringWeights.assist)}</strong><span>Assist</span></div>
            <div className="rule rule--negative"><strong>−{formatPoints(scoringWeights.death)}</strong><span>Death</span></div>
            <div className="rule"><strong>+{formatPoints(scoringWeights.positiveBonus)}</strong><span>K + A &gt; D</span></div>
            <div className="rule rule--negative"><strong>−{formatPoints(scoringWeights.negativePenalty)}</strong><span>K + A &lt; D</span></div>
          </div>
        </section>}

        {!isAdmin && publicState && publicState.groups.length > 0 && <>
          <section className="panel public-live-header">
            <div className="section-heading">
              <div><span className="step">LIVE</span><h2>Turnierstand</h2></div>
              <span className="counter">AUTO-AKTUALISIERUNG · 2 SEK.</span>
            </div>
            <p className="muted">Gruppen, Ergebnisse und KDA-Werte werden automatisch aktualisiert. Ein Neuladen der Seite ist nicht erforderlich.</p>
          </section>

          {publicState.groups.map((group) => <PublicGroupSection
            key={group.id}
            group={group}
            state={publicState}
            competition={competition}
            scoringWeights={scoringWeights}
          />)}

          {publicState.knockoutBracket && <PublicKnockoutSection
            state={publicState}
            competition={competition}
            scoringWeights={scoringWeights}
          />}
        </>}

        {isAdmin && (
          <>"""
    app = replace_once(app, scoring_old, scoring_new, "öffentliche Zuschaueransicht / Admin-Channel entfernen")

    component_marker = "function KnockoutMatchCard({"
    public_components = r"""function PublicGroupSection({
  group,
  state,
  competition,
  scoringWeights,
}: {
  group: TournamentState['groups'][number]
  state: TournamentState
  competition: CompetitionSettings
  scoringWeights: ScoringWeights
}) {
  const participantMap = new Map(state.participants.map((participant) => [participant.id, participant]))
  const groupMatches = state.groupMatches.filter((match) => match.groupId === group.id)
  const standings = buildStandings(group, state.participants, state.stats, scoringWeights, state.groupMatches, competition)

  return <section className="panel group-panel public-group-panel">
    <div className="section-heading">
      <div><span className="step">{group.name}</span><h2>{competition.teamSize === 1 ? 'Spieler' : 'Teams'} & Ergebnisse</h2></div>
      <span className="counter">{group.participantIds.length} {competition.teamSize === 1 ? 'SPIELER' : 'TEAMS'}</span>
    </div>

    <div className="public-match-list">
      {groupMatches.map((match) => {
        const left = participantMap.get(match.player1Id)?.name ?? 'Unbekannt'
        const right = participantMap.get(match.player2Id)?.name ?? 'Unbekannt'
        const result = match.result === 'player1'
          ? `Sieg · ${left}`
          : match.result === 'player2'
            ? `Sieg · ${right}`
            : match.result === 'draw'
              ? 'Unentschieden'
              : 'Noch kein Ergebnis'
        return <div className="public-match-row" key={match.id}>
          <strong>{left}</strong>
          <span className="public-match-vs">vs</span>
          <strong>{right}</strong>
          <em>{result}</em>
        </div>
      })}
    </div>

    <div className="stats-wrap">
      <table className="stats-table public-standings-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{competition.teamSize === 1 ? 'Spieler' : 'Team'}</th>
            <th>Siege</th>
            <th>Unentschieden</th>
            <th>Niederlagen</th>
            <th>Kills</th>
            <th>Deaths</th>
            <th>Assists</th>
            <th>Punkte (S/U/N)</th>
            <th>Punkte (KDA)</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row, index) => <tr key={row.participantId}>
            <td className="public-rank">{index + 1}</td>
            <th className="player-cell">{row.name}</th>
            <td>{row.wins}</td>
            <td>{row.draws}</td>
            <td>{row.losses}</td>
            <td>{row.kills}</td>
            <td>{row.deaths}</td>
            <td>{row.assists}</td>
            <td className="points">{formatPoints(row.matchPoints)}</td>
            <td className={row.totalPoints < 0 ? 'points points--negative' : 'points'}>{formatPoints(row.totalPoints)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>
}

function PublicKnockoutSection({
  state,
  competition,
  scoringWeights,
}: {
  state: TournamentState
  competition: CompetitionSettings
  scoringWeights: ScoringWeights
}) {
  const bracket = state.knockoutBracket
  if (!bracket) return null

  const participantMap = new Map(state.participants.map((participant) => [participant.id, participant]))
  const championId = bracket.rounds.at(-1)?.[0]?.winnerId ?? null

  return <section className="panel ko-panel public-ko-panel">
    <div className="section-heading">
      <div><span className="step">K.O.</span><h2>Globale K.O.-Phase</h2></div>
      {championId && <span className="champion-badge">CHAMPION · {participantMap.get(championId)?.name ?? 'Unbekannt'}</span>}
    </div>
    <p className="muted">Der K.O.-Baum wird automatisch aktualisiert. Angezeigt werden Ergebnisse, KDA-Werte und gegebenenfalls manuelle Adminentscheidungen.</p>

    <div className="bracket public-bracket">
      {bracket.rounds.map((round, roundIndex) => <div className="bracket-round" key={roundIndex}>
        <h4>{roundName(bracket.qualifierIds.length, roundIndex)}</h4>
        <div className="round-matches">
          {round.map((match, matchIndex) => <PublicKnockoutMatchCard
            key={match.id}
            match={match}
            matchIndex={matchIndex}
            participantMap={participantMap}
            scoringWeights={scoringWeights}
            teamSize={competition.teamSize}
          />)}
        </div>
      </div>)}
    </div>
  </section>
}

function PublicKnockoutMatchCard({
  match,
  matchIndex,
  participantMap,
  scoringWeights,
  teamSize,
}: {
  match: KnockoutMatch
  matchIndex: number
  participantMap: Map<string, Participant>
  scoringWeights: ScoringWeights
  teamSize: number
}) {
  const automaticWinnerId = match.result === 'player1'
    ? match.player1Id
    : match.result === 'player2'
      ? match.player2Id
      : null
  const winnerName = match.winnerId ? participantMap.get(match.winnerId)?.name ?? 'Unbekannt' : null
  const manualDecision = Boolean(match.winnerId && match.winnerId !== automaticWinnerId)
  const resultLabel = winnerName
    ? `${manualDecision ? 'Adminentscheidung' : 'Sieger'} · ${winnerName}`
    : match.result === 'draw'
      ? 'Unentschieden'
      : 'Noch kein Ergebnis'

  const playerIds = [match.player1Id, match.player2Id]

  return <div className="match-card public-ko-match">
    <span className="match-number">MATCH {matchIndex + 1}</span>
    <div className={manualDecision ? 'public-ko-result public-ko-result--manual' : 'public-ko-result'}>
      <strong>{resultLabel}</strong>
      <span>{match.kdaRoundCount || 1} KDA-Runde{(match.kdaRoundCount || 1) === 1 ? '' : 'n'}</span>
    </div>

    {playerIds.map((participantId, playerIndex) => {
      if (!participantId) {
        return <div className="ko-player-block ko-player-block--empty" key={`public-empty-${playerIndex}`}>
          <strong>TBD</strong>
          <span>Wartet auf vorheriges Match</span>
        </div>
      }

      const participantStats = normalizeParticipantStats(match.stats?.[participantId], match.kdaRoundCount || 1)
      const kills = participantStats.rounds.reduce((sum, round) => sum + round.kills, 0)
      const assists = participantStats.rounds.reduce((sum, round) => sum + round.assists, 0)
      const deaths = participantStats.rounds.reduce((sum, round) => sum + round.deaths, 0)
      const total = participantStats.rounds.reduce((sum, round) => sum + calculateRoundScore(round, scoringWeights), 0)
      const playerName = participantMap.get(participantId)?.name ?? 'Unbekannt'

      return <div className={match.winnerId === participantId ? 'ko-player-block ko-player-block--winner' : 'ko-player-block'} key={participantId}>
        <div className="ko-player-title">
          <strong>{playerName}</strong>
          <span className={total < 0 ? 'points points--negative' : 'points'}>{formatPoints(total)} KDA-Pkt.</span>
        </div>
        <div className="public-ko-stats">
          <span><strong>{kills}</strong> Kills</span>
          <span><strong>{deaths}</strong> Deaths</span>
          <span><strong>{assists}</strong> Assists</span>
          <span><strong>{teamSize}vs{teamSize}</strong></span>
        </div>
      </div>
    })}
  </div>
}

"""
    if "function PublicGroupSection" not in app:
        if component_marker not in app:
            raise RuntimeError("Einfügepunkt für öffentliche Komponenten nicht gefunden.")
        app = app.replace(component_marker, public_components + component_marker, 1)

    css = r"""
.public-live-header{border-color:rgba(145,71,255,.28);background:linear-gradient(130deg,rgba(145,71,255,.08),rgba(255,127,189,.04))}
.public-group-panel .stats-wrap{margin-top:18px}
.public-standings-table{min-width:1080px}
.public-standings-table td,.public-standings-table th{text-align:center}
.public-standings-table .player-cell{text-align:left;min-width:180px}
.public-rank{font-weight:800;color:#d9c5ff}
.public-match-list{display:grid;gap:8px;margin:12px 0 18px}
.public-match-row{display:grid;grid-template-columns:minmax(120px,1fr) auto minmax(120px,1fr) minmax(150px,.8fr);align-items:center;gap:12px;padding:11px 13px;border:1px solid rgba(145,71,255,.14);border-radius:11px;background:rgba(13,9,22,.42)}
.public-match-row strong:first-child{text-align:right}
.public-match-vs{color:var(--muted);font-size:.76rem;text-transform:uppercase}
.public-match-row em{font-style:normal;color:#f0dfff;text-align:right;font-size:.82rem}
.public-ko-result{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:8px 0 10px;padding:8px 10px;border-radius:9px;background:rgba(145,71,255,.08);border:1px solid rgba(145,71,255,.15);font-size:.78rem}
.public-ko-result span{color:var(--muted)}
.public-ko-result--manual{border-color:rgba(255,127,189,.35);background:rgba(255,127,189,.08)}
.public-ko-result--manual strong{color:#ffafd3}
.public-ko-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:8px}
.public-ko-stats span{display:grid;gap:2px;text-align:center;padding:7px 5px;border-radius:8px;background:rgba(255,255,255,.025);font-size:.7rem;color:var(--muted)}
.public-ko-stats strong{color:#fff;font-size:.82rem}
@media(max-width:760px){
  .public-match-row{grid-template-columns:1fr auto 1fr}
  .public-match-row em{grid-column:1/-1;text-align:center}
  .public-ko-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
}
"""
    if ".public-live-header{" not in styles:
        styles = styles.rstrip() + "\n" + css.strip() + "\n"

    APP.write_text(app, encoding="utf-8")
    STYLES.write_text(styles, encoding="utf-8")
    print("Öffentliche Live-Gruppen- und K.O.-Ansicht erfolgreich eingebaut.")

if __name__ == "__main__":
    main()
