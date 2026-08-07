# TaskSync — Abgleich Superlist ↔ Notion ↔ Kundenseiten

> **Nachtrag 07.08.2026.** Dieser Plan ist der Stand vor dem Nutzer-Feedback. Vier Punkte wurden danach geändert; wo dieses Dokument ihnen widerspricht, gilt der Nachtrag:
>
> 1. **Kunden-DBs bleiben frei von fremden Arbeitsaufgaben.** Geschrieben wird dorthin nur, wenn die Aufgabe in der Liste des Kunden liegt **und** ein Kundenpräfix trägt. Kaufland, Private und Home erreichen eine Kunden-DB nie. Die Gegenrichtung bleibt unbeschränkt.
> 2. **Superlist ist Leitsystem** (`policy.leadStore`). Damit ist die offene Frage aus Block 5 des Erstabgleichs entschieden: die 36 offenen M&M-Aufgaben ohne Superlist-Gegenstück wandern nach 🟢 Advisory.
> 3. **Titel werden aktiv angeglichen**, nicht nur gematcht — ein kanonischer Titel pro Aufgabe, in allen Stores durchgesetzt.
> 4. **Takt ist stündlich**, nicht täglich (`/loop 1h /tasksync`).
>
> Der ausgeführte Erstabgleich steht in `reports/000-erstabgleich.md`. Verbindlich für den Betrieb sind `README.md` und `.claude/skills/tasksync/SKILL.md`.

## Context

Deine Aufgaben liegen aktuell in drei Systemen, die auseinanderlaufen:

| Store | Ort | Zustand |
|---|---|---|
| **Superlist** | 4 Listen: 🟢 Advisory, 🔵 Kaufland, 🟣 Private, 🟠 Home | **aktiv** (zuletzt 06.08.) |
| **Notion Master Tasks** | `collection://e3113d00-0bde-4cee-8077-bde717b20c85` | **eingefroren seit 08.06.** — genau dem Tag, an dem die Superlist-Listen entstanden. 49 Zeilen, ~24 davon noch auf „offen". Das `Area`-Feld hat exakt die Optionen Kaufland/Advisory/Private/Home — die Zuordnung zu deinen Superlist-Listen ist also schon 1:1 angelegt. |
| **Kundenseiten** | 🏢 Kunden & Projekte → Aufgaben-DB pro Kunde. Aktuell nur ✅ M&M Aufgaben Max & Nadine (`collection://c52275a8-7be0-41c6-8b17-57368804526b`) | **aktiv** (zuletzt 07.08.), ~100 Zeilen, geteilt mit Nadine |

Die Drift ist bereits messbar. Stichproben aus dem Ist-Zustand:

| Aufgabe | Superlist | Notion Kundenseite |
|---|---|---|
| UUID-Spalten im Sheet anlegen und befüllen | offen | ✅ erledigt |
| RK-Kalender Filterleiste entfernen | offen | ✅ erledigt |
| Passwort-Gate (Netlify Edge Function) einbauen und testen | offen | ✅ erledigt |
| Deploy auf Git-Build umstellen | offen | offen |

Dazu kommt: dieselbe Aufgabe heißt in Superlist „M&M: Datenklassen-Doku (halbe Seite) schreiben" und in Notion „Datenklassen-Doku (halbe Seite)". Ein Abgleich über exakte Titel funktioniert also **nicht** — es braucht Normalisierung plus eine persistente Verknüpfungstabelle.

**Ziel:** Ein täglich laufender Abgleich. Was du in einem System abhakst, verschwindet in allen. Was du in einem System anlegst, taucht in den anderen auf.

## Grundentscheidung: warum ein Skill und kein Script

Superlist ist aus dieser Umgebung **ausschließlich über MCP-Tools** erreichbar — es gibt keinen bestätigten REST-Zugang, den ein Node-Script oder ein n8n-Workflow ansprechen könnte (n8n hat aktuell auch keinen einzigen Workflow in dieser Richtung). Der MCP-Client ist Claude. Also ist der Sync-Motor ein **Claude-Skill**: ein exakt vorgeschriebener Ablauf plus ein Zustandsfile im Repo, nicht ein Programm, das man `node sync.js` aufruft.

Konsequenz: das Skill muss deterministisch formuliert sein — fester Algorithmus, harte Schranken, keine Ermessensspielräume beim Schreiben.

## Angenommene Defaults

Du hast die vier Rückfragen nicht beantwortet; ich baue mit diesen Annahmen. Alle vier stehen in `config/sync.config.json` und sind ohne Codeänderung umschaltbar:

1. **Notion-Quelle = Master Tasks reaktiviert.** Grund: das `Area`-Feld passt bereits 1:1 auf deine vier Listen. Die ~24 dort noch offenen Alt-Aufgaben aus Mai/Juni werden beim Erstlauf **nicht** blind nach Superlist gespiegelt, sondern kommen auf eine Triage-Liste im Erstlauf-Report.
2. **Kundenscope = Owner ∈ {Max, Gemeinsam}.** Nadines Aufgaben bleiben Notion-only (dort arbeitet der Kunde), erscheinen aber im Tagesreport, damit du siehst, was beim Kunden hängt.
3. **Konfliktregel = „Erledigt gewinnt".** Ist eine Aufgabe irgendwo abgehakt, wird sie überall abgehakt. Eine erledigte Aufgabe wird **nie** automatisch wieder geöffnet. Das löst genau die Tabelle oben auf.
4. **Ausführung = /loop wie gewünscht**, plus optionale Routine für echten Cron (siehe unten).

