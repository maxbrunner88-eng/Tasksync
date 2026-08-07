---
name: tasksync
description: Gleicht Aufgaben zwischen Superlist, der Notion-Datenbank "Master Tasks" und den Aufgaben-DBs auf den Notion-Kundenseiten ab. Was in einem System abgehakt wird, wird ueberall abgehakt; was neu angelegt wird, wird uebertragen. Nutze dieses Skill, wenn der Nutzer den taeglichen Aufgabenabgleich anstoesst, /tasksync aufruft, nach dem Sync-Stand fragt, oder wenn ein /loop diesen Abgleich faehrt. Argumente: --dry (nur Report, schreibt nichts), --init (einmaliges Anlegen der Sync-Key-Spalten), --force (Schreib-Deckel ignorieren, nur nach ausdruecklicher Ansage).
---

# TaskSync

Dieses Skill ist der Sync-Motor. Superlist ist ausschliesslich ueber MCP erreichbar, es gibt also kein Programm, das man startet — **du** fuehrst den Algorithmus aus. Halte dich exakt daran. Beim Schreiben in Live-Daten gibt es keinen Ermessensspielraum.

Alle IDs, Property-Namen und Regeln stehen in `config/sync.config.json`. Lies die Datei zuerst. Erfinde niemals eine ID.

## Betriebsarten

| Aufruf | Verhalten |
|---|---|
| `/tasksync` | Voller Lauf: lesen, abgleichen, schreiben, Report, committen |
| `/tasksync --dry` | Liest und rechnet alles, **schreibt nichts** in Superlist/Notion. Report wird geschrieben. |
| `/tasksync --init` | Einmalig: legt die `Sync Key`-Spalten in Notion an. Danach nie wieder noetig. |
| `/tasksync --force` | Hebt den Schreib-Deckel auf. Nur wenn der Nutzer das ausdruecklich sagt. |

