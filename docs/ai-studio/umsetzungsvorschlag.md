# AI Studio: Technischer Umsetzungsvorschlag

Stand: 30.10.2026, Basis: Pixel Agents v1.5.0 (dieses Repository, unverändert).

Ziel: ein virtuelles Büro, in dem dauerhafte KI Mitarbeiter (Secretary, Research, Creative, Engineering) für mehrere Projekte arbeiten, koordiniert von einem Sekretär, sichtbar in Pixel Agents. Am Pixel Agents Code wird in dieser Phase nichts verändert.

## 1. Was Pixel Agents heute schon kann

Die Untersuchung des Codes zeigt: deutlich mehr von dem, was wir brauchen, ist schon da, als die Beschreibung vermuten lässt.

| Baustein in Pixel Agents                                    | Wo im Code                                                  | Was er für AI Studio leistet                                                                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Directory (benannter Startordner)                           | `server/src/directories.ts`, Nachricht `saveDirectory`      | Ein Agent, der in ein Directory gestartet wird, trägt dessen Namen. Ein Directory pro Mitarbeiter ergibt einen festen Namen über alle Sessions hinweg.                       |
| Area und Area mapping                                       | `saveAreaMappings`, `CONTEXT.md`                            | Benannte Bereiche im Layout. Agenten eines Directory bevorzugen Sitze in dessen Area. Damit bekommt jede Abteilung ihren eigenen Raum.                                       |
| Seat assignment, Palette                                    | `PersistedAgent.palette`, `saveAgentSeats`                  | Feste Plätze und feste Farben, die Neustarts überleben.                                                                                                                      |
| Adopt externer Sessions                                     | `onExternalSessionDetected`, Einstellung Watch All Sessions | Sessions, die wir selbst (z. B. mit `claude --continue`) außerhalb des Büros starten, erscheinen trotzdem als Figur.                                                         |
| Teams, Lead, Teammates                                      | `server/src/providers/hook/claude/claudeTeamProvider.ts`    | Startet ein Mitarbeiter benannte Helfer, sitzen diese als eigene Figuren im Büro.                                                                                            |
| Status: active, done, waiting for input, permission request | Nachrichten `agentStatus`, `agentToolPermission`            | Genau die Signale, die der Sekretär braucht, um zu wissen, wann ein Ergebnis fertig ist oder jemand auf dich wartet.                                                         |
| Protokoll über WebSocket                                    | `GET /ws`, Vertrag in `core/asyncapi.yaml`                  | Ein fremdes Programm kann sich wie die Büro UI verbinden und alle Ereignisse mitlesen. Ohne Token ist die Verbindung nur lesend, was für einen Beobachter genau richtig ist. |
| Hook Ingress                                                | `POST /api/hooks/:providerId`                               | Echtzeit Ereignisse aus Claude Code, schon fertig installiert.                                                                                                               |

Was fehlt (und was wir selbst bauen):

- Eine Rolle ist heute nur ein Ordnername. Persönlichkeit, Zuständigkeiten, Gedächtnis und Aufgaben kennt Pixel Agents nicht.
- `launchAgent` nimmt nur einen `directoryPath`, keinen Auftrag und keinen Prompt. Aufgaben können also nicht über die Büro UI übergeben werden.
- Pixel Agents startet jede Session neu (`claude --session-id <neue uuid>`). Ein Fortsetzen der letzten Session eines Mitarbeiters gibt es nicht.
- Es gibt keine Aufgabenliste, keinen Posteingang und keine Bündelung von Meldungen.

## 2. Leitidee der Architektur

Drei Schichten, klar getrennt, damit die Büro Oberfläche später austauschbar bleibt:

```
  Du (Creative Director)
        |
  AI Studio Kern  (eigenes Repo "ai-studio")
    Mitarbeiterregister, Projekte, Aufgaben, Posteingang, Sekretär
        |                         |
  Claude Code Sessions      Beobachter (WebSocket Client)
  je Mitarbeiter-Ordner         |
        |                         |
        +--- Hooks / Transcripts --> Pixel Agents (Visualisierung)
```

- Pixel Agents bleibt reine Anzeige und Terminalverwaltung.
- AI Studio ist die Organisations und Koordinationsschicht. Die Wahrheit über Mitarbeiter und Aufgaben liegt dort, als einfache Dateien in einem Git Repo.
- Die Verbindung zwischen beiden läuft nur über Dinge, die Pixel Agents schon öffentlich anbietet: Directories, Area mappings, Adopt und das `/ws` Protokoll.

