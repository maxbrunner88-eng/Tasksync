import { workflow, node, trigger, sticky, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

const stuendlich = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Stuendlich',
    position: [0, 0],
    parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 1, triggerAtMinute: 5 }] } }
  },
  output: [{}]
});

const advisoryLesen = node({
  type: '@n8n/n8n-nodes-langchain.mcpClient',
  version: 1.1,
  config: {
    name: 'Advisory lesen',
    position: [220, 0],
    parameters: {
      serverTransport: 'httpStreamable',
      endpointUrl: 'https://app.superlist.com/mcp',
      authentication: 'mcpOAuth2Api',
      tool: { __rl: true, mode: 'list', value: 'get_list', cachedResultName: 'get_list' },
      inputMode: 'json',
      jsonInput: '{"list_uuid": "ec808fbe-7599-4bd8-b52b-124cc40db28a"}',
      options: { timeout: 60000 }
    },
    credentials: { mcpOAuth2Api: newCredential('Superlist') }
  },
  output: [{ list: { title: 'Advisory' }, tasks: [{ uuid: 'ec808fbe', title: 'Beispiel', status: 'uncompleted', labels: ['Maison'] }] }]
});

const kauflandLesen = node({
  type: '@n8n/n8n-nodes-langchain.mcpClient',
  version: 1.1,
  config: {
    name: 'Kaufland lesen',
    position: [440, 0],
    executeOnce: true,
    parameters: {
      serverTransport: 'httpStreamable',
      endpointUrl: 'https://app.superlist.com/mcp',
      authentication: 'mcpOAuth2Api',
      tool: { __rl: true, mode: 'list', value: 'get_list', cachedResultName: 'get_list' },
      inputMode: 'json',
      jsonInput: '{"list_uuid": "fb0163b7-bc87-46e8-a990-1028b6ed28da"}',
      options: { timeout: 60000 }
    },
    credentials: { mcpOAuth2Api: newCredential('Superlist') }
  },
  output: [{ list: { title: 'Kaufland' }, tasks: [{ uuid: 'fb0163b7', title: 'Beispiel', status: 'completed', labels: [] }] }]
});

const registryLesen = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Registry lesen',
    position: [660, 0],
    executeOnce: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: 'ANsXO3EhOjME7DHp', cachedResultName: 'TaskSync Registry' },
      matchType: 'allConditions',
      filters: { conditions: [] },
      returnAll: true
    }
  },
  output: [{ id: 1, syncKey: 'tsk_e1f0a001', canonicalTitle: 'Beispiel', superlistUuid: 'ec808fbe', state: 'open' }]
});

const abgleich = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Abgleich',
    position: [880, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: [
        "const auspacken = (name) => {",
        "  const roh = $(name).all().map((i) => i.json);",
        "  const aufgaben = [];",
        "  for (const eintrag of roh) {",
        "    const kern = eintrag.tasks ? eintrag : (eintrag.result ?? eintrag.data ?? {});",
        "    for (const t of kern.tasks ?? []) aufgaben.push(t);",
        "  }",
        "  return aufgaben;",
        "};",
        "",
        "const normalisieren = (titel) => String(titel ?? '')",
        "  .toLowerCase()",
        "  .replace(/[\\u2013\\u2014]/g, '-')",
        "  .replace(/[^a-z0-9äöüß ]/g, ' ')",
        "  .replace(/\\s+/g, ' ')",
        "  .trim();",
        "",
        "const advisory = auspacken('Advisory lesen').map((t) => ({ ...t, liste: 'advisory' }));",
        "const kaufland = auspacken('Kaufland lesen').map((t) => ({ ...t, liste: 'kaufland' }));",
        "const superlist = [...advisory, ...kaufland];",
        "",
        "const registry = $('Registry lesen').all().map((i) => i.json).filter((r) => r.syncKey);",
        "const nachUuid = new Map(registry.map((r) => [r.superlistUuid, r]));",
        "",
        "const drift = [];",
        "const neu = [];",
        "const markerImTitel = [];",
        "const ohneLabel = [];",
        "",
        "for (const t of superlist) {",
        "  const erledigt = t.status === 'completed';",
        "  const eintrag = nachUuid.get(t.uuid);",
        "",
        "  if (!eintrag) {",
        "    neu.push({ uuid: t.uuid, titel: t.title, liste: t.liste, erledigt });",
        "  } else if ((eintrag.state === 'done') !== erledigt) {",
        "    drift.push({",
        "      syncKey: eintrag.syncKey,",
        "      uuid: t.uuid,",
        "      titel: t.title,",
        "      superlist: erledigt ? 'erledigt' : 'offen',",
        "      registry: eintrag.state",
        "    });",
        "  }",
        "",
        "  if (/M&M|M\\+M|Maison/i.test(t.title)) {",
        "    const alsPraefix = /^\\s*(M&M|M\\+M|Maison\\s*&\\s*Mood)\\s*[:\\-\\u2013]/i.test(t.title);",
        "    const alsAnhang = /[|(]\\s*Maison[ ,]/i.test(t.title);",
        "    if (alsPraefix || alsAnhang) markerImTitel.push({ uuid: t.uuid, titel: t.title });",
        "    if (!(t.labels ?? []).includes('Maison')) ohneLabel.push({ uuid: t.uuid, titel: t.title });",
        "  }",
        "}",
        "",
        "const bekannteUuids = new Set(superlist.map((t) => t.uuid));",
        "const verwaist = registry",
        "  .filter((r) => r.superlistUuid && !bekannteUuids.has(r.superlistUuid))",
        "  .map((r) => ({ syncKey: r.syncKey, titel: r.canonicalTitle }));",
        "",
        "const gesamt = drift.length + neu.length + markerImTitel.length + ohneLabel.length + verwaist.length;",
        "",
        "return [{",
        "  json: {",
        "    gelaufenAm: new Date().toISOString(),",
        "    gelesen: { superlist: superlist.length, registry: registry.length },",
        "    befunde: gesamt,",
        "    drift,",
        "    neu,",
        "    markerImTitel,",
        "    ohneLabel,",
        "    verwaist",
        "  }",
        "}];"
      ].join('\n')
    }
  },
  output: [{ gelaufenAm: '2026-08-10T09:05:00.000Z', gelesen: { superlist: 60, registry: 38 }, befunde: 2, drift: [], neu: [], markerImTitel: [], ohneLabel: [], verwaist: [] }]
});

