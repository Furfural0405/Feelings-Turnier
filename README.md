# Das Feelings-Turnier

Eine browserbasierte Turnierverwaltung für Gruppenphase, KDA-Wertung und automatisch erzeugte K.-o.-Bäume.

## Funktionen

- Beliebig viele Teilnehmer hinzufügen oder als Liste einfügen
- Teilnehmer zufällig auf **1 bis 10 Gruppen** verteilen
- Pro Teilnehmer **3 Spiele der Gruppenphase** erfassen
- KDA-Punktesystem automatisch berechnen
- Rangliste mit Tie-Breakern erzeugen
- Automatisch passende K.-o.-Phase pro Gruppe erstellen
- Sieger manuell auswählen und automatisch in die nächste Runde übernehmen
- Turnierstand im Browser (`localStorage`) speichern
- Turnierstand als JSON exportieren und wieder importieren
- Responsive Oberfläche für Desktop, Tablet und Smartphone
- Automatisches Deployment über GitHub Pages

## Punktesystem

Pro Spiel/Runde gilt:

```text
Grundpunkte = Kills + Assists - (Deaths × 1,5)
```

Zusätzlich:

- `Kills + Assists > Deaths` → **+3 Punkte**
- `Kills + Assists < Deaths` → **-3 Punkte**
- `Kills + Assists = Deaths` → **0 Zusatzpunkte**

Die Gesamtpunktzahl ist die Summe der drei Gruppenphasen-Spiele.

### Tie-Breaker

Bei gleicher Gesamtpunktzahl wird sortiert nach:

1. mehr `Kills + Assists`
2. weniger Deaths
3. Name alphabetisch

## Qualifikation und K.-o.-Phase

Die K.-o.-Phase wird pro Gruppe aus der Rangliste erstellt. Es qualifiziert sich die größte Zweierpotenz, die nicht größer als die Gruppengröße ist.

Beispiele:

| Gruppengröße | Qualifiziert | Erste K.-o.-Runde |
| ---: | ---: | --- |
| 1 | 1 | automatisch Gruppensieger |
| 2–3 | 2 | Finale |
| 4–7 | 4 | Halbfinale |
| 8–15 | 8 | Viertelfinale |
| 16–31 | 16 | Achtelfinale |

Die Setzliste folgt der Gruppenrangliste. Hohe Seeds treffen in der ersten Runde auf niedrige Seeds.

## Lokal starten

Voraussetzungen: Node.js 22+ und npm.

```bash
npm install
npm run dev
```

Danach die von Vite angezeigte lokale URL im Browser öffnen.

## Produktions-Build testen

```bash
npm run build
npm run preview
```

## Auf GitHub Pages veröffentlichen

1. Neues GitHub-Repository erstellen, z. B. `das-feelings-turnier`.
2. Alle Dateien aus diesem Projekt in das Repository hochladen.
3. Sicherstellen, dass der Standard-Branch `main` heißt.
4. Unter **Settings → Pages → Build and deployment → Source** die Option **GitHub Actions** auswählen.
5. Einen Commit auf `main` pushen.
6. Der Workflow `.github/workflows/deploy.yml` baut und veröffentlicht die Seite automatisch.

Die Vite-Konfiguration verwendet `base: './'`, deshalb funktioniert der Build auch in einem GitHub-Pages-Projektpfad.

## Projektstruktur

```text
.
├── .github/
│   └── workflows/
│       └── deploy.yml
├── public/
│   └── favicon.svg
├── src/
│   ├── lib/
│   │   ├── scoring.ts
│   │   └── tournament.ts
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   └── types.ts
├── .gitignore
├── index.html
├── package.json
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

## Datenspeicherung

Die App benötigt kein Backend. Der aktuelle Turnierstand liegt ausschließlich im `localStorage` des Browsers. Für Backups oder einen Gerätewechsel kann der Zustand über **Turnier exportieren** als JSON gespeichert und über **Turnier importieren** wieder eingelesen werden.
