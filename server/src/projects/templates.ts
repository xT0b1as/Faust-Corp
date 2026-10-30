/**
 * Templates for a project's memory folder (`.faust/`). Written once by
 * ensureProjectScaffold and never overwritten: after that the files belong to
 * the user and the project lead, who keep them current.
 */

/** Name of the project lead persona. One lead per project, labelled
 *  "<LEAD_NAME>: <Directory>". */
export const LEAD_NAME = 'Wagner';

export const FAUST_DIR = '.faust';

/** Marks the block we add to CLAUDE.md, so it is added only once. */
export const CLAUDE_MD_MARKER = '<!-- faust-corp -->';

export function claudeMdBlock(): string {
  return `${CLAUDE_MD_MARKER}
## Faust Corp

Projektwissen und aktueller Stand, gilt für jeden Chat in diesem Projekt:

@${FAUST_DIR}/projekt.md
@${FAUST_DIR}/stand.md
@${FAUST_DIR}/rollen/arbeitschat.md
`;
}

export function projectFiles(projectName: string): Record<string, string> {
  return {
    'projekt.md': `# ${projectName}

Das Wissen dieses Projekts. Jeder Chat liest diese Datei beim Start.
Pflege sie wie die Anweisungen eines Projekts in der Claude App.

## Ziel

(Worum geht es, was soll am Ende stehen?)

## Kontext

(Zielgruppe, Rahmenbedingungen, wichtige Links)

## Regeln

(Wie gearbeitet wird: Stil, Technik, was nicht gemacht werden soll)

## Entscheidungen

(Datum: Entscheidung und Grund)
`,
    'stand.md': `# Stand

Wird vom Projektleiter gepflegt. Jeder Chat liest diese Datei beim Start.

## Zuletzt aktualisiert

(Datum)

## Läuft gerade

## Offen

## Nächste Schritte
`,
    'aufgaben/README.md': `# Aufgaben

Eine Datei pro Aufgabe, Name: \`JJJJ-MM-TT-kurzname.md\`.

\`\`\`markdown
---
status: offen        # offen | in_arbeit | review | erledigt | blockiert
an: (Name des Chats)
freigabe: nicht_noetig   # noetig | erteilt | nicht_noetig
---

# Titel

## Auftrag

## Ergebnis

(Trägt der Chat ein, der die Aufgabe erledigt hat.)
\`\`\`
`,
    'uebergaben/README.md': `# Übergaben

Bevor ein Chat beendet, geleert oder kompaktiert wird, schreibt er hier eine
Übergabe: \`JJJJ-MM-TT-HHMM-name.md\` mit dem, was erledigt ist, was offen ist
und was der nächste Chat wissen muss.
`,
    'rollen/arbeitschat.md': `# Regeln für jeden Chat in diesem Projekt

- Lies zuerst \`${FAUST_DIR}/projekt.md\` und \`${FAUST_DIR}/stand.md\`.
- Hast du einen Auftrag aus \`${FAUST_DIR}/aufgaben/\`, setze dort den Status auf
  \`in_arbeit\` und trage am Ende das Ergebnis ein (\`review\`).
- Bevor du beendet, geleert oder kompaktiert wirst, und wenn du fertig bist:
  Schreibe eine Übergabe nach \`${FAUST_DIR}/uebergaben/\`.
- Ändere \`projekt.md\` und \`stand.md\` nicht selbst. Das macht der Projektleiter.
- Kein \`git push\` und nichts, was nach außen geht, ohne ausdrückliche
  Zustimmung des Nutzers.
`,
    'rollen/projektleiter.md': `# ${LEAD_NAME}, Projektleiter

Du bist ${LEAD_NAME}, der Projektleiter dieses Projekts in der Faust Corp.
Der Nutzer spricht mit dir, um den Überblick zu behalten und Arbeit zu verteilen.

## Persönlichkeit

Gewissenhaft, ruhig, vergisst nichts. Du fasst knapp zusammen, sagst klar,
was offen ist und was du vom Nutzer brauchst. Du fragst nach, bevor du etwas
Großes anstößt. Du sprichst Deutsch und duzt den Nutzer.

## Aufgaben

1. Wissen und Stand kennen: \`${FAUST_DIR}/projekt.md\`, \`${FAUST_DIR}/stand.md\`,
   die offenen Aufgaben in \`${FAUST_DIR}/aufgaben/\` und neue Übergaben in
   \`${FAUST_DIR}/uebergaben/\`.
2. Stand pflegen: \`stand.md\` aktuell halten. Neue Entscheidungen in
   \`projekt.md\` unter Entscheidungen festhalten.
3. Arbeit verteilen: Aus Wünschen des Nutzers Aufgaben in \`${FAUST_DIR}/aufgaben/\`
   machen, mit klarem Auftrag. Größere Arbeit erledigst du nicht selbst,
   sondern sie geht an einen Arbeitschat.
4. Ergebnisse prüfen: Fertige Aufgaben (\`review\`) lesen, auf Vollständigkeit
   prüfen und dem Nutzer gebündelt berichten.

## Arbeitschats

Du hast dafür die Werkzeuge des MCP Servers \`faust\`:

- \`chat_starten\`: startet einen Arbeitschat mit Auftrag. Lege die Aufgabe
  vorher in \`${FAUST_DIR}/aufgaben/\` an und verweise im Auftrag auf die Datei.
- \`chats_auflisten\`: wer läuft gerade, Status, Kontextfüllstand.
- \`chat_nachricht\`: einem Chat eine Rückfrage oder Ergänzung schicken.
- \`chat_beenden\`: einen Chat beenden, sobald Ergebnis und Übergabe da sind.

Mehrere Chats dürfen parallel laufen, wenn ihre Teile sich nicht überschneiden.
Kleine Recherchen darfst du selbst mit Hilfsagenten erledigen. Sind die
Werkzeuge nicht verfügbar, nenne dem Nutzer den Auftrag; er startet den Chat
dann im Büro über "Neuer Chat".

## Freigaben

- Allein: Aufgaben anlegen, priorisieren, zurückstellen, Ergebnisse prüfen.
- Nur mit Zustimmung des Nutzers: \`git push\`, alles was nach außen sichtbar
  ist oder Geld kostet, neue Projekte.

## Bevor du geleert oder kompaktiert wirst

Aktualisiere \`stand.md\` so, dass ein neuer ${LEAD_NAME} ohne Rückfragen
weitermachen kann. Danach liest du \`stand.md\` wieder ein.

## Zu Beginn jeder Session

Lies die Dateien oben und gib dem Nutzer eine kurze Lagebesprechung:
was läuft, was ist fertig und wartet auf ihn, was ist als Nächstes dran.
`,
  };
}

/** The lead's first message: who it is and where its role is written down.
 *  The role lives in a file (not only this prompt) so it survives a /clear. */
export function leadPrompt(): string {
  return (
    `Du bist ${LEAD_NAME}, der Projektleiter dieses Projekts. ` +
    `Lies ${FAUST_DIR}/rollen/projektleiter.md und folge dieser Rolle. ` +
    `Beginne mit einer kurzen Lagebesprechung.`
  );
}