## Architektur

### Identität — der Kern

Superlist-Tasks können keine Fremdschlüssel tragen (keine Custom Fields). Notion-Seiten können es. Daraus folgt:

- In **Master Tasks** und in **jeder Kunden-Aufgaben-DB** wird eine Text-Property `Sync Key` ergänzt (via `notion-update-data-source`, `ADD COLUMN "Sync Key" RICH_TEXT`).
- Die Superlist-Seite der Verknüpfung existiert **nur** in `state/links.json`. Dieses File ist damit tragende Infrastruktur und muss nach jedem Lauf committet werden.

Ein Link-Eintrag:

```json
{
  "key": "tsk_7f3a91c2",
  "title": "Deploy auf Git-Build umstellen",
  "superlist": { "uuid": "6f64b466-...", "list": "advisory" },
  "notionMaster": { "pageId": "..." },
  "notionCustomer": { "customer": "maison-mood", "pageId": "..." },
  "state": "open",
  "lastSeen": { "superlist": "2026-08-07T…", "notionMaster": "…", "notionCustomer": "…" }
}
```

### Abbildungen

- **Liste ↔ Area:** 🟢 Advisory ↔ `Advisory`, 🔵 Kaufland ↔ `Kaufland`, 🟣 Private ↔ `Private`, 🟠 Home ↔ `Home`.
- **Kunde → Liste:** `maison-mood` → 🟢 Advisory (belegt durch die vielen `M&M: …`-Tasks dort). Marko Schilling hat noch keine Aufgaben-DB; er wird registriert, aber übersprungen, bis eine existiert.
- **Erledigt-Signal je Store:**
  - Superlist: `status == "completed"`
  - Master Tasks: `Status ∈ {Done, Cancelled}` (Cancelled wird gespiegelt und im Report vermerkt)
  - Kunden-DB: `Erledigt == "__YES__"` — laut Property-Beschreibung *„Einzige Wahrheit für erledigt/nicht erledigt"*. Das `Status`-Feld (Offen/In Arbeit/Blockiert/Wartet auf Antwort) ist **orthogonal** und wird vom Sync nie angefasst; viele Zeilen stehen auf `Erledigt=YES` bei `Status=Offen`.

### Titel-Normalisierung (fürs Matching, nie fürs Schreiben)

Kleinschreibung → Umlaute falten → Präfixe `M&M:`, `M&M BUG:`, `Nadine:`, `WF x.y:` strippen → Klammer-Suffixe wie `(läuft in Session)`, `(Session 1)`, `(Zielzustand)` strippen → Satzzeichen weg → Whitespace kollabieren.

## Ablauf

### Erstlauf — reiner Report, schreibt nichts

1. Alle drei Stores vollständig lesen.
2. Kandidaten-Paare bilden: exakter Normtitel-Treffer → sicher; Jaccard-Tokenüberlappung ≥ 0,6 → Vorschlag.
3. `reports/000-erstabgleich.md` schreiben mit vier Blöcken:
   - **Sichere Links** (werden ohne Rückfrage übernommen)
   - **Vorschläge** (unsicheres Fuzzy-Matching — du bestätigst)
   - **Status-Konflikte** (die Tabelle aus dem Context-Abschnitt, vollständig)
   - **Alt-Triage**: die ~24 in Master Tasks offenen Aufgaben von vor dem 08.06. — pro Zeile die Frage „noch relevant?"
4. Nach deiner Freigabe: `state/links.json` schreiben, Konflikte auflösen, ab dann automatisch.

### Täglicher Lauf

1. **Lesen** — Superlist: `get_lists` + `get_list` ×4. Notion: `notion-query-data-sources` (SQL) auf Master Tasks und jede Kunden-DB.
2. **Zuordnen** — jeden Datensatz über die Registry auf einen Link auflösen; unbekannte Datensätze sind Neuzugänge.
3. **Soll-Zustand je Link berechnen**
   - `done = done_S ∨ done_N ∨ done_K`
   - Fälligkeit: frühestes gesetztes Datum; weichen zwei geänderte Werte ab → flaggen, nicht überschreiben
   - Titel: nur nachziehen, wenn genau eine Seite ihn seit dem letzten Lauf geändert hat; sonst flaggen
4. **Schreiben**
   - erledigt → `complete_task` (S), `Status=Done` + `Completed At` (N), `Erledigt=__YES__` (K)
   - neu in genau einem Store → in den anderen anlegen nach Routing-Regeln
5. **Nachhalten** — `state/links.json` aktualisieren, `reports/YYYY-MM-DD.md` schreiben, committen und pushen.

### Routing für Neuzugänge