## 3. Mitarbeiter getrennt von Sessions

Ein Mitarbeiter ist ein Ordner. Eine Session ist nur ein Arbeitstag dieses Mitarbeiters.

```
ai-studio/
  staff/
    secretary/
      CLAUDE.md          Rolle, Persönlichkeit, Regeln, Zuständigkeiten
      memory.md          dauerhafte Notizen, vom Mitarbeiter selbst gepflegt
      journal/           ein Eintrag pro Session: was getan, was offen
    research/  ...
    creative/  ...
    engineering/ ...
  projects/
    roman/      project.md, Ziele, Links zu den echten Repos
    sport-app/
    website/
  tasks/
    open/       eine Datei pro Aufgabe (YAML Kopf + Text)
    doing/
    review/     fertig, wartet auf dich
    done/
  inbox/
    digest.md   was der Sekretär dir gebündelt vorlegt
```

Warum das trägt:

- Claude Code lädt `CLAUDE.md` des Startordners automatisch. Die Persönlichkeit kommt also ohne eine Zeile Code mit.
- In Pixel Agents wird jeder Ordner als Directory mit dem Mitarbeiternamen angelegt (z. B. "Mira (Research)") und einer Area zugeordnet. Name, Raum, Platz und Farbe bleiben stabil, egal wie viele Sessions es gibt.
- Das Gedächtnis liegt in `memory.md` und `journal/`, nicht in der Session. Endet eine Session, geht nichts verloren. Eine Regel in jeder `CLAUDE.md` lautet: zu Beginn `memory.md` und die eigenen Aufgaben lesen, am Ende einen Journaleintrag schreiben.
- Wer an einer Session anknüpfen will, startet im Ordner `claude --continue`. Pixel Agents adoptiert die Session und setzt sie an den Platz des Mitarbeiters.

Projekte sind keine eigenen Firmen. Ein Mitarbeiter arbeitet projektübergreifend, die Aufgabe nennt das Projekt und dessen Repo Pfad. Engineering erhält über `--add-dir` Zugriff auf das jeweilige Projekt Repo.

## 4. Zentrale Aufgabenverwaltung

Eine Aufgabe ist eine Markdown Datei mit Kopf:

```yaml
id: 2026-10-30-001
projekt: sport-app
an: research
von: secretary
status: open # open | doing | review | done | blocked
prioritaet: normal # hoch | normal | niedrig
freigabe: noetig # noetig | erteilt | nicht_noetig
ergebnis: tasks/review/2026-10-30-001-konkurrenz.md
```

Der Status ergibt sich aus dem Ordner, in dem die Datei liegt. Das ist für Menschen und Agenten gleich gut lesbar, versionierbar und braucht keinen Server. Wenn die Datenmenge wächst, kann dieselbe Struktur später in SQLite wandern, ohne dass sich die Rollen ändern.

## 5. Wie der Sekretär koordiniert

Der Sekretär ist selbst ein Mitarbeiter (eigener Ordner, eigene Figur) mit genau drei Aufgaben:

1. Annehmen: Du sprichst nur mit ihm. Er formuliert aus deinem Wunsch eine Aufgabe, ordnet sie einem Projekt und einem Mitarbeiter zu und legt sie in `tasks/open/`.
2. Verteilen: Er startet den zuständigen Mitarbeiter mit dem Auftrag. Er erledigt die Arbeit nicht selbst.
3. Bündeln: Fertige Ergebnisse prüft er auf Vollständigkeit und schreibt sie in `inbox/digest.md`. Du bekommst gesammelte Meldungen zu festen Zeitpunkten oder wenn du ins Büro kommst, nicht jede einzeln.

Technisch in zwei Ausbaustufen:

Stufe A (ohne eigenen Code): Der Sekretär ist eine Claude Code Session. Er startet Mitarbeiter als Teammates (Agent Teams). Pixel Agents zeigt sie dann automatisch als benannte Figuren mit ihm als Lead. Ergebnisse landen als Dateien in `tasks/review/`.

Stufe B (kleiner Dienst `studio-daemon`, TypeScript):

