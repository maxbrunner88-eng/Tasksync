# Notion-Aufgabenlisten, Telegram, und ein Ablauf-Problem, 10.08.2026 11:20

## Drei Aufgaben-Datenbanken in Notion — eine davon steht nicht in der Config

| Datenbank | ID | In `sync.config.json`? | Zuletzt bewegt |
|---|---|---|---|
| **Master Tasks** | `2fa2c15e-b77f-437f-877d-2bab1ac47f67` | ja | 10.08. |
| **✅ M&M Aufgaben Max & Nadine** | `02f9d74f-1c0e-44e8-88c5-f439e6cd0f9c` | ja (Kunde maison-mood) | 10.08. |
| **Meine Aufgaben** | `7b3a01b9-774f-49e3-ae6c-ef6283e80721` | **nein** | 11.05. |

`Meine Aufgaben` ist Notions eingebaute Tasks-Funktion, unter der Seite „Home". Der Filter lautet `Verantwortlich = ich` plus Status in `To-do`/`In progress`, Eigenschaften sind `Aufgabenbezeichnung`, `Status`, `Fällig`, `Quelle`. Ein anderes Schema als Master Tasks.

Seit drei Monaten unberührt — vermutlich ein Überbleibsel aus der Zeit vor Master Tasks. **Bevor sie in den Sync kommt, muss der Nutzer sagen, ob sie noch gilt.** Eine tote Datenbank mitzusynchronisieren würde erledigte Arbeit wieder aufmachen.

## Telegram

Chat-ID **`896541059`**, Credential **Telegram Startforge** (`ukVsLTgyeiqc6KQA`). Die Chat-ID ist nicht geraten, sondern aus dem bestehenden Workflow `Task Manager — Telegram Daily Briefing` übernommen.

Der Node hängt an „Bericht", mit `onError: continueRegularOutput` — eine gescheiterte Benachrichtigung soll den Sync nicht abbrechen.

## Deine drei Task-Manager-Workflows scheitern täglich

`Task Manager — Telegram Daily Briefing` (`JuRloMtgsPJfb4FW`) ist aktiv und läuft jeden Morgen um 05:00 UTC. **Die letzten sieben Läufe sind allesamt fehlgeschlagen**, zuletzt heute früh.

Zwei Ursachen, beide im Node sichtbar:

1. Der Code-Node ruft `fetch()` gegen die Notion-API. Die n8n-Code-Sandbox hat **keinen Netzzugang** — `fetch` schlägt dort zur Laufzeit fehl. Notion-Aufrufe gehören in einen HTTP-Request- oder Notion-Node.
2. Am Telegram-Node hängt kein Credential. Die Workflow-Beschreibung sagt bis heute „Add Startforge Telegram credential to Send Daily Briefing node" — ein To-do, das nie erledigt wurde.

Dasselbe Muster tragen `Weekly Review` (`aePmbX7JPurah805`) und `Delegation Follow-up Checker` (`OsQPNE8BQnbpZmKQ`), beide ebenfalls aktiv.

Sie lesen dieselbe Master-Tasks-Datenbank wie TaskSync, schreiben aber nichts. Kein Konflikt mit dem Sync — aber drei aktive Workflows, die seit Mai nur Fehler produzieren.

## Der eigentliche Blocker: das OAuth-Token hält nicht

| Zeit | Ergebnis |
|---|---|
| 09:25 | Superlist gelesen, 48 Aufgaben |
| 09:38 | Superlist gelesen, 94 Aufgaben, Lauf komplett sauber |
| 11:19 | `401 Invalid or expired OAuth access token` |

Rund **90 Minuten Lebensdauer**, und n8n hat das Token nicht selbst erneuert.

Für einen stündlichen Dauerbetrieb ist das der Knackpunkt. Entweder n8n bekommt einen Refresh-Token und erneuert selbstständig, oder der Workflow scheitert dauerhaft ab der zweiten Stunde.

**Deshalb ist der Workflow angelegt, aber nicht aktiviert.** Ein Workflow, der nachweislich nicht authentifizieren kann, scharf zu schalten, würde genau den Zustand herstellen, den wir bei den Task-Manager-Workflows gerade aufgedeckt haben.

### Was zu tun ist

1. Credential „Superlist" in n8n öffnen und neu verbinden.
2. Prüfen, ob n8n dabei einen Refresh-Token erhält.
3. Erst danach aktivieren — und den ersten Lauf nach über zwei Stunden gezielt kontrollieren.

Hält das Token dauerhaft nicht, ist das ein Argument gegen n8n als Laufzeit für die Superlist-Seite, unabhängig davon, wie gut der Workflow gebaut ist.

## Schreiben

Noch nicht drin, und vor dem Token-Thema auch nicht sinnvoll. Was dafür feststeht:

- Superlist-Schreiben geht über dieselben MCP-Werkzeuge: `complete_task`, `update_task`, `add_label`, `add_task`.
- Notion-Schreiben über den Notion-Node (`Notion Task Manager`, `sKordcuHPMEtHtCJ`).
- Die Schranken aus `SKILL.md` gelten unverändert, plus die zwei Regeln von heute: **Label vor Titel-Strippen**, und **„war schon erledigt" ist kein Fehlerfall**.

## Ein Hinweis zur Taktung

Solange Etappe 4 offen ist, meldet der Bericht 60 unbekannte Aufgaben — bei stündlichem Lauf also 24 gleichlautende Telegram-Nachrichten am Tag. Entweder Etappe 4 zuerst, oder die Taktung vorerst auf täglich.