- **Neu in Superlist-Liste L** → Master Tasks mit `Area = L`. Trägt der Titel ein Kundenpräfix (`M&M:`) und der Kunde hat eine Aufgaben-DB → zusätzlich dort mit `Owner = Max`.
- **Neu in Master Tasks, `Area = L`** → Superlist-Liste L.
- **Neu in Kunden-DB, Owner ∈ {Max, Gemeinsam}** → Superlist (Liste laut Kundenmap) + Master Tasks. Owner = Nadine → nur Report.

## Schutzschranken

Das Ding schreibt in Live-Daten. Nicht verhandelbar:

- **Keine Löschungen, nie.** Ein Datensatz, der in der Registry steht und im Store fehlt, wird geflaggt — nicht als „überall löschen" interpretiert. Ein Loch kann auch Pagination oder ein API-Fehler sein.
- **Kein automatisches Wiederöffnen** erledigter Aufgaben.
- **Schreib-Deckel:** Würde ein Lauf mehr als 25 Schreibvorgänge auslösen, bricht er ab und schreibt nur den Report. Fängt den Fall ab, dass `links.json` verlorengeht und der Sync alles für neu hält.
- **Registry fehlt oder ist kaputt** → Schreibmodus verweigert, automatischer Rückfall auf Erstlauf-Report.
- **`update_list` ist eine Falle:** Der `content`-Parameter ersetzt den Listenkörper vollständig und **löst jede Aufgabe ab, die im neuen Text fehlt**. Regel im Skill: `add_task` für Einzelanlagen; `update_list` nur nach vorherigem `get_list` und nur mit vollständig durchgereichtem `contents_markdown` inklusive aller `superlist:task/<uuid>`-Referenzen.
- **`complete_task` bei wiederkehrenden Aufgaben** hakt nicht ab, sondern schiebt auf den nächsten Termin. Solche Tasks werden erkannt und übersprungen.

## Dateien

```
/home/user/Tasksync
├── CLAUDE.md                       # Repo-Kontext für künftige Sessions
├── README.md                       # Kurzanleitung, Ist-Zustand, Umschalter
├── .claude/skills/tasksync/
│   └── SKILL.md                    # der Algorithmus, Schritt für Schritt
├── config/sync.config.json         # Store-IDs, Listen↔Area-Map, Kundenmap,
│                                   # die 4 Defaults oben, Schreib-Deckel
├── state/links.json                # die Verknüpfungstabelle
└── reports/                        # ein Report pro Lauf
```

`config/sync.config.json` trägt alle bereits ermittelten IDs, damit kein Lauf sie neu suchen muss:

```
superlist.lists: advisory ec808fbe-7599-4bd8-b52b-124cc40db28a
                 kaufland fb0163b7-bc87-46e8-a990-1028b6ed28da
                 private  0473db4f-317c-4bc6-94d3-291829756001
                 home     6d73a1be-d35e-4cfa-a891-f9628e8ffcc5
notion.masterTasks:  collection://e3113d00-0bde-4cee-8077-bde717b20c85
notion.customersDb:  collection://166495fc-d773-4a22-a4e3-15168f10dbac
customers.maison-mood.tasksDs: collection://c52275a8-7be0-41c6-8b17-57368804526b
```

## Ausführung

**Wie gewünscht per `/loop`:**

```
/loop 24h /tasksync
```

Ein Hinweis, den du kennen solltest: `/loop` lebt in der Session. Endet der Container, endet der Loop. Für einen Abgleich, der wirklich jeden Tag läuft, lege ich zusätzlich eine **Routine** an (täglich 07:00, startet eine frische Session, die `/tasksync` fährt). `/loop` bleibt dann für manuelles Nachziehen zwischendurch. Beides parallel ist unschädlich — der Sync ist idempotent.

## Verifikation

1. **Trockenlauf:** `/tasksync --dry` → Report gegen den Ist-Zustand prüfen. Erwartung: die vier Konfliktzeilen aus dem Context-Abschnitt tauchen auf, plus die M&M-Fuzzy-Paare.
2. **Einzelfall vorwärts:** In Superlist eine Testaufgabe „TaskSync Probe A" in 🟣 Private anlegen → `/tasksync` → prüfen, dass sie in Master Tasks mit `Area=Private` steht.
3. **Einzelfall rückwärts:** Dieselbe Aufgabe in Notion auf `Done` setzen → `/tasksync` → prüfen, dass sie in Superlist abgehakt ist.
4. **Kundenpfad:** In der M&M-DB eine Aufgabe mit `Owner=Max` anlegen → `/tasksync` → muss in 🟢 Advisory und in Master Tasks landen. Dieselbe mit `Owner=Nadine` → darf **nicht** in Superlist landen, nur im Report stehen.
5. **Idempotenz:** `/tasksync` zweimal hintereinander → der zweite Lauf muss null Schreibvorgänge melden.
6. **Schranke:** `state/links.json` temporär wegschieben → der Lauf muss den Schreibmodus verweigern, nicht 200 Duplikate anlegen.
7. Aufräumen: Testaufgaben in allen drei Stores entfernen.

Branch: `claude/notion-superlist-sync-uig8mk`.
