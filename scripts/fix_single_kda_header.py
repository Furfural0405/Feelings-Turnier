
from pathlib import Path

app_path = Path(__file__).resolve().parents[1] / "src" / "App.tsx"
text = app_path.read_text(encoding="utf-8")

old = "<th key={`${round}k`}>S{round} K</th>"
new = "<th key={`${round}k`}>{state.groupRoundCount === 1 ? 'K' : `S${round} K`}</th>"

if new in text:
    print("KDA-Einzelrunden-Header ist bereits angepasst.")
elif old in text:
    app_path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("Bei einer KDA-Runde wird jetzt nur noch K angezeigt.")
else:
    raise RuntimeError("Die KDA-Tabellenüberschrift konnte nicht gefunden werden.")
