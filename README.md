# Feelings-Turnier · Brume Community Cup

React-/TypeScript-Turnierverwaltung für die Feelings-Community.

## Was diese Version ändert

- deutliches BrumeFeelings-inspiriertes Blush-/Pink-/White-Design mit schwarzer Typografie, Glass-Card und Heart/Sparkle-Motiven
- Gruppenphase bleibt die KDA-Wertung über drei Games
- **keine K.-o.-Phase mehr innerhalb einzelner Gruppen**
- nach der Gruppenphase entsteht **genau eine globale K.-o.-Phase**
- die App berechnet automatisch, wie viele Gruppen und wie viele Qualifikanten pro Gruppe ein sauberes Feld ergeben
- mindestens Top 2 je Gruppe, maximal 50 % der kleinsten Gruppe
- K.-o.-Feld: 4, 8, 16 oder maximal 32 Spieler
- erste K.-o.-Runde immer gruppenübergreifend gesetzt

## Beispiel 50 Teilnehmer / 10 gewünschte Gruppen

10 Gruppen mit jeweils ungefähr 5 Spielern würden mindestens 20 Qualifikanten erzeugen. 20 ist kein Zweierpotenz-K.-o.-Feld.

Die App passt deshalb automatisch an:

- 50 Teilnehmer
- 8 Gruppen
- Top 2 je Gruppe
- 16 Qualifikanten
- Start im Achtelfinale

Die Paarungen der ersten Runde werden gruppenübergreifend gesetzt, z. B. A1 gegen B2, B1 gegen C2 usw. Spieler derselben Gruppe treffen in der ersten K.-o.-Runde nicht aufeinander.

## Punktesystem

Pro Game:

- Kill: +1
- Assist: +1
- Death: -1,5
- Kills + Assists > Deaths: +3
- Kills + Assists < Deaths: -3
- Gleichstand: kein Bonus/Malus

## GitHub Pages

Der Workflow `.github/workflows/static.yml` installiert die npm-Abhängigkeiten, baut die Vite-App und lädt ausschließlich `dist/` auf GitHub Pages.

Unter **Settings → Pages → Build and deployment** muss als Source **GitHub Actions** gewählt sein.
