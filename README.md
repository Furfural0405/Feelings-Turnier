# Feelings-Turnier · Brume Community Tournament

React-/TypeScript-Turnierverwaltung für die Feelings-Community.

## Turnierlogik

- Gruppenphase mit drei KDA-Games pro Spieler
- danach genau **eine gemeinsame K.-o.-Phase**
- bei mehreren Gruppen wird die erste K.-o.-Runde gruppenübergreifend gesetzt
- Gruppenerste treffen auf niedriger gesetzte Spieler aus anderen Gruppen
- bei Top 2 gilt: #1 einer Gruppe gegen #2 einer anderen Gruppe
- bei Top 4 gilt analog: #1 gegen #4 und #2 gegen #3 aus anderen Gruppen
- K.-o.-Feld: 4, 8, 16 oder maximal 32 Spieler

### Sonderregel bei weniger als 8 Teilnehmern

Bei insgesamt 4 bis 7 Teilnehmern werden **immer 4 Spieler** in die K.-o.-Phase übernommen. Die normale 50-%-Grenze gilt in diesem Sonderfall ausdrücklich nicht.

- 1 Gruppe: Top 4 dieser Gruppe ziehen weiter; erste Runde #1 vs #4 und #2 vs #3
- 2 oder mehr gewünschte Gruppen: die App passt automatisch auf 2 Gruppen an; Top 2 jeder Gruppe ziehen weiter
- bei 2 Gruppen wird gruppenübergreifend gesetzt: A1 vs B2 und B1 vs A2
- unter 4 Teilnehmern ist kein 4er-K.-o.-Feld möglich

### Standardregel ab 8 Teilnehmern

- mindestens Top 2 je Gruppe
- höchstens 50 % der kleinsten Gruppe
- gleiche Anzahl Qualifikanten pro Gruppe
- automatische Anpassung der Gruppenzahl, wenn die gewünschte Gruppenzahl kein sauberes K.-o.-Feld ergibt
- bei einer gewünschten Einzelgruppe wird ab 8 Teilnehmern auf eine passende Mehrgruppen-Konstellation angepasst, damit die erste K.-o.-Runde gruppenübergreifend gesetzt werden kann

## Beispiel 50 Teilnehmer / 10 gewünschte Gruppen

Die App passt automatisch an:

- 50 Teilnehmer
- 8 Gruppen
- Top 2 je Gruppe
- 16 Qualifikanten
- Start im Achtelfinale

Die erste Runde wird gruppenübergreifend gesetzt, z. B. A1 gegen B2, B1 gegen C2 usw. Spieler derselben Gruppe treffen in der ersten K.-o.-Runde nicht aufeinander.

## Punktesystem

Pro Game:

- Kill: +1
- Assist: +1
- Death: -1,5
- Kills + Assists > Deaths: +3
- Kills + Assists < Deaths: -3
- Gleichstand: kein Bonus/Malus

## Design

Das Theme ist bewusst dunkler gehalten und verbindet BrumeFeelings-typische Pink-Akzente mit Gaming-/Streaming-Elementen: dunkle Overlay-Flächen, Twitch-Purple, Live-Badge, Stream-Frame, HUD-/Crosshair-Details und dezente Chat-Optik.

## GitHub Pages

Der Workflow `.github/workflows/static.yml` installiert die npm-Abhängigkeiten, baut die Vite-App und lädt ausschließlich `dist/` auf GitHub Pages.

Unter **Settings → Pages → Build and deployment** muss als Source **GitHub Actions** gewählt sein.