- verbindet sich lesend mit `ws://localhost:<port>/ws` von Pixel Agents und ordnet `agentCreated.directoryName` dem Mitarbeiter zu,
- erkennt über `agentStatus` (waiting) und `agentToolPermission`, wann jemand fertig ist oder auf dich wartet,
- beobachtet `tasks/` auf Änderungen,
- startet Mitarbeiter mit Auftrag über `claude -p "<Auftrag>" --resume <id>` im Mitarbeiterordner oder später über das Claude Agent SDK,
- weckt den Sekretär nur, wenn sich etwas Relevantes ergeben hat, und hält eine Ruhezeit ein, damit du nicht überflutet wirst.

Hinweis zum SDK: Eigene SDK Anwendungen laufen mit eigener Authentifizierung und Abrechnung über die API, nicht automatisch über ein Claude Abonnement. Für den MVP reicht die Claude Code CLI.

## 6. Was wir selbst entwickeln müssen

| Komponente                                                                                 | Aufwand              | Wann         |
| ------------------------------------------------------------------------------------------ | -------------------- | ------------ |
| Ordnerstruktur, vier `CLAUDE.md` Rollen, Vorlagen für Aufgaben                             | klein                | MVP          |
| Einrichtung in Pixel Agents: Directories, Areas, Layout mit vier Räumen                    | klein, nur Bedienung | MVP          |
| Regeln für Gedächtnis und Journal in jeder Rolle                                           | klein                | MVP          |
| Sekretär Rolle mit Annahme, Verteilung, Digest                                             | mittel               | MVP          |
| `studio-daemon` (WebSocket Beobachter, Aufgaben Watcher, Starter)                          | mittel               | nach dem MVP |
| Eigene Ansicht für Aufgaben und Digest (eigene kleine Web UI)                              | mittel               | später       |
| Änderungen an Pixel Agents selbst (z. B. Auftrag beim Launch, Schreibtisch mit Dokumenten) | groß, nur wenn nötig | spät         |

Wenn wir Pixel Agents später doch erweitern, wäre der sauberste erste Schritt ein optionales Feld `prompt` an `launchAgent` im AsyncAPI Vertrag. Das passt zum bestehenden Muster und ist auch für das Originalprojekt interessant.

## 7. Roadmap zum nutzbaren MVP

Woche 1: Beobachten

- Pixel Agents standalone starten (`npx pixel-agents`), Hooks erlauben.
- Zwei bis drei normale Claude Code Sessions laufen lassen und schauen, wie es sich anfühlt.

Woche 2: Firma anlegen

- Repo `ai-studio` mit der Struktur aus Abschnitt 3.
- Vier Rollen schreiben, jeweils kurz: Name, Ton, Zuständigkeit, was nicht dazugehört, Regeln für Gedächtnis.
- In Pixel Agents vier Directories und vier Areas anlegen, Layout mit Sekretariat und drei Abteilungen.

Woche 3: Erster echter Ablauf

- Eine echte Frage an den Sekretär, z. B. die Konkurrenzanalyse für die Sport App.
- Sekretär legt Aufgabe an, startet Research als Teammate, Ergebnis landet in `tasks/review/`, Digest in `inbox/`.
- Danach notieren, was gestört hat. Das bestimmt den nächsten Schritt.

Woche 4 und folgende: Ausbau nach Bedarf

- `studio-daemon` für gebündelte Benachrichtigungen.
- Zweites und drittes Projekt einhängen.
- Erst dann: eigene Oberfläche für Dokumente, Meetings, Persönlichkeit.

Abnahmekriterium für den MVP: Du kannst eine Aufgabe nur über den Sekretär vergeben, siehst den zuständigen Mitarbeiter im Büro arbeiten, und das Ergebnis liegt danach gesammelt für dich bereit, ohne dass du zwischendurch eingreifen musstest.

## 8. Offene Entscheidung

Wie viel darf der Sekretär allein entscheiden? Vorschlag als Startpunkt:

- Allein: Aufgaben innerhalb eines bestehenden Projekts verteilen, priorisieren, zurückstellen, Rückfragen an Mitarbeiter stellen.
- Mit deiner Freigabe: neue Projekte, alles was Code in echte Repos pusht, alles was Geld kostet oder nach außen sichtbar ist.

Das Feld `freigabe` in jeder Aufgabe macht diese Grenze sichtbar und lässt sich später lockern.
