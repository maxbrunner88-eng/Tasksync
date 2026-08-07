# CLAUDE.md

Dieses Repo enthält **TaskSync** — den täglichen Abgleich zwischen Superlist, der Notion-DB „Master Tasks" und den Aufgaben-DBs auf den Notion-Kundenseiten.

## Was hier kein Code ist

Es gibt kein ausführbares Programm. Superlist ist nur über MCP-Tools erreichbar, also ist **Claude selbst** die Laufzeit. Der Algorithmus steht in `.claude/skills/tasksync/SKILL.md` und wird über `/tasksync` ausgeführt. Wer hier „den Sync fixen" will, ändert das Skill oder `config/sync.config.json` — nicht Quellcode.

## Wenn du an diesem Repo arbeitest

- **`config/sync.config.json` ist die einzige Quelle für IDs.** Niemals eine Superlist-UUID, Notion-Page-ID oder `collection://`-URL in Prosa oder ins Skill hartkodieren. Steht eine ID nicht in der Config, gehört sie dorthin.
- **`state/links.json` ist tragende Infrastruktur, kein Cache.** Superlist-Tasks können keine Fremdschlüssel aufnehmen; die Superlist-Seite jeder Verknüpfung existiert nur in dieser Datei. Sie muss nach jedem Lauf committet werden. Nie „zum Aufräumen" leeren — das erzwingt einen kompletten Erstlauf.
- **Reports sind Historie.** `reports/` wird angehängt, nicht überschrieben.

## Beim Ändern des Skills

Die Schutzschranken in `SKILL.md` (Abschnitt „Unantastbar") sind kein Beiwerk — sie stehen dort, weil der Sync in drei Live-Systeme schreibt, von denen eines mit einer Kundin geteilt wird. Wer eine davon lockert, sollte den Grund im Commit nennen:

- keine Löschungen
- kein automatisches Wiederöffnen erledigter Aufgaben
- kein Schreiben mit unvollständig gelesenen Daten
- kein Überschreiten des Schreib-Deckels ohne Ansage des Nutzers
- kein Schreiben von `Status` in einer Kunden-DB

## Zwei Fallen, die schon Daten gekostet hätten

1. **`mcp__Superlist__update_list`** ersetzt den Listenkörper vollständig und **löst jede Aufgabe ab, die im neuen `content` fehlt**. Für Bulk-Inserts nur nach vorherigem `get_list` und mit vollständig durchgereichtem `contents_markdown` inklusive aller `superlist:task/<uuid>`-Referenzen. Im Zweifel `add_task` in der Schleife.
2. **`mcp__Superlist__complete_task`** hakt einen wiederkehrenden Task nicht ab, sondern schiebt ihn auf den nächsten Termin. Solche Tasks überspringen.

## Notion-Eigenheiten

- Checkboxen sind `"__YES__"` / `"__NO__"`, keine Booleans.
- Datumsfelder werden als `date:<Property>:start` geschrieben, nicht als `<Property>`.
- In `✅ M&M Aufgaben Max & Nadine` ist **`Erledigt` die einzige Wahrheit** für erledigt/nicht erledigt (steht so in der Property-Beschreibung). `Status` ist orthogonal — viele Zeilen stehen auf `Erledigt=YES` bei `Status=Offen`. Das ist kein Fehler und wird nicht „korrigiert".

## Sprache

Nutzer-sichtbarer Text (README, Reports, Antworten) auf Deutsch.
