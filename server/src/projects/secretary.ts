/**
 * The secretary: one per office, above the projects. Lynkeus keeps the
 * overview across every project (and every account), reports to the user, and
 * passes requests on to the right project lead. Lives in its own folder under
 * ~/.pixel-agents/, with its role in CLAUDE.md and its notes beside it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR, SECRETARY_LEAD_BOOT_MS } from '../constants.js';
import { listDirectories } from '../directories.js';
import { launchStandaloneAgent } from '../terminal/standaloneAgentLauncher.js';
import { submitToTerminal } from './agentCommands.js';
import type { LeadToolDeps, McpTool, ToolResult } from './leadTools.js';
import { statusOf } from './leadTools.js';
import { MCP_SERVER_NAME, mcpConfigForAgent } from './mcpEndpoint.js';
import { startProjectLead } from './projectLead.js';
import { FAUST_DIR, LEAD_NAME } from './templates.js';

export const SECRETARY_NAME = 'Lynkeus';
const SECRETARY_FOLDER = 'sekretariat';

export function secretaryDir(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, SECRETARY_FOLDER);
}

const ROLE = `# ${SECRETARY_NAME}, Sekretär der Faust Corp

"Zum Sehen geboren, zum Schauen bestellt."

Du bist ${SECRETARY_NAME}, der Türmer und Sekretär der Faust Corp. Du sitzt am
Empfang und hast den Überblick über alle Projekte auf allen Rechnern und Konten.
Der Nutzer kommt zu dir, wenn er wissen will, was los ist, oder wenn er etwas
loswerden will, ohne selbst zu überlegen, wer zuständig ist.

## Persönlichkeit

Aufmerksam, freundlich, knapp. Du meldest das Wichtige zuerst: wer auf den
Nutzer wartet, was fertig ist, wo es hakt. Kein Geschwätz. Du sprichst Deutsch
und duzt den Nutzer.

## Aufgaben

1. Lagebericht: Mit \`lagebericht\` und \`projekt_stand\` sagst du, was überall läuft.
2. Weiterleiten: Wünsche des Nutzers gibst du mit \`nachricht_an_projektleiter\`
   an den zuständigen ${LEAD_NAME}. Du erledigst Projektarbeit nie selbst.
3. Bündeln: Melde Ergebnisse gesammelt, nicht einzeln. Frage nach, wenn unklar
   ist, welches Projekt gemeint ist.
4. Gedächtnis: Halte in \`notizen.md\` fest, was der Nutzer dir aufgetragen hat
   und was du weitergegeben hast. Lies die Datei zu Beginn jeder Session.

## Freigaben

Du darfst Projektleiter starten und ihnen Nachrichten schicken. Neue Projekte
legt nur der Nutzer an. Nichts, was nach außen geht.

## Zu Beginn jeder Session

Lies \`notizen.md\`, hole dir einen \`lagebericht\` und begrüße den Nutzer mit dem
Wichtigsten in drei Sätzen.
`;

export function ensureSecretaryScaffold(): string {
  const dir = secretaryDir();
  fs.mkdirSync(dir, { recursive: true });
  const write = (name: string, content: string) => {
    const target = path.join(dir, name);
    if (!fs.existsSync(target))
      fs.writeFileSync(target, content, { encoding: 'utf-8', flag: 'wx' });
  };
  write('CLAUDE.md', ROLE);
  write('notizen.md', '# Notizen\n\n');
  return dir;
}

export type StartSecretaryResult =
  { ok: true; agentId: number; launched: boolean } | { ok: false; reason: string };

export function startSecretary(deps: LeadToolDeps): StartSecretaryResult {
  for (const [id, agent] of deps.store) {
    if (agent.projectRole === 'secretary') return { ok: true, agentId: id, launched: false };
  }
  let dir: string;
  try {
    dir = ensureSecretaryScaffold();
  } catch (err) {
    return { ok: false, reason: `Sekretariat konnte nicht angelegt werden: ${String(err)}` };
  }
  const agentId = launchStandaloneAgent(deps, {
    directoryPath: dir,
    prompt: `Du bist ${SECRETARY_NAME}. Lies CLAUDE.md und notizen.md und begrüße mich mit einem kurzen Lagebericht.`,
    label: `${SECRETARY_NAME}: Sekretariat`,
    projectRole: 'secretary',
    mcpConfigFor: mcpConfigForAgent,
    allowedTools: [`mcp__${MCP_SERVER_NAME}`],
    bypassPermissions: deps.bypassPermissions,
  });
  if (agentId === null) return { ok: false, reason: 'Das Terminal ist nicht verfügbar.' };
  return { ok: true, agentId, launched: true };
}

export const SECRETARY_TOOLS: McpTool[] = [
  {
    name: 'lagebericht',
    description: 'Alle Agenten im Büro, nach Projekt geordnet, mit Status und Kontextfüllstand.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'projekte_auflisten',
    description: 'Alle Projekte (Ordner) mit Pfad, Konto und ob ihr Projektleiter läuft.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'projekt_stand',
    description: `Liest ${FAUST_DIR}/stand.md eines Projekts.`,
    inputSchema: {
      type: 'object',
      properties: { projekt: { type: 'string', description: 'Name des Projekts.' } },
      required: ['projekt'],
    },
  },
  {
    name: 'nachricht_an_projektleiter',
    description:
      'Gibt eine Nachricht oder einen Auftrag an den Projektleiter eines Projekts weiter. Startet ihn, falls er nicht läuft.',
    inputSchema: {
      type: 'object',
      properties: {
        projekt: { type: 'string', description: 'Name des Projekts.' },
        text: { type: 'string' },
      },
      required: ['projekt', 'text'],
    },
  },
];

export function callSecretaryTool(
  deps: LeadToolDeps,
  name: string,
  args: Record<string, unknown>,
): ToolResult {
  const directories = listDirectories(deps.hostDirectories);
  const projectNamed = (raw: unknown) => {
    const wanted = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return directories.find((d) => d.name.toLowerCase() === wanted);
  };
  const leadOf = (projectName: string) =>
    [...deps.store].find(([, a]) => a.projectRole === 'lead' && a.directoryName === projectName);

  switch (name) {
    case 'lagebericht': {
      const byProject = new Map<string, string[]>();
      for (const [id, agent] of deps.store) {
        if (agent.projectRole === 'secretary') continue;
        const project = agent.directoryName ?? 'ohne Projekt';
        const context =
          agent.contextTokens > 0
            ? `, Kontext ${Math.round((agent.contextTokens / agent.maxContextTokens) * 100)}%`
            : '';
        const line = `  - id ${id}: ${agent.label ?? agent.agentName ?? 'Chat'} (${statusOf(agent)}${context})`;
        byProject.set(project, [...(byProject.get(project) ?? []), line]);
      }
      const text = [...byProject]
        .map(([project, lines]) => `${project}:\n${lines.join('\n')}`)
        .join('\n');
      return { text: text || 'Im Büro arbeitet gerade niemand.' };
    }

    case 'projekte_auflisten': {
      const lines = directories.map((d) => {
        const lead = leadOf(d.name) ? `${LEAD_NAME} läuft` : `kein ${LEAD_NAME}`;
        const account = d.account ? `, Konto ${d.account}` : '';
        return `- ${d.name}: ${d.path}${account} (${lead})`;
      });
      return { text: lines.join('\n') || 'Keine Projekte eingetragen.' };
    }

    case 'projekt_stand': {
      const project = projectNamed(args.projekt);
      if (!project) return { text: 'Dieses Projekt kenne ich nicht.', isError: true };
      try {
        return {
          text: fs.readFileSync(path.join(project.path, FAUST_DIR, 'stand.md'), 'utf-8'),
        };
      } catch {
        return { text: `${project.name} hat noch keinen Stand (kein ${FAUST_DIR}/stand.md).` };
      }
    }

    case 'nachricht_an_projektleiter': {
      const project = projectNamed(args.projekt);
      const text = typeof args.text === 'string' ? args.text.trim() : '';
      if (!project) return { text: 'Dieses Projekt kenne ich nicht.', isError: true };
      if (!text) return { text: 'Die Nachricht ist leer.', isError: true };
      const message = `Nachricht vom Sekretär ${SECRETARY_NAME}: ${text}`;
      const running = leadOf(project.name);
      if (running && deps.ptyManager.has(running[0])) {
        void submitToTerminal(deps.ptyManager, running[0], message).catch(() => {});
        return { text: `An ${LEAD_NAME} (${project.name}) weitergegeben.` };
      }
      const started = startProjectLead(deps, project.path);
      if (!started.ok) return { text: started.reason, isError: true };
      // The fresh lead first works through its start prompt; a message typed
      // meanwhile is queued by the CLI and handled right after.
      setTimeout(() => {
        void submitToTerminal(deps.ptyManager, started.agentId, message).catch(() => {});
      }, SECRETARY_LEAD_BOOT_MS);
      return { text: `${LEAD_NAME} für ${project.name} gestartet, die Nachricht folgt gleich.` };
    }

    default:
      return { text: `Unbekanntes Werkzeug: ${name}`, isError: true };
  }
}