const gibtEsBefunde = ifElse({
  version: 2.3,
  config: {
    name: 'Befunde?',
    position: [1100, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.befunde }}'), operator: { type: 'number', operation: 'gt' }, rightValue: 0 }],
        combinator: 'and'
      }
    }
  }
});

const bericht = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Bericht',
    position: [1320, -100],
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'zusammenfassung',
            name: 'zusammenfassung',
            type: 'string',
            value: expr(
              'TaskSync {{ $now.toFormat("dd.MM.yyyy HH:mm") }}\n' +
              'Gelesen: {{ $json.gelesen.superlist }} Superlist-Aufgaben, {{ $json.gelesen.registry }} Verknuepfungen\n\n' +
              'Statusdrift: {{ $json.drift.length }}\n' +
              'Unbekannt in der Registry: {{ $json.neu.length }}\n' +
              'Kundenmarker noch im Titel: {{ $json.markerImTitel.length }}\n' +
              'Kundenbezug ohne Label: {{ $json.ohneLabel.length }}\n' +
              'Verwaiste Verknuepfungen: {{ $json.verwaist.length }}'
            )
          }
        ]
      }
    }
  },
  output: [{ zusammenfassung: 'TaskSync 10.08.2026 09:05\nGelesen: 60 Superlist-Aufgaben, 38 Verknuepfungen' }]
});

const nichtsZuTun = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Nichts zu tun', position: [1320, 100] },
  output: [{}]
});

const hinweisLesen = sticky(
  '## Lesen\n\nBeide Superlist-Listen ueber den MCP-Server, dazu die Registry aus der Data Table "TaskSync Registry".\n\nDie Registry ist die einzige Stelle, an der die Superlist-Seite einer Verknuepfung existiert — Superlist-Aufgaben koennen keine Fremdschluessel tragen.',
  [advisoryLesen, kauflandLesen, registryLesen],
  { color: 4 }
);

const hinweisSchreiben = sticky(
  '## Noch keine Schreibvorgaenge\n\nDieser Stand liest und meldet, er schreibt nicht.\n\nBevor Schreiben dazukommt, gelten die Schranken aus SKILL.md:\n\n- keine Loeschungen\n- kein Wiederoeffnen erledigter Aufgaben\n- kein Schreiben von Status in einer Kunden-DB\n- Label setzen laeuft VOR dem Titel-Strippen, nie danach\n\n"War schon erledigt" ist KEIN Fehlerfall — der Nutzer arbeitet parallel in denselben Systemen.\n\nAn "Bericht" gehoert ein Telegram- oder Slack-Node.',
  [gibtEsBefunde, bericht, nichtsZuTun],
  { color: 3 }
);

export default workflow('tasksync-drift', 'TaskSync — Drifterkennung')
  .add(stuendlich)
  .to(advisoryLesen)
  .to(kauflandLesen)
  .to(registryLesen)
  .to(abgleich)
  .to(gibtEsBefunde.onTrue(bericht).onFalse(nichtsZuTun))
  .add(hinweisLesen)
  .add(hinweisSchreiben);
