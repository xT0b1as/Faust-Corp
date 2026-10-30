# Updates vom Original Pixel Agents übernehmen

Faust Corp ist ein Fork von https://github.com/pixel-agents-hq/pixel-agents. So holst du neue Versionen des Originals herein.

## Einmalig

```bash
git remote add upstream https://github.com/pixel-agents-hq/pixel-agents.git
```

## Jedes Mal

```bash
git checkout main
git pull origin main
git fetch upstream
git checkout -b upstream-merge
git merge upstream/main
```

Konflikte gibt es am ehesten in diesen Dateien, weil Faust Corp dort eingreift:

- `core/asyncapi.yaml`: Beide Seiten fügen Nachrichten hinzu. Beide Einträge behalten.
- `core/src/messages.ts`: Nie von Hand lösen. Nach dem Lösen von `asyncapi.yaml` neu erzeugen: `npm run asyncapi:generate`.
- `server/src/clientMessageHandler.ts`, `server/src/httpServer.ts`, `server/src/cli.ts`: Die Faust Corp Fälle sind eigene `case` Blöcke bzw. klar kommentierte Abschnitte. Beide Seiten behalten.
- `webview-ui/src/App.tsx`, `LaunchDrawer.tsx`, `BottomToolbar.tsx`, `MobileAgentBar.tsx`, `MobileShell.tsx`: zusätzliche Props und Knöpfe.
- Texte, die Faust Corp übersetzt hat (`SettingsModal.tsx`, `IntroBubble.tsx`, `consentCopy.ts`) und die e2e Tests, die sie erwarten. Neue englische Texte aus dem Original darfst du stehen lassen oder übersetzen; dann die passenden e2e Erwartungen mitziehen.

Fast alles Neue von Faust Corp liegt in eigenen Dateien und erzeugt keine Konflikte: `server/src/projects/`, `server/src/hub/`, `webview-ui/src/components/{NewChatModal,DepartmentModal,OverviewPanel,WalkControls}.tsx`, `webview-ui/src/office/layout/departmentRoom.ts`.

## Danach prüfen

```bash
npm install
npm run asyncapi:generate && git diff --exit-code core/src/messages.ts
npm run e2e:inventory && git diff --exit-code e2e/README.md
npm run check-types
npm run lint
npm test
npm run build
```

Dann einen Pull Request von `upstream-merge` nach `main` erstellen. Claude Code kann den Merge samt Konflikten auch für dich machen: "Übernimm die neuen Änderungen von pixel-agents-hq/pixel-agents in Faust Corp."
