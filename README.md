# Feelings Turnier – E-Mail-Freischaltung

Diese Version erweitert das Gaming-Turnier um einen sicheren Login- und Adminbereich mit **Supabase Auth + Row Level Security**.

## Rechte

### Besucher / nicht freigeschaltete Accounts
- dürfen die öffentliche Seite und Regeln sehen,
- dürfen unter **01 Teilnehmer** einen Namen/Gamer-Tag einreichen,
- sehen **keine bereits angemeldeten Teilnehmernamen**,
- sehen keine Gruppen/Ranglisten/KDA-Daten/K.O.-Matches,
- dürfen nichts am Turnier verändern.

### Freigeschaltete Admins
- sehen alle Teilnehmer-Anmeldungen,
- verwalten Gruppen und KDA,
- erstellen die globale K.O.-Phase,
- wählen Match-Sieger,
- können neue registrierte Accounts per E-Mail freischalten,
- können Turnierstand importieren/exportieren/zurücksetzen.

Die Sperre ist nicht nur optisch: Supabase RLS verhindert serverseitig, dass nicht freigeschaltete Nutzer Teilnehmerlisten oder Turnierdaten abfragen.

---

## 1. Supabase-Projekt erstellen

1. Auf https://supabase.com ein neues Projekt erstellen.
2. Im Projekt **SQL Editor** öffnen.
3. Den kompletten Inhalt von `supabase/setup.sql` ausführen.

## 2. E-Mail-Login konfigurieren

Unter **Authentication** den E-Mail/Passwort-Login aktiviert lassen.

Empfohlen: E-Mail-Bestätigung aktivieren. Setze außerdem in den URL-/Redirect-Einstellungen deine GitHub-Pages-Adresse, z. B.:

`https://furfural0405.github.io/Feelings-Turnier/`

## 3. Supabase-Werte holen

Unter **Project Settings → API** benötigst du:

- Project URL
- Publishable Key (oder Legacy `anon` Key)

**Niemals den `service_role` Key in GitHub oder in die Webseite eintragen.**

## 4. GitHub Repository Variables setzen

Im GitHub-Repository:

**Settings → Secrets and variables → Actions → Variables**

Erstelle zwei Repository Variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Der Workflow übergibt diese Werte beim Vite-Build.

Für lokale Entwicklung kannst du `.env.example` nach `.env` kopieren und dort dieselben Werte eintragen.

## 5. Deinen ersten Admin freischalten

1. Webseite deployen.
2. Rechts oben **Admin Login → Registrieren**.
3. Deinen Account mit deiner E-Mail + Passwort registrieren.
4. Falls aktiviert: E-Mail bestätigen.
5. Danach im Supabase **SQL Editor** einmal ausführen:

```sql
update public.profiles
set approved = true, role = 'admin'
where email = 'DEINE-EMAIL@BEISPIEL.DE';
```

Danach neu einloggen. Jetzt bist du Admin.

Ab dann brauchst du den SQL Editor für Freigaben nicht mehr: Im Bereich **Zugriffsfreigaben** erscheinen registrierte Accounts und können per Button freigeschaltet werden.

---

## K.O.-Regeln

- 4–7 Teilnehmer: immer vier Spieler in der K.O.-Phase.
  - 1 Gruppe → Top 4.
  - 2 oder mehr gewünschte Gruppen → automatisch 2 Gruppen, Top 2 je Gruppe.
  - Die 50%-Grenze darf dabei überschritten werden.
- Ab 8 Teilnehmern:
  - mindestens Top 2 je Gruppe,
  - höchstens 50 % der kleinsten Gruppe,
  - gleiche Zahl Qualifikanten je Gruppe,
  - K.O.-Feld 4 / 8 / 16 / 32,
  - maximal Start im Sechzehntelfinale.
- Bei mehreren Gruppen sind die Matches der ersten K.O.-Runde gruppenübergreifend gesetzt.
- Top 2: Gruppenerster gegen Gruppenzweiten einer anderen Gruppe.

## Punktesystem

Pro Spiel:

`Kills + Assists - 1,5 × Deaths`

Zusätzlich:

- Kills + Assists > Deaths → `+3`
- Kills + Assists < Deaths → `-3`
- Gleichstand → kein Zusatzwert

---

## Dateien dieses Patches

### Ersetzen
- `package.json`
- `.github/workflows/static.yml`
- `src/App.tsx`
- `src/styles.css`
- `src/types.ts`
- `src/lib/tournament.ts`
- `index.html`
- `public/favicon.svg`

### Neu hinzufügen
- `src/lib/supabase.ts`
- `src/vite-env.d.ts`
- `.env.example`
- `supabase/setup.sql`

Bestehende Dateien wie `src/main.tsx`, `src/lib/scoring.ts`, `vite.config.ts` und die TypeScript-Konfiguration bleiben erhalten.
