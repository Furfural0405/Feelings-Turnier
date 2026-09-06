
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src" / "App.tsx"
TYPES = ROOT / "src" / "types.ts"
TOURNAMENT = ROOT / "src" / "lib" / "tournament.ts"
STYLES = ROOT / "src" / "styles.css"

def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"{label} konnte im aktuellen Repository-Stand nicht gefunden werden.")
    return text.replace(old, new, 1)

def main():
    app = APP.read_text(encoding="utf-8")
    types = TYPES.read_text(encoding="utf-8")
    tournament = TOURNAMENT.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    types = replace_once(
        types,
        """export type GroupMatch = {
  id: string
  groupId: string
  player1Id: string
  player2Id: string
  result: GroupMatchResult
}""",
        """export type GroupMatch = {
  id: string
  groupId: string
  player1Id: string
  player2Id: string
  result: GroupMatchResult
  stats?: Record<string, ParticipantStats>
}""",
        "GroupMatch-Typ",
    )

    old_standings_stats = """    const participant = participantMap.get(participantId)
    const participantStats = stats[participantId] ?? emptyParticipantStats()
    const kills = participantStats.rounds.reduce((sum, round) => sum + round.kills, 0)
    const assists = participantStats.rounds.reduce((sum, round) => sum + round.assists, 0)
    const deaths = participantStats.rounds.reduce((sum, round) => sum + round.deaths, 0)
    let wins = 0"""
    new_standings_stats = """    const participant = participantMap.get(participantId)
    const matchKdaRounds = matches.flatMap((match) =>
      match.stats?.[participantId]?.rounds ?? [],
    )
    // Teammodi speichern KDA direkt pro Begegnung. Alte Turnierstände ohne
    // Match-KDA greifen weiterhin auf die bisherige Gruppen-KDA zurück.
    const participantStats = matchKdaRounds.length > 0
      ? { rounds: matchKdaRounds }
      : stats[participantId] ?? emptyParticipantStats()
    const kills = participantStats.rounds.reduce((sum, round) => sum + round.kills, 0)
    const assists = participantStats.rounds.reduce((sum, round) => sum + round.assists, 0)
    const deaths = participantStats.rounds.reduce((sum, round) => sum + round.deaths, 0)
    let wins = 0"""
    tournament = replace_once(
        tournament,
        old_standings_stats,
        new_standings_stats,
        "Match-KDA-Auswertung",
    )

    old_round_count = """      stats: Object.fromEntries(current.participants.map((participant) => [
        participant.id,
        normalizeParticipantStats(current.stats[participant.id], groupRoundCount),
      ])),
      knockoutBracket: null,"""
    new_round_count = """      stats: Object.fromEntries(current.participants.map((participant) => [
        participant.id,
        normalizeParticipantStats(current.stats[participant.id], groupRoundCount),
      ])),
      groupMatches: current.groupMatches.map((match) => {
        if (!match.stats) return match
        const participantIds = [match.player1Id, match.player2Id]
        return {
          ...match,
          stats: Object.fromEntries(participantIds.map((participantId) => [
            participantId,
            normalizeParticipantStats(match.stats?.[participantId], groupRoundCount),
          ])),
        }
      }),
      knockoutBracket: null,"""
    app = replace_once(
        app,
        old_round_count,
        new_round_count,
        "KDA-Rundenzahl für Match-KDA",
    )

    update_result_marker = """  function updateGroupMatchResult(matchId: string, result: GroupMatchResult) {
    if (!isAdmin) return
    setState((current) => ({
      ...current,
      groupMatches: current.groupMatches.map((match) => match.id === matchId ? { ...match, result } : match),
      knockoutBracket: null,
    }))
  }

"""
    update_stat_function = """  function updateGroupMatchResult(matchId: string, result: GroupMatchResult) {
    if (!isAdmin) return
    setState((current) => ({
      ...current,
      groupMatches: current.groupMatches.map((match) => match.id === matchId ? { ...match, result } : match),
      knockoutBracket: null,
    }))
  }

  function updateGroupMatchStat(
    matchId: string,
    participantId: string,
    roundIndex: number,
    field: keyof RoundStats,
    rawValue: string,
  ) {
    if (!isAdmin) return
    const value = Math.max(0, Math.trunc(Number(rawValue) || 0))

    setState((current) => ({
      ...current,
      groupMatches: current.groupMatches.map((match) => {
        if (match.id !== matchId) return match
        const participantStats = normalizeParticipantStats(match.stats?.[participantId], current.groupRoundCount)
        const rounds = participantStats.rounds.map((round, index) =>
          index === roundIndex ? { ...round, [field]: value } : { ...round },
        )
        return {
          ...match,
          stats: {
            ...(match.stats ?? {}),
            [participantId]: { rounds },
          },
        }
      }),
      knockoutBracket: null,
    }))
  }

"""
    app = replace_once(
        app,
        update_result_marker,
        update_stat_function,
        "updateGroupMatchStat",
    )

    old_match_return = """                  return <div className="group-match-row" key={match.id}><strong>{left}</strong><span>vs</span><strong>{right}</strong><select className="select-input select-input--compact" value={match.result ?? ''} onChange={(event) => updateGroupMatchResult(match.id, (event.target.value || null) as GroupMatchResult)}><option value="">Noch kein Ergebnis</option><option value="player1">Sieg · {left}</option><option value="draw">Unentschieden</option><option value="player2">Sieg · {right}</option></select></div>"""
    new_match_return = """                  if (competition.teamSize === 1) {
                    return <div className="group-match-row" key={match.id}><strong>{left}</strong><span>vs</span><strong>{right}</strong><select className="select-input select-input--compact" value={match.result ?? ''} onChange={(event) => updateGroupMatchResult(match.id, (event.target.value || null) as GroupMatchResult)}><option value="">Noch kein Ergebnis</option><option value="player1">Sieg · {left}</option><option value="draw">Unentschieden</option><option value="player2">Sieg · {right}</option></select></div>
                  }

                  return <div className="group-match-card" key={match.id}>
                    <div className="group-match-row">
                      <strong>{left}</strong>
                      <span>vs</span>
                      <strong>{right}</strong>
                      <select className="select-input select-input--compact" value={match.result ?? ''} onChange={(event) => updateGroupMatchResult(match.id, (event.target.value || null) as GroupMatchResult)}>
                        <option value="">Noch kein Ergebnis</option>
                        <option value="player1">Sieg · {left}</option>
                        <option value="draw">Unentschieden</option>
                        <option value="player2">Sieg · {right}</option>
                      </select>
                    </div>
                    <div className="group-match-kda">
                      {[match.player1Id, match.player2Id].map((participantId) => {
                        const participantStats = normalizeParticipantStats(match.stats?.[participantId], state.groupRoundCount)
                        const matchKdaPoints = participantStats.rounds.reduce((sum, round) => sum + calculateRoundScore(round, scoringWeights), 0)
                        return <div className="group-match-kda__team" key={participantId}>
                          <div className="group-match-kda__title">
                            <strong>{participantMap.get(participantId)?.name ?? 'Unbekannt'}</strong>
                            <span className={matchKdaPoints < 0 ? 'points points--negative' : 'points'}>{formatPoints(matchKdaPoints)} KDA-Pkt.</span>
                          </div>
                          <div className="group-match-kda__rounds">
                            {participantStats.rounds.map((round, roundIndex) => <div className="group-match-kda__round" key={`${participantId}-${roundIndex}`}>
                              {state.groupRoundCount > 1 && <span className="group-match-kda__round-label">Runde {roundIndex + 1}</span>}
                              <label>K<StatInput value={round.kills} onChange={(value) => updateGroupMatchStat(match.id, participantId, roundIndex, 'kills', value)} /></label>
                              <label>A<StatInput value={round.assists} onChange={(value) => updateGroupMatchStat(match.id, participantId, roundIndex, 'assists', value)} /></label>
                              <label>D<StatInput value={round.deaths} onChange={(value) => updateGroupMatchStat(match.id, participantId, roundIndex, 'deaths', value)} /></label>
                              <span className={calculateRoundScore(round, scoringWeights) < 0 ? 'group-match-kda__points points--negative' : 'group-match-kda__points'}>{formatPoints(calculateRoundScore(round, scoringWeights))} Pkt.</span>
                            </div>)}
                          </div>
                        </div>
                      })}
                    </div>
                  </div>"""
    app = replace_once(
        app,
        old_match_return,
        new_match_return,
        "Match-KDA-Eingabe unter Begegnungen",
    )

    old_team_stats_block = """                <h3>{state.groupRoundCount} KDA-Runde{state.groupRoundCount === 1 ? '' : 'n'} · {competition.teamSize === 1 ? 'pro Spieler' : 'als Team-KDA'}</h3>
                <div className="stats-wrap"><table className="stats-table" style={{ minWidth: `${Math.max(780, 180 + state.groupRoundCount * 190)}px` }}>
                  <thead><tr><th>{competition.teamSize === 1 ? 'Spieler' : 'Team'}</th>{Array.from({ length: state.groupRoundCount }, (_, index) => index + 1).flatMap((round) => [<th key={`${round}k`}>{state.groupRoundCount === 1 ? 'K' : `S${round} K`}</th>, <th key={`${round}a`}>A</th>, <th key={`${round}d`}>D</th>, <th key={`${round}p`}>Pkt.</th>])}<th>KDA gesamt</th></tr></thead>
                  <tbody>{group.participantIds.map((participantId) => {
                    const participantStats = normalizeParticipantStats(state.stats[participantId], state.groupRoundCount)
                    const total = participantStats.rounds.reduce((sum, round) => sum + calculateRoundScore(round, scoringWeights), 0)
                    return <tr key={participantId}><th className="player-cell">{participantMap.get(participantId)?.name ?? 'Unbekannt'}</th>{participantStats.rounds.flatMap((round, roundIndex) => [<td key={`${roundIndex}k`}><StatInput value={round.kills} onChange={(value) => updateStat(participantId, roundIndex, 'kills', value)} /></td>,<td key={`${roundIndex}a`}><StatInput value={round.assists} onChange={(value) => updateStat(participantId, roundIndex, 'assists', value)} /></td>,<td key={`${roundIndex}d`}><StatInput value={round.deaths} onChange={(value) => updateStat(participantId, roundIndex, 'deaths', value)} /></td>,<td className={calculateRoundScore(round, scoringWeights) < 0 ? 'points points--negative' : 'points'} key={`${roundIndex}p`}>{formatPoints(calculateRoundScore(round, scoringWeights))}</td>])}<td className={total < 0 ? 'total total--negative' : 'total'}>{formatPoints(total)}</td></tr>
                  })}</tbody>
                </table></div>
                <div className="standings-list">{standings.map((row, index) => <div className={`standing ${index < qualified ? 'standing--qualified' : ''}`} key={row.participantId}><span className="standing__rank">{index + 1}</span><strong>{row.name}</strong>{usesResults && <span className="standing__record">{row.wins} S · {row.draws} U · {row.losses} N · {formatPoints(row.matchPoints)} Tab.-Pkt.</span>}<span className="standing__kda">KDA {formatPoints(row.totalPoints)} · {row.kills} K · {row.assists} A · {row.deaths} D</span>{index < qualified && <span className="qualified-tag">Q</span>}</div>)}</div>"""
    new_team_stats_block = """                {competition.teamSize === 1 ? <>
                  <h3>{state.groupRoundCount} KDA-Runde{state.groupRoundCount === 1 ? '' : 'n'} · pro Spieler</h3>
                  <div className="stats-wrap"><table className="stats-table" style={{ minWidth: `${Math.max(780, 180 + state.groupRoundCount * 190)}px` }}>
                    <thead><tr><th>Spieler</th>{Array.from({ length: state.groupRoundCount }, (_, index) => index + 1).flatMap((round) => [<th key={`${round}k`}>{state.groupRoundCount === 1 ? 'K' : `S${round} K`}</th>, <th key={`${round}a`}>A</th>, <th key={`${round}d`}>D</th>, <th key={`${round}p`}>Pkt.</th>])}<th>KDA gesamt</th></tr></thead>
                    <tbody>{group.participantIds.map((participantId) => {
                      const participantStats = normalizeParticipantStats(state.stats[participantId], state.groupRoundCount)
                      const total = participantStats.rounds.reduce((sum, round) => sum + calculateRoundScore(round, scoringWeights), 0)
                      return <tr key={participantId}><th className="player-cell">{participantMap.get(participantId)?.name ?? 'Unbekannt'}</th>{participantStats.rounds.flatMap((round, roundIndex) => [<td key={`${roundIndex}k`}><StatInput value={round.kills} onChange={(value) => updateStat(participantId, roundIndex, 'kills', value)} /></td>,<td key={`${roundIndex}a`}><StatInput value={round.assists} onChange={(value) => updateStat(participantId, roundIndex, 'assists', value)} /></td>,<td key={`${roundIndex}d`}><StatInput value={round.deaths} onChange={(value) => updateStat(participantId, roundIndex, 'deaths', value)} /></td>,<td className={calculateRoundScore(round, scoringWeights) < 0 ? 'points points--negative' : 'points'} key={`${roundIndex}p`}>{formatPoints(calculateRoundScore(round, scoringWeights))}</td>])}<td className={total < 0 ? 'total total--negative' : 'total'}>{formatPoints(total)}</td></tr>
                    })}</tbody>
                  </table></div>
                  <div className="standings-list">{standings.map((row, index) => <div className={`standing ${index < qualified ? 'standing--qualified' : ''}`} key={row.participantId}><span className="standing__rank">{index + 1}</span><strong>{row.name}</strong>{usesResults && <span className="standing__record">{row.wins} S · {row.draws} U · {row.losses} N · {formatPoints(row.matchPoints)} Tab.-Pkt.</span>}<span className="standing__kda">KDA {formatPoints(row.totalPoints)} · {row.kills} K · {row.assists} A · {row.deaths} D</span>{index < qualified && <span className="qualified-tag">Q</span>}</div>)}</div>
                </> : <>
                  <h3>Gruppentabelle · aufsummierte Match-KDA</h3>
                  <div className="stats-wrap">
                    <table className="stats-table team-group-summary">
                      <thead><tr><th>#</th><th>Team</th><th>Siege</th><th>Unentschieden</th><th>Niederlagen</th><th>Kills</th><th>Deaths</th><th>Assists</th><th>Punkte (S/U/N)</th><th>Punkte (KDA)</th></tr></thead>
                      <tbody>{standings.map((row, index) => <tr key={row.participantId}>
                        <td>{index + 1}</td>
                        <th className="player-cell">{row.name}</th>
                        <td>{row.wins}</td>
                        <td>{row.draws}</td>
                        <td>{row.losses}</td>
                        <td>{row.kills}</td>
                        <td>{row.deaths}</td>
                        <td>{row.assists}</td>
                        <td className="points">{formatPoints(row.matchPoints)}</td>
                        <td className={row.totalPoints < 0 ? 'points points--negative' : 'points'}>{formatPoints(row.totalPoints)}</td>
                      </tr>)}</tbody>
                    </table>
                  </div>
                </>}"""
    app = replace_once(
        app,
        old_team_stats_block,
        new_team_stats_block,
        "aufsummierte Team-Gruppentabelle",
    )

    old_group_settings = """                  <p className="muted">Lege fest, aus wie vielen KDA-Runden die Gruppenphase besteht. Erlaubt sind 1 bis 7 Runden.</p>"""
    new_group_settings = """                  <p className="muted">{competition.teamSize === 1 ? 'Lege fest, aus wie vielen KDA-Runden die Gruppenphase besteht. Erlaubt sind 1 bis 7 Runden.' : 'Lege fest, wie viele KDA-Runden pro Begegnung für beide Teams erfasst werden. Die Gruppentabelle summiert alle Begegnungen automatisch auf. Erlaubt sind 1 bis 7 Runden.'}</p>"""
    app = replace_once(
        app,
        old_group_settings,
        new_group_settings,
        "Beschreibung KDA-Runden",
    )

    css = r"""
.group-match-card{display:grid;gap:12px;padding:12px;border:1px solid rgba(145,71,255,.18);border-radius:14px;background:rgba(12,8,20,.34)}
.group-match-card .group-match-row{padding:0;border:0;background:transparent}
.group-match-kda{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.group-match-kda__team{padding:11px;border:1px solid rgba(255,255,255,.07);border-radius:11px;background:rgba(255,255,255,.025)}
.group-match-kda__title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}
.group-match-kda__title>strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.group-match-kda__rounds{display:grid;gap:7px}
.group-match-kda__round{display:grid;grid-template-columns:auto repeat(3,minmax(62px,1fr)) auto;align-items:end;gap:7px}
.group-match-kda__round-label{align-self:center;color:var(--muted);font-size:.7rem;white-space:nowrap}
.group-match-kda__round label{display:grid;gap:3px;color:var(--muted);font-size:.68rem;font-weight:700}
.group-match-kda__round .stat-input{width:100%}
.group-match-kda__points{align-self:center;min-width:65px;text-align:right;font-size:.72rem;font-weight:800;color:#e9dcff}
.team-group-summary{min-width:1050px}
.team-group-summary td,.team-group-summary th{text-align:center}
.team-group-summary .player-cell{text-align:left;min-width:180px}
@media(max-width:900px){
  .group-match-kda{grid-template-columns:1fr}
}
@media(max-width:620px){
  .group-match-kda__round{grid-template-columns:repeat(3,minmax(58px,1fr))}
  .group-match-kda__round-label,.group-match-kda__points{grid-column:1/-1;text-align:left}
}
"""
    if ".group-match-card{" not in styles:
        styles = styles.rstrip() + "\n" + css.strip() + "\n"

    TYPES.write_text(types, encoding="utf-8")
    TOURNAMENT.write_text(tournament, encoding="utf-8")
    APP.write_text(app, encoding="utf-8")
    STYLES.write_text(styles, encoding="utf-8")
    print("Match-KDA für Teambegegnungen und aufsummierte Gruppentabelle eingebaut.")

if __name__ == "__main__":
    main()
