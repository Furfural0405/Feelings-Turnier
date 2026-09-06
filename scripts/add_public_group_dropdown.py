
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src" / "App.tsx"
STYLES = ROOT / "src" / "styles.css"

def main():
    app = APP.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    old = """    <div className="public-match-list">
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

    <div className="stats-wrap">"""

    new = """    <details className="public-group-matches">
      <summary>
        <span>Einzelbegegnungen anzeigen</span>
        <small>{groupMatches.length} Match{groupMatches.length === 1 ? '' : 'es'}</small>
      </summary>
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
    </details>

    <div className="stats-wrap">"""

    if "className=\"public-group-matches\"" not in app:
        if old not in app:
            raise RuntimeError("Öffentliche Einzelbegegnungen konnten nicht gefunden werden.")
        app = app.replace(old, new, 1)

    css = """
.public-group-matches{margin:12px 0 18px;border:1px solid rgba(145,71,255,.16);border-radius:12px;background:rgba(13,9,22,.35);overflow:hidden}
.public-group-matches summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;cursor:pointer;list-style:none;font-weight:700;color:#f5eaff;user-select:none}
.public-group-matches summary::-webkit-details-marker{display:none}
.public-group-matches summary::after{content:'⌄';font-size:1rem;color:#cdb3ff;transition:transform .18s ease}
.public-group-matches[open] summary::after{transform:rotate(180deg)}
.public-group-matches summary small{margin-left:auto;color:var(--muted);font-size:.72rem;font-weight:600}
.public-group-matches .public-match-list{margin:0;padding:0 12px 12px}
"""
    if ".public-group-matches{" not in styles:
        styles = styles.rstrip() + "\n" + css.strip() + "\n"

    APP.write_text(app, encoding="utf-8")
    STYLES.write_text(styles, encoding="utf-8")
    print("Öffentliche Einzelbegegnungen liegen jetzt hinter einem Dropdown.")

if __name__ == "__main__":
    main()
