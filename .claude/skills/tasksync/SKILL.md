---
name: tasksync
description: Gleicht Aufgaben zwischen Superlist, der Notion-Datenbank "Master Tasks" und den Aufgaben-DBs auf den Notion-Kundenseiten ab. Was in einem System abgehakt wird, wird ueberall abgehakt; was neu angelegt wird, wird uebertragen. Nutze dieses Skill, wenn der Nutzer den taeglichen Aufgabenabgleich anstoesst, /tasksync aufruft, nach dem Sync-Stand fragt, oder wenn ein /loop diesen Abgleich faehrt. Argumente: --dry (nur Report, schreibt nichts), --init (einmaliges Anlegen der Sync-Key-Spalten), --force (Schreib-Deckel ignorieren, nur nach ausdruecklicher Ansage).
---

# TaskSync

Dieses Skill ist der Sync-Motor. Superlist ist ausschliesslich ueber MCP erreichbar, es gibt also kein Programm, das man startet — **du** fuehrst den Algorithmus aus. Halte dich exakt daran. Beim Schreiben in Live-Daten gibt es keinen Ermessensspielraum.

Alle IDs, Property-Namen und Regeln stehen in `config/sync.config.json`. Lies die Datei zuerst. Erfinde niemals eine ID.

Drei Leitsaetze, aus denen sich fast alles Uebrige ergibt:

1. **Superlist ist das Haupttool.** Dort arbeitet der Nutzer. Der vollstaendige offene Bestand gehoert dorthin; bei Gleichstand gewinnt Superlist.
2. **Kunden-Aufgaben-DBs sind mit dem Kunden geteilt.** Dort steht ausschliesslich, was diesen Kunden betrifft — nie die uebrigen Arbeitsaufgaben des Nutzers.
3. **Eine Aufgabe, ein Titel.** Der Sync gleicht Titel ueber alle Stores hinweg an, damit auf einen Blick erkennbar ist, welche Eintraege dasselbe meinen.

Der Lauf ist auf **stuendlich** ausgelegt (`policy.schedule`). Die Drift zwischen zwei Laeufen ist dadurch klein — ein normaler Lauf schreibt selten mehr als eine Handvoll Aenderungen.

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

**Titel — aktiv angleichen** (`policy.titlePolicy == "canonical"`):

Jeder Link fuehrt **einen** kanonischen Titel, der in `links.json` unter `canonicalTitle` steht — ohne Kundenpraefix. Zweck: der Nutzer soll auf einen Blick erkennen, welche Eintraege dieselbe Aufgabe sind. Abweichende Titel in einzelnen Stores werden **korrigiert**, nicht toleriert.

Kanonischen Titel bestimmen:
1. Hat sich seit `lastSeen` genau eine Seite geaendert → deren Titel wird kanonisch.
2. Haben sich mehrere geaendert → der Titel aus dem Store mit dem juengsten Zeitstempel; bei Gleichstand gewinnt **Superlist** (`policy.leadStore`).
3. Hat sich nichts geaendert → `canonicalTitle` bleibt.

Danach das Kundenpraefix abziehen, falls vorhanden, und den kanonischen Titel in jeden Store schreiben, dessen Titel abweicht:

| Store | geschriebener Titel |
|---|---|
| Superlist | `<canonicalTitle>` — der Kunde steckt im Label, nicht im Titel |
| Master Tasks | `<canonicalTitle>` |
| Kunden-DB | `<canonicalTitle>` |

Ueberall derselbe Titel, ohne Praefix. `customers.<k>.writePrefix` ist leer; ist dort doch ein Wert gesetzt, wird er in Superlist vorangestellt.

Im **Erstlauf** wird jeder abweichende Titel im Report gelistet — alt → neu, pro Store. Erst nach Freigabe geschrieben. Im Normalbetrieb laeuft die Angleichung ohne Rueckfrage.

**Prioritaet:** ueber `priorityMap` uebersetzen; bei Konflikt die hoehere gewinnt.

## Schritt 6 — Neuzugaenge routen

| Neu in | Anlegen in |
|---|---|
| Superlist-Liste `L` | Master Tasks mit `Area = L`. In eine Kunden-DB **nur**, wenn der Kundenthemen-Test unten bestanden ist. |
| Master Tasks, `Area = L` | Superlist-Liste `L` |
| Kunden-DB, `Owner` ∈ `policy.customerOwnerScope` | Superlist: Liste laut `customers.<k>.superlistList`, Titel unveraendert, **Kundenlabel sofort mitsetzen** — und Master Tasks mit passender `Area` |
| Kunden-DB, `Owner` ausserhalb des Scope | **nichts anlegen.** Nur unter „Beim Kunden offen" in den Report. |

