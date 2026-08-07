# TaskSync

Täglicher Abgleich zwischen **Superlist**, der Notion-Datenbank **Master Tasks** und den **Aufgaben-DBs auf den Notion-Kundenseiten**.

Was du in einem System abhakst, verschwindet in allen. Was du in einem System anlegst, taucht in den anderen auf.

## Warum ein Skill und kein Script

Superlist ist aus dieser Umgebung ausschließlich über MCP-Tools erreichbar — es gibt keinen bestätigten REST-Zugang, den ein Node-Script oder ein n8n-Workflow ansprechen könnte. Der MCP-Client ist Claude. Der Sync-Motor ist deshalb ein Claude-Skill (`.claude/skills/tasksync/SKILL.md`): ein exakt vorgeschriebener Ablauf plus Zustandsdateien im Repo — kein Programm, das man startet.

## Benutzung

```
/tasksync           # voller Lauf: lesen, abgleichen, schreiben, Report, committen
/tasksync --dry     # rechnet alles durch, schreibt nichts in Superlist/Notion
/tasksync --init    # einmalig: legt die "Sync Key"-Spalten in Notion an
/tasksync --force   # hebt den Schreib-Deckel auf (nur bewusst einsetzen)
```

### Erste Inbetriebnahme

```
/tasksync --init    # Sync-Key-Spalten in Notion anlegen
/tasksync           # erkennt die leere Registry und fährt automatisch den Erstlauf
```

Der Erstlauf **schreibt nichts**. Er legt `reports/000-erstabgleich.md` an mit vier Blöcken: sichere Verknüpfungen, unsichere Vorschläge, Status-Konflikte und eine Triage-Liste der Notion-Karteileichen von vor dem 08.06.2026. Erst nach deiner Freigabe wird geschrieben.

### Stündlich laufen lassen

```
/loop 1h /tasksync
```

`/loop` lebt in der Session — endet der Container, endet der Loop. Für einen Abgleich, der wirklich rund um die Uhr läuft, zusätzlich eine **Routine** anlegen (stündlich, startet eine frische Session mit `/tasksync`). Beides parallel ist unschädlich: der Sync ist idempotent, ein zweiter Lauf direkt hinter dem ersten meldet null Schreibvorgänge.

Bei stündlichem Takt ist die Drift zwischen zwei Läufen klein — ein normaler Lauf schreibt selten mehr als eine Handvoll Änderungen.

## Drei Leitsätze

1. **Superlist ist das Haupttool.** Dort wird gearbeitet. Der vollständige offene Bestand gehört dorthin; bei Gleichstand gewinnt Superlist.
2. **Kunden-Aufgaben-DBs sind mit dem Kunden geteilt.** Dort steht ausschließlich, was diesen Kunden betrifft — nie die übrigen Arbeitsaufgaben.
3. **Eine Aufgabe, ein Titel.** Der Sync gleicht Titel über alle Stores hinweg an, damit auf einen Blick erkennbar ist, welche Einträge dasselbe meinen.

## Was landet beim Kunden — und was nicht

Die Aufgaben-DB auf einer Kundenseite ist mit dem Kunden geteilt. Der Sync legt dort nur an, wenn **beide** Bedingungen erfüllt sind:

1. die Superlist-Aufgabe liegt in der Liste des Kunden (Maison & Mood → 🟢 Advisory), **und**
2. ihr Titel trägt ein Kundenpräfix (`M&M:`, `M&M BUG:`).

Daraus folgt, so gewollt:

- 🔵 Kaufland, 🟣 Private und 🟠 Home erreichen **niemals** eine Kunden-DB.
- Advisory-Aufgaben ohne Präfix (z. B. „Teilnahme am Cologne Collective Day klären") bleiben in Superlist und Master Tasks.
- **Der Schalter bist du:** Setzt du in Superlist `M&M: ` vor eine Aufgabe, wird sie beim Kunden sichtbar. Ohne Präfix nicht.

Die Gegenrichtung ist unbeschränkt — was in der Kunden-DB entsteht und dir gehört, kommt immer nach Superlist.

## Titel-Angleichung

Jede verknüpfte Aufgabe führt **einen** kanonischen Titel, der in allen Stores durchgesetzt wird. Weicht ein Store ab, wird er korrigiert. Kanonisch wird der Titel der zuletzt geänderten Seite; bei Gleichstand Superlist.

Geschrieben wird mit Präfix-Konvention: Superlist `M&M: <Titel>`, Kunden-DB und Master Tasks `<Titel>` — in der Kunden-DB wäre das Präfix nur Rauschen, dort ist ohnehin alles vom selben Kunden.

Im Erstlauf werden alle Titeländerungen vorher aufgelistet (alt → neu, pro Store). Danach läuft die Angleichung ohne Rückfrage.

## Ausgangslage (Stand 07.08.2026)

| Store | Zustand |
|---|---|
| Superlist — 🟢 Advisory, 🔵 Kaufland, 🟣 Private, 🟠 Home | aktiv |
| Notion Master Tasks | eingefroren seit 08.06.2026 — dem Tag, an dem die Superlist-Listen entstanden. Das `Area`-Feld hat exakt die vier Listennamen als Optionen. |
| ✅ M&M Aufgaben Max & Nadine (Kundenseite Maison & Mood) | aktiv, ~100 Zeilen, geteilt mit der Kundin |

Bereits vorhandene Drift, die der Erstlauf auflöst:

| Aufgabe | Superlist | Notion Kundenseite |
|---|---|---|
| UUID-Spalten im Sheet anlegen und befüllen | offen | ✅ erledigt |
| RK-Kalender Filterleiste entfernen | offen | ✅ erledigt |
| Passwort-Gate (Netlify Edge Function) einbauen und testen | offen | ✅ erledigt |

Die Titel sind dabei nicht identisch — Superlist trägt ein `M&M: `-Präfix, Notion nicht. Der Abgleich normalisiert Titel und hält die Zuordnung anschließend in `state/links.json` fest, statt sich auf Titelgleichheit zu verlassen.

## Stellschrauben

Alles in `config/sync.config.json`, ohne Codeänderung umschaltbar:

| Schlüssel | Default | Bedeutung |
|---|---|---|
| `policy.leadStore` | `superlist` | Haupttool. Gewinnt bei Gleichstand. |
| `policy.notionSource` | `masterTasks` | Welche Notion-DB die zentrale To-do-Liste ist |
| `policy.customerOwnerScope` | `["Max","Gemeinsam"]` | Welche Kunden-Aufgaben nach Superlist fließen. Nadines Aufgaben bleiben Notion-only und erscheinen nur im Report. |
| `policy.customerDbWrite` | `customerTopicsOnly` | Was in eine Kunden-DB geschrieben werden darf. `never` schaltet die Richtung ganz ab. |
| `policy.titlePolicy` | `canonical` | Ein Titel pro Aufgabe, in allen Stores durchgesetzt |
| `policy.conflictRule` | `doneWins` | Ist etwas irgendwo abgehakt, wird es überall abgehakt |
| `policy.schedule` | `hourly` | Vorgesehener Takt |
| `policy.maxWritesPerRun` | `25` | Über dieser Grenze bricht der Lauf ab und fragt nach |

## Schutzschranken

Der Sync schreibt in Live-Daten. Fest verdrahtet:

- **Keine Löschungen, nie.** Fehlt ein bekannter Datensatz in einem Store, wird er als „verwaist" gemeldet — nicht als „überall löschen" interpretiert. Ein Loch kann auch Pagination oder ein API-Fehler sein.
- **Kein automatisches Wiederöffnen** erledigter Aufgaben.
- **Schreib-Deckel** bei 25 Vorgängen pro Lauf — fängt den Fall ab, dass die Registry verlorengeht und der Sync alles für neu hält.
- **Fehlende oder kaputte `state/links.json`** → Schreibmodus verweigert, automatischer Rückfall auf den Erstlauf-Report.
- **`Status` in den Kunden-DBs wird nie geschrieben.** Dort ist `Erledigt` laut Property-Beschreibung die einzige Wahrheit für erledigt/nicht erledigt; `Status` (Offen / In Arbeit / Blockiert / Wartet auf Antwort) ist orthogonal.

## Aufbau

```
.claude/skills/tasksync/SKILL.md   der Algorithmus, Schritt für Schritt
config/sync.config.json            Store-IDs, Mappings, Policies, Deckel
state/links.json                   die Verknüpfungstabelle — nach jedem Lauf committen
reports/                           ein Report pro Lauf
```

`state/links.json` ist tragende Infrastruktur: Superlist-Tasks können keine Fremdschlüssel aufnehmen, die Superlist-Seite jeder Verknüpfung existiert nur in dieser Datei. Geht sie verloren, muss der Erstlauf neu gefahren werden.