**Wenn `state/links.json` fehlt, leer ist oder sich nicht als JSON parsen laesst:** Schreibmodus verweigern. Stattdessen den Erstlauf (Abschnitt „Erstlauf") fahren und das dem Nutzer sagen. Niemals „dann ist eben alles neu" annehmen — das wuerde in jedem Store Dutzende Duplikate anlegen.

## Schritt 0 — Vorbereitung (nur bei `--init`)

Ergaenze in beiden Notion-Datenquellen eine Textspalte `Sync Key`:

```
notion-update-data-source
  data_source_id: <notion.masterTasks.dataSource>
  statements: ADD COLUMN "Sync Key" RICH_TEXT
```

und dasselbe fuer jede `customers.*.tasksDataSource`, bei der `skip` nicht `true` ist. Existiert die Spalte schon, ist der Fehler unkritisch — weitermachen.

Superlist kann keine Fremdschluessel tragen. Die Superlist-Seite jeder Verknuepfung lebt **nur** in `state/links.json`. Dieses File ist tragende Infrastruktur und muss nach jedem Lauf committet werden.

## Schritt 1 — Lesen

Lies alle drei Stores vollstaendig, bevor du irgendetwas schreibst.

**Superlist** — je Liste aus `superlist.lists`:
```
mcp__Superlist__get_list  list_uuid: <uuid>
```
Nutze das `tasks`-Array (nicht `contents_markdown`) als Datenquelle: es traegt `uuid`, `title`, `status`, `due_date`, `priority`, `labels`, `updated_at`, `completed_at`, `repetition`. Ist `tasks_truncated: true`, ergaenze ueber `mcp__Superlist__search`.

**Notion Master Tasks:**
```
mcp__Notion__notion-query-data-sources
  mode: sql
  data_source_urls: ["collection://e3113d00-0bde-4cee-8077-bde717b20c85"]
  query: SELECT url, "Title", "Status", "Area", "Priority", "Sync Key",
                "date:Due Date:start", "Last Edited", "date:Completed At:start"
         FROM "collection://e3113d00-0bde-4cee-8077-bde717b20c85"
```

**Je Kunde** (wo `skip` nicht `true`), analog mit den Property-Namen aus `customers.<k>.props`, inkl. `Aufgabe`, `Erledigt`, `Owner`, `Bereich`, `Zuletzt bewegt`, `Sync Key`.

Bei `has_more: true` weiterblaettern, bis alles gelesen ist. **Ein unvollstaendiger Lesevorgang darf nie in den Schreibteil laufen** — eine fehlende Zeile sieht sonst aus wie eine geloeschte Aufgabe.

## Schritt 2 — Erledigt-Signal je Store

Genau diese Regeln, keine anderen:

| Store | erledigt, wenn |
|---|---|
| Superlist | `status == "completed"` |
| Master Tasks | `Status` ∈ `{Done, Cancelled}` |
| Kunden-DB | `Erledigt == "__YES__"` |

Das `Status`-Feld der Kunden-DB (Offen / In Arbeit / Blockiert / Wartet auf Antwort) ist **orthogonal zu erledigt** und wird vom Sync **nie geschrieben**. In der M&M-DB stehen zahlreiche Zeilen auf `Erledigt=YES` bei `Status=Offen`; das ist gewollt. Die Property-Beschreibung von `Erledigt` sagt ausdruecklich: *„Einzige Wahrheit fuer erledigt/nicht erledigt."*

`Cancelled` in Master Tasks zaehlt als erledigt, wird gespiegelt und im Report unter „Abgebrochen" gesondert aufgefuehrt.

## Schritt 3 — Titel normalisieren

Nur fuers Matching. Der normalisierte Titel wird **niemals** irgendwohin geschrieben.

1. Kleinschreibung
2. Umlaute falten: ä→ae, ö→oe, ü→ue, ß→ss
3. Praefixe aus `matching.stripPrefixes` am Anfang entfernen (wiederholt, bis keiner mehr passt)
4. Bei `stripTrailingParens`: abschliessende Klammerausdruecke entfernen — `(laeuft in Session)`, `(Session 1)`, `(Zielzustand)`, `(halbe Seite)`
5. Satzzeichen entfernen, Whitespace auf ein Leerzeichen kollabieren, trimmen

Beispiel: `M&M: Datenklassen-Doku (halbe Seite) schreiben` → `datenklassen doku schreiben`; `Datenklassen-Doku (halbe Seite)` → `datenklassen doku`. Diese beiden matchen nicht exakt, aber ueber Jaccard.

## Schritt 4 — Zuordnen

Fuer jeden gelesenen Datensatz den zugehoerigen Link finden:

- Notion-Zeile mit gesetztem `Sync Key` → Link mit diesem `key`.
- Superlist-Task → Link, dessen `superlist.uuid` passt.
- Kein Treffer → **Neuzugang** (Schritt 6).

Ein Link, der in der Registry steht, dessen Datensatz aber in einem Store fehlt: **nicht** als Loeschung interpretieren. Unter „Verwaist" in den Report, `lastSeen` unveraendert lassen, sonst nichts tun. Ein Loch kann auch Pagination, ein API-Fehler oder eine manuelle Verschiebung sein.

## Schritt 5 — Soll-Zustand je Link

**Erledigt** (`policy.conflictRule == "doneWins"`):
```
done = done_superlist ODER done_master ODER done_kunde
```
Ist `done == true` und ein Store steht noch auf offen → dort abhaken.
Ist `done == false`, aber der Link stand zuletzt auf `"done"` → **nichts tun** (`policy.neverReopen`). In den Report unter „Wiedereroeffnung ignoriert".

Bei `conflictRule == "newestWins"`: der juengste Zeitstempel gewinnt (`updated_at` / `Last Edited` / `Zuletzt bewegt`). `neverReopen` gilt trotzdem weiter.

**Faelligkeit:** frueheste gesetzte Faelligkeit gewinnt. Haben sich seit `lastSeen` zwei Seiten unterschiedlich geaendert → nicht schreiben, unter „Konflikt Faelligkeit" melden.

**Titel:** nur nachziehen, wenn sich seit `lastSeen` **genau eine** Seite geaendert hat. Sonst melden, nicht schreiben. Beim Schreiben in eine Kunden-DB den `writePrefix` entfernen, beim Schreiben nach Superlist ihn setzen.

**Prioritaet:** ueber `priorityMap` uebersetzen; bei Konflikt die hoehere gewinnt.

## Schritt 6 — Neuzugaenge routen

| Neu in | Anlegen in |
|---|---|
| Superlist-Liste `L` | Master Tasks mit `Area = L`. Traegt der Titel ein Kundenpraefix aus `customers.*.titlePrefixes` und der Kunde hat eine Aufgaben-DB → zusaetzlich dort mit `Owner = Max`. |
| Master Tasks, `Area = L` | Superlist-Liste `L` |
| Kunden-DB, `Owner` ∈ `policy.customerOwnerScope` | Superlist (Liste laut `customers.<k>.superlistList`, Titel mit `writePrefix`) **und** Master Tasks mit passender `Area` |
| Kunden-DB, `Owner` ausserhalb des Scope | **nichts anlegen.** Nur unter „Beim Kunden offen" in den Report. |

Bereits erledigte Neuzugaenge werden **nicht** in andere Stores kopiert — nur registriert. Sonst regnet es abgehakte Altlasten.

Fuer jeden Neuzugang einen `key` vergeben (`tsk_` + 8 Hexzeichen, kollisionsfrei gegen die Registry) und ihn in den Notion-Zeilen als `Sync Key` setzen.

## Schritt 7 — Schreiben

**Vor dem ersten Schreibvorgang** die Gesamtzahl geplanter Schreibvorgaenge zaehlen. Ist sie groesser als `policy.maxWritesPerRun` und `--force` wurde nicht gesetzt: **abbrechen**, nichts schreiben, Report mit der vollstaendigen Liste erzeugen und den Nutzer fragen. Das ist die Sicherung gegen einen Registry-Verlust.

Bei `--dry`: hier aufhoeren und zu Schritt 8 gehen.

**Superlist abhaken:**
```
mcp__Superlist__complete_task  task_uuid: <uuid>
```
Hat der Task `repetition != null`, schiebt `complete_task` ihn auf den naechsten Termin statt ihn abzuhaken. Solche Tasks **ueberspringen** und im Report melden.

**Superlist anlegen:** immer `mcp__Superlist__add_task` mit `list_uuid`, `title`, optional `due_date`.

> **`update_list` ist eine Falle.** Der `content`-Parameter ersetzt den Listenkoerper vollstaendig und **loest jede Aufgabe ab, die im neuen Text fehlt**. Verwende es nur, wenn du vorher `get_list` gelesen hast und das komplette `contents_markdown` inklusive **aller** `superlist:task/<uuid>`-Referenzen unveraendert mitschickst. Im Zweifel: `add_task` in der Schleife. Ein bequemer Bulk-Insert ist es nicht wert, eine Liste zu zerlegen.

**Master Tasks schreiben:**
```
mcp__Notion__notion-update-page
  page_id: <id>
  command: update_properties
  properties: { "Status": "Done", "date:Completed At:start": "<YYYY-MM-DD>", "Sync Key": "<key>" }
```
Anlegen ueber `notion-create-pages` mit `parent: { type: "data_source_id", data_source_id: "e3113d00-0bde-4cee-8077-bde717b20c85" }`.

**Kunden-DB schreiben:** `Erledigt` auf `"__YES__"` setzen. `Status` **nicht** anfassen.

Checkbox-Werte in Notion sind immer `"__YES__"` / `"__NO__"`, Datumsfelder immer als `date:<Property>:start`.

## Schritt 8 — Nachhalten

1. `state/links.json` aktualisieren: neue Links, geaenderte `state`, frische `lastSeen`-Zeitstempel. Bei `--dry` **nicht** schreiben.
2. `reports/<YYYY-MM-DD>-<HHMM>.md` schreiben mit diesen Abschnitten — leere Abschnitte weglassen:
   - Zusammenfassung (gelesen je Store, verlinkt, geschrieben)
   - Abgehakt (welche Aufgabe, wo ausgeloest, wohin gespiegelt)
   - Neu angelegt
   - Beim Kunden offen (Owner ausserhalb des Scope)
   - Konflikte (Titel, Faelligkeit, Wiedereroeffnung ignoriert)
   - Verwaist
   - Uebersprungen (wiederkehrende Tasks u. a.)
3. Committen und pushen — `state/links.json` und den Report. Ohne Commit ist die Registry beim naechsten Container weg.
4. Dem Nutzer **kurz** antworten: Zahlen plus alles, was seine Entscheidung braucht. Nicht den ganzen Report ausgeben.

## Erstlauf

Wenn `state/links.json` keine Links enthaelt: **nichts schreiben**, unabhaengig von `--dry`.

1. Alle drei Stores lesen, Titel normalisieren.
2. Paare bilden: exakter Normtitel-Treffer → sicher. Jaccard-Tokenueberlappung ≥ `matching.jaccardThreshold` → Vorschlag.
3. `reports/000-erstabgleich.md` schreiben mit vier Bloecken:
   - **Sichere Links** — werden ohne Rueckfrage uebernommen
   - **Vorschlaege** — unsicheres Fuzzy-Matching, der Nutzer bestaetigt einzeln
   - **Status-Konflikte** — wo die Stores sich beim Erledigt-Signal widersprechen, mit der jeweils vorgeschlagenen Aufloesung
   - **Alt-Triage** — die in Master Tasks noch offenen Aufgaben mit `Last Edited` vor dem 08.06.2026. Das sind Karteileichen aus der Zeit vor dem Umstieg auf Superlist; sie werden **nicht** automatisch nach Superlist gespiegelt. Pro Zeile die Frage: noch relevant?
4. Auf die Freigabe des Nutzers warten, dann `state/links.json` schreiben und die bestaetigten Konflikte aufloesen.

## Unantastbar

- **Niemals loeschen.** Weder `delete_task` noch `delete_list` noch Notion-Seiten in den Papierkorb. Der Sync legt an, hakt ab und aktualisiert Felder — mehr nicht.
- **Niemals eine erledigte Aufgabe automatisch wieder oeffnen.**
- **Niemals mit unvollstaendig gelesenen Daten schreiben.**
- **Niemals den Schreib-Deckel ohne ausdrueckliche Ansage des Nutzers ueberschreiten.**
- **Niemals `Status` in einer Kunden-DB schreiben.**
- **Niemals eine UUID oder Data-Source-ID raten** — alles steht in der Config.