Bereits erledigte Neuzugaenge werden **nicht** in andere Stores kopiert — nur registriert. Sonst regnet es abgehakte Altlasten.

### Kundenthemen-Test — wann darf in eine Kunden-DB geschrieben werden

Eine Kunden-Aufgaben-DB ist **mit dem Kunden geteilt** und enthaelt ausschliesslich Themen dieses Kunden. Max' uebrige Arbeitsaufgaben duerfen dort **nie** auftauchen.

Der Sync legt in `customers.<k>.tasksDataSource` nur dann eine Zeile an, wenn **beide** Bedingungen erfuellt sind:

1. die Superlist-Aufgabe liegt in `customers.<k>.superlistList` (fuer Maison & Mood: 🟢 Advisory), **und**
2. sie traegt das Label `customers.<k>.superlistLabel` (fuer Maison & Mood: `Maison`).

Eine Bedingung allein genuegt nicht. Konsequenzen, die so gewollt sind:

- Aufgaben aus 🔵 Kaufland, 🟣 Private und 🟠 Home erreichen **niemals** eine Kunden-DB — auch nicht mit gesetztem Label.
- Aufgaben in 🟢 Advisory ohne Kundenlabel (etwa „Teilnahme am Cologne Collective Day klaeren") bleiben Superlist und Master Tasks vorbehalten.
- Willst du eine Aufgabe bewusst beim Kunden sichtbar machen, setzt du in Superlist das Label `Maison`. Das ist der Schalter.

**Das Label ist der Kundenmarker, nicht das Titelpraefix.** Die alte Konvention `M&M: ` im Titel ist abgeloest: sie steht nur noch in `legacyTitlePrefixes`, wird beim Matching abgezogen und beim Schreiben nicht mehr gesetzt (`writePrefix: ""`). Dadurch ist der Superlist-Titel identisch mit dem Notion-Titel — „eine Aufgabe, ein Titel" gilt dann woertlich.

Aufgaben, die **in** der Kunden-DB entstanden sind, gehen immer nach Superlist — diese Richtung ist unbeschraenkt. Die Einschraenkung gilt nur fuer Schreibvorgaenge **in** die Kunden-DB.

Steht `policy.customerDbWrite` auf `never`, werden in Kunden-DBs ueberhaupt keine Zeilen angelegt; die Richtung Kunde → Superlist laeuft weiter.

### Kundenlabel setzen und halten

Bei `policy.customerLabelPolicy == "enforce"` gilt fuer jede Superlist-Aufgabe, die ueber einen Link zu einem Kunden gehoert:

- Fehlt das Kundenlabel → setzen mit `mcp__Superlist__add_label`.
- Beim Anlegen einer neuen Superlist-Aufgabe aus einer Kunden-DB → Label sofort mitsetzen.
- **Ein Label wird nie automatisch entfernt.** Nimmt der Nutzer `Maison` von einer Aufgabe, ist das seine Entscheidung: die Aufgabe faellt aus dem Kundenthemen-Test und wird ab dem naechsten Lauf nicht mehr in die Kunden-DB geschrieben. Die dort bereits bestehende Zeile bleibt (es wird nie geloescht) und erscheint unter „Verwaist" im Report.

Eine Aufgabe kann Labels mehrerer Kunden tragen — dann gilt sie fuer beide und wird in beide Kunden-DBs geschrieben, sofern der Listen-Test jeweils passt. Andere Labels (`@Nadine`, `Blocker`, `Kai`, …) bleiben unberuehrt; der Sync fasst ausschliesslich Kundenlabels an.

**Zwei Altlast-Konventionen in Advisory.** Der Bestand traegt den Kundenbezug teils als Label `Maison` (aeltere Aufgaben), teils als Titelpraefix `M&M: ` (neuere) — keine traegt beides. Der Erstlauf vereinheitlicht das: wo ein Alt-Praefix erkannt wird, wird das Label gesetzt; das Praefix selbst wird nur nach ausdruecklicher Freigabe aus den Titeln entfernt.

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
- **Niemals eine Aufgabe in eine Kunden-DB schreiben, die den Kundenthemen-Test nicht besteht.** Die DB ist mit dem Kunden geteilt — was dort landet, sieht der Kunde. Im Zweifel: nicht schreiben, in den Report.
- **Niemals eine UUID oder Data-Source-ID raten** — alles steht in der Config.
