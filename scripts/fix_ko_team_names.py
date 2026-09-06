
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src" / "App.tsx"

def main():
    s = APP.read_text(encoding="utf-8")

    old = """  const playerIds = [match.player1Id, match.player2Id]
  return <div className="match-card">
    <span className="match-number">MATCH {matchIndex + 1}</span>
    <label className="ko-result-control"><span>Ergebnis</span><select className="select-input select-input--compact" disabled={!match.player1Id || !match.player2Id} value={match.result ?? ''} onChange={(event) => onResult(roundIndex, matchIndex, (event.target.value || null) as GroupMatchResult)}><option value="">Noch kein Ergebnis</option><option value="player1">Sieg links</option><option value="draw">Unentschieden</option><option value="player2">Sieg rechts</option></select></label>"""

    new = """  const playerIds = [match.player1Id, match.player2Id]
  const player1Name = match.player1Id ? participantMap.get(match.player1Id)?.name ?? 'Teilnehmer/Team links' : 'Teilnehmer/Team links'
  const player2Name = match.player2Id ? participantMap.get(match.player2Id)?.name ?? 'Teilnehmer/Team rechts' : 'Teilnehmer/Team rechts'
  return <div className="match-card">
    <span className="match-number">MATCH {matchIndex + 1}</span>
    <label className="ko-result-control"><span>Ergebnis / Sieger</span><select className="select-input select-input--compact" disabled={!match.player1Id || !match.player2Id} value={match.result ?? ''} onChange={(event) => onResult(roundIndex, matchIndex, (event.target.value || null) as GroupMatchResult)}><option value="">Noch kein Ergebnis</option><option value="player1">{player1Name}</option><option value="draw">Unentschieden</option><option value="player2">{player2Name}</option></select></label>"""

    if "{player1Name}" in s and "{player2Name}" in s:
        print("Dynamische K.O.-Namen sind bereits eingebaut.")
        return

    if old not in s:
        raise RuntimeError("K.O.-Ergebnis-Auswahl konnte im aktuellen App.tsx nicht gefunden werden.")

    s = s.replace(old, new, 1)
    APP.write_text(s, encoding="utf-8")
    print("K.O.-Auswahl zeigt jetzt dynamische Teilnehmer-/Teamnamen.")

if __name__ == "__main__":
    main()
