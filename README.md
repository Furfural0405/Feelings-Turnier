# Admin-Funktion: Alle Teilnehmer löschen

Diese Erweiterung ergänzt im Teilnehmerbereich für freigeschaltete Admins einen roten Button **„Alle Teilnehmer löschen“**.

Beim Ausführen:
- wird vorher ausdrücklich nach einer Bestätigung gefragt,
- werden alle Einträge aus `participants` gelöscht,
- werden Gruppen, KDA-Statistiken und K.O.-Bracket geleert,
- bleiben die konfigurierte Gruppenanzahl und die Rundenzahl der Gruppenphase bestehen.

Der enthaltene GitHub-Workflow patched die aktuelle `src/App.tsx`, baut die aktuelle Webseite und deployed sie in demselben Lauf. Dadurch entsteht nicht erneut das Problem, dass ein Bot-Commit zwar im Repository liegt, aber die Live-Seite noch eine ältere Version zeigt.
