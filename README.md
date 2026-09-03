# Das Feelings-Turnier · Brume Edition

Browserbasierte Turnierverwaltung mit Gruppenphase, KDA-Wertung und einer gemeinsamen Fußball-artigen K.-o.-Phase. Das Interface nutzt eine weiche Pastell-/Blush-Ästhetik mit Hearts, Sparkles und Community-Vibes.

## Funktionen

- Teilnehmer einzeln oder als Liste hinzufügen
- Wunschwert von **1 bis 10 Gruppen** auswählen
- Gruppenzahl bei Bedarf automatisch auf eine K.-o.-kompatible Zahl anpassen
- Pro Teilnehmer **3 Spiele der Gruppenphase** erfassen
- KDA-Punktesystem automatisch berechnen
- Rangliste mit Tie-Breakern erzeugen
- Gemeinsame K.-o.-Phase nach der Gruppenphase
- K.-o.-Feld mit **2, 4, 8, 16 oder maximal 32 Spielern**
- Mindestens **Top 2 pro Gruppe**, aber niemals mehr als **50 % der Gruppe**
- Gruppensieger werden gegen niedriger gesetzte Spieler aus **anderen Gruppen** gesetzt
- Bei Top 2 gilt exakt: **1. einer Gruppe gegen 2. einer anderen Gruppe**
- Sieger auswählen und automatisch in die nächste Runde übernehmen
- Turnierstand lokal im Browser speichern
- JSON-Export und -Import
- Responsive Darstellung für Desktop und Smartphone
- GitHub-Pages-Deployment per Actions

## Punktesystem

Pro Spiel gilt:

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

## Automatische Gruppen- und K.-o.-Planung

Die App sucht eine Kombination, die alle Regeln gleichzeitig erfüllt:

1. mindestens zwei Qualifizierte pro Gruppe,
2. höchstens 50 % einer Gruppe qualifizieren sich,
3. alle Gruppen schicken gleich viele Spieler weiter,
4. das gesamte K.-o.-Feld ist eine Zweierpotenz,
5. maximal 32 Spieler kommen in die K.-o.-Phase.

Kann die ausgewählte Gruppenzahl diese Bedingungen nicht erfüllen, reduziert die App die Gruppenzahl automatisch.

### Beispiel: 50 Teilnehmer, Wunsch 10 Gruppen

10 Gruppen würden bei mindestens zwei Qualifizierten 20 K.-o.-Teilnehmer ergeben. 20 ist kein reguläres K.-o.-Feld.

Die App plant deshalb automatisch:

```text
50 Teilnehmer
→ 8 Gruppen
→ Top 2 pro Gruppe
→ 16 Qualifizierte
→ Achtelfinale
```

Im Achtelfinale wird ein Gruppenerster gegen einen Gruppenzweiten einer anderen Gruppe gesetzt.

### Größeres Beispiel

Bei 64 Teilnehmern und 8 Gruppen sind 8 Spieler je Gruppe vorhanden. Maximal 50 % dürfen weiterkommen, daher können Top 4 je Gruppe qualifiziert werden:

```text
64 Teilnehmer
→ 8 Gruppen
→ Top 4 pro Gruppe
→ 32 Qualifizierte
→ Sechzehntelfinale
```

Die oberen Platzierungen werden dann gegen niedrigere Platzierungen anderer Gruppen gesetzt, z. B. Rang 1 gegen Rang 4 und Rang 2 gegen Rang 3.

## Lokal starten

Voraussetzungen: Node.js 22+ und npm.

```bash
npm install
npm run dev
```

## Produktions-Build testen

```bash
npm run build
npm run preview
```

## Auf GitHub Pages veröffentlichen

1. Dateien in das Repository hochladen.
2. Standard-Branch `main` verwenden.
3. Unter **Settings → Pages → Build and deployment → Source** `GitHub Actions` auswählen.
4. `.github/workflows/static.yml` in das Repository übernehmen.
5. Auf `main` committen/pushen.

Der Workflow installiert die npm-Abhängigkeiten, baut die Vite-App und veröffentlicht ausschließlich den erzeugten `dist`-Ordner.

## Geänderte Kern-Dateien

```text
.github/workflows/static.yml
public/favicon.svg
src/App.tsx
src/styles.css
src/types.ts
src/lib/tournament.ts
README.md
index.html
```

## Datenspeicherung

Die App benötigt kein Backend. Der Turnierstand liegt im `localStorage` des Browsers. Für Backups oder Gerätewechsel kann der Zustand als JSON exportiert und später wieder importiert werden.
