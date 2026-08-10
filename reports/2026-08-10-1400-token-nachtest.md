# Token-Nachtest bestanden, 10.08.2026 14:00

## Der Verlauf

| Zeit | Ereignis | Ergebnis |
|---|---|---|
| ~09:20 | Credential am Vormittag angelegt | 22 Werkzeuge gelesen |
| 09:38 | Workflow-Lauf | sauber, 94 Aufgaben |
| 11:19 | Workflow-Lauf | **401 Invalid or expired OAuth access token** |
| 11:24 | Gegenprobe direkt aufs Credential | ebenfalls 401 |
| ~11:27 | **Nutzer: Disconnect + neu verbinden** | |
| 11:28 | Workflow-Lauf | sauber |
| **14:00** | **Nachtest, 2 h 33 min später** | **sauber — 22 Werkzeuge, kompletter Durchlauf** |

## Was das heißt

**n8n erneuert das Access-Token selbstständig.** Die Verbindung trägt unbeaufsichtigt.

Die Ursache lag also nicht in Superlists OAuth-Bauart und auch nicht an Dynamic Client Registration — beides hatte ich als Verdacht im Raum. Es lag an der ersten Verbindung selbst, die offenbar ohne brauchbares Refresh-Token zustande kam. Das Neuverbinden hat das behoben.

Damit fällt auch das Argument weg, das ich heute Vormittag gegen n8n als Laufzeit vorgebracht hatte. Es war richtig, das vor der Aktivierung zu prüfen — die Schlussfolgerung wäre ohne den Nachtest aber falsch gewesen.

## Was der Nachtest nicht zeigt

Ein bestandener Test nach zweieinhalb Stunden ist kein Beweis für dauerhaften Betrieb. Was noch offen ist:

- Verhalten nach Tagen ohne Interaktion — Refresh-Tokens können eigene Ablauffristen haben
- Verhalten, wenn Superlist die Client-Registrierung zurückzieht

Beides zeigt sich erst im Betrieb. Deshalb gehört an den Workflow eine Fehlermeldung, die den Nutzer erreicht — sonst steht er in vier Monaten auf „active" wie die elf archivierten Task-Manager-Workflows.

## Offen vor der Aktivierung

1. **Telegram** — meldet weiterhin `Bad Request: chat not found`. Der Startforge-Bot darf dem Nutzer erst schreiben, wenn dieser ihn einmal angeschrieben hat. Ein `/start` genügt.
2. **Taktung** — stündlich bei aktuell 60 unbekannten Aufgaben bedeutet 24 gleichlautende Nachrichten am Tag. Bis Etappe 4 durch ist, wäre täglich sinnvoller.
3. **Error Workflow** — im Workflow noch nicht gesetzt. Ohne ihn bleibt ein Fehlschlag unsichtbar.
