# Faust Corp: Umbauplan

Stand: 30.10.2026. Basis: Pixel Agents v1.5.0, geforkt als `xT0b1as/Faust-Corp`.

Version 2 dieses Dokuments. Version 1 sah ein separates Repo neben einem unveränderten Pixel Agents vor. Jetzt wird der Fork selbst umgebaut.

## 1. Anforderungen

1. Ein Büro im Browser, auch am Handy über Tailscale.
2. Laptop (privat, eigener Claude Account) und PC (Arbeit, eigener Claude Account) laufen gleichzeitig und erscheinen im selben Büro. Beide lassen sich von dort steuern.
3. Pro Projekt ein Projektleiter, der das Wissen und den Stand des Projekts kennt, Aufgaben weitergibt und mit dem man über alles reden kann.
4. Arbeitschats sind nicht persistent. Ein Projekt kann mehrere gleichzeitig haben, für verschiedene Teile. Chats werden beendet, kompaktiert oder neu gestartet, um Tokens freizumachen.
5. Neue Chats kann der Projektleiter starten und du selbst auch, direkt im Büro.
6. Später läuft das Büro auf einem Raspberry Pi.

## 2. Gesamtbild

```
                Handy / Browser (Tailscale)
                          |
                 Hub: das Büro (erst PC, später Raspberry Pi)
                 Layout, Sitzplätze, Oberfläche, Projektleiter Logik
                  /                                  \
      Knoten "Laptop" (privat)               Knoten "PC" (Arbeit)
      eigener Claude Account                  eigener Claude Account
      eigene Repos, eigene Terminals          eigene Repos, eigene Terminals
```

Der Hub zeigt nur an und leitet weiter. Die Claude Sessions laufen dort, wo die Dateien und der Account liegen: auf Laptop und PC. Auf dem Raspberry Pi muss kein Claude laufen und kein Account angemeldet sein. Die Terminals bleiben auf deinen Rechnern, der Pi reicht nur die Bildschirmausgabe durch.

## 3. Laptop und PC in einem Büro

### Was der Code heute erlaubt

Ein Pixel Agents Server sieht nur seinen eigenen Rechner. Das Hook Skript sendet fest an `127.0.0.1` (`server/src/providers/hook/claude/hooks/claude-hook.ts:111`), und die Session Dateien werden von der lokalen Festplatte gelesen. Gleichzeitig hat jeder Server schon alles, was ein Hub braucht: das komplette Protokoll über `/ws` und die Terminals über `/terminal/:agentId`, beide mit Token gesichert.

### Der Plan: Knoten bleiben normale Server, der Hub fasst sie zusammen

Jeder Rechner läuft wie heute als normaler Standalone Server. Hooks, Session Dateien, Terminals und Account bleiben lokal, am Hook Skript ändert sich nichts. Neu ist ein Hub Modus:

```bash
# auf jedem Knoten, nur lokal gebunden, im Tailnet freigegeben
npx faust-corp --port 3100 --allowed-host laptop.<tailnet>.ts.net
tailscale serve --bg 3100

# auf dem Hub
npx faust-corp hub --knoten laptop=https://laptop.<tailnet>.ts.net?token=... \
                   --knoten pc=https://pc.<tailnet>.ts.net?token=...
```

Der Hub verbindet sich zu jedem Knoten als berechtigter Client und:

- übernimmt alle Agenten-Nachrichten (`agentCreated`, `agentStatus`, `agentToolStart` und so weiter) und gibt den Agenten eindeutige IDs im Büro (Knoten plus lokale ID),
- leitet Steuerbefehle (`launchAgent`, `focusAgent`, `closeAgent`) an den richtigen Knoten weiter,
- reicht Terminalverbindungen zum Knoten durch, so dass du im Browser in einer Laptop Session tippen kannst, egal wo du gerade bist,
- verwaltet Layout, Sitzplätze und Einstellungen selbst. Die Layouts der Knoten werden ignoriert.

Ein Knoten, der offline ist (Laptop zugeklappt), wird im Büro grau angezeigt, und seine Agenten stehen still. Kommt er zurück, verbindet sich der Hub von selbst wieder.

Warum so und nicht anders: Die Knoten bleiben vollständig funktionsfähig, auch ohne Hub. Die riskanten Teile (Hooks, Einwilligung, `settings.json`) werden nicht angefasst. Der neue Code beschränkt sich auf den Hub und eine Kennzeichnung der Knoten im Protokoll.

### Privat und Arbeit trennen

- Jeder Knoten bekommt eine Farbe und ein Kennzeichen an jeder Karte und Figur, zum Beispiel "Arbeit" und "Privat".
- Jeder Knoten bekommt eigene Areas im Layout: ein Arbeitsflügel und ein Privatflügel.
- Ein Projekt gehört immer genau einem Knoten. Arbeitsprojekte laufen nie mit dem privaten Account und umgekehrt.

Ein Punkt zum Prüfen: Über den Hub laufen Bildschirmausgaben und Tätigkeitsanzeigen deiner Arbeitssessions. Bleibt alles in deinem Tailnet, verlässt nichts deine Geräte, aber kläre bitte, ob dein Arbeitgeber erlaubt, dass Arbeitsinhalte über ein privates Gerät (den Pi) angezeigt werden. Falls nicht, kann der Hub für den Knoten "Arbeit" auf reine Statusanzeige ohne Terminal geschaltet werden.

### Raspberry Pi

Der Hub braucht wenig Leistung: einen Node.js Prozess, kein Claude, keine Repos. Ein Raspberry Pi 4 oder 5 reicht. Der Weg dorthin: erst läuft der Hub auf dem PC, später wird er auf den Pi umgezogen, ohne dass sich an den Knoten etwas ändert.

Claude selbst auf dem Pi laufen zu lassen, ginge technisch (Claude Code läuft unter Linux auf ARM). Dann bräuchte der Pi aber Zugriff auf deine Repos und einen angemeldeten Account. Für die Arbeit ist das vermutlich ausgeschlossen. Darum bleiben die Sessions auf Laptop und PC.

## 4. Projektleiter und Arbeitschats

### Begriffe

- Projekt: ein Repo oder Ordner auf genau einem Knoten. In Pixel Agents heißt das heute Directory.
- Projektleiter: eine dauerhafte Rolle pro Projekt. Kennt Wissen und Stand, verteilt Aufgaben, ist dein Gesprächspartner.
- Arbeitschat: eine nicht persistente Session im selben Projekt für eine bestimmte Aufgabe. Davon kann es mehrere gleichzeitig geben.

Das entspricht der Idee von Projekten in der Claude App: Das Wissen liegt am Projekt, nicht im Chat. Jeder neue Chat bekommt es mit.

### Das Projektgedächtnis

Jedes Projekt bekommt einen Ordner `.faust/`:

```
<projekt>/.faust/
  projekt.md      Ziel, Regeln, wichtige Entscheidungen, Wissen (wie die Projekt Anweisungen in der Claude App)
  stand.md        aktueller Stand, vom Projektleiter gepflegt
  aufgaben/       eine Datei pro Aufgabe: Auftrag, wer, Status, Ergebnis
  uebergaben/     Notiz eines Chats, bevor er beendet oder geleert wird
```

`CLAUDE.md` im Projekt bekommt einen Verweis darauf. Damit liest jeder neue Chat, auch einer, den du selbst startest, automatisch Wissen und Stand. Das sind normale Dateien, sie können mit ins Repo oder per `.gitignore` lokal bleiben.

### Ablauf

1. Du sprichst mit dem Projektleiter.
2. Er legt eine Aufgabe in `aufgaben/` an und startet dafür einen Arbeitschat mit Auftrag.
3. Der Arbeitschat erscheint als eigene Figur im Projekt, mit Projektname und Aufgabe als Beschriftung, zum Beispiel "Sport App: Login".
4. Ist er fertig, schreibt er das Ergebnis in die Aufgabe und eine Übergabe. Der Projektleiter liest beides, aktualisiert `stand.md` und meldet sich bei dir.
5. Der Arbeitschat wird beendet. Nichts geht verloren, weil alles Wichtige in `.faust/` steht.

Der Projektleiter selbst darf auch geleert werden. Vorher schreibt er `stand.md` neu, danach liest er es wieder ein. Das ist dieselbe Übergaberegel, die für jeden Chat gilt.

### Wie der Projektleiter Chats startet

Der Fork bekommt einen kleinen MCP Server, den jeder Projektleiter automatisch nutzt. Werkzeuge:

| Werkzeug          | Wirkung                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `chat_starten`    | startet einen Arbeitschat im Projekt mit Auftrag, als echte Session mit eigener Figur                      |
| `chats_auflisten` | welche Chats im Projekt laufen, ihr Status (arbeitet, fertig, wartet auf Freigabe), Füllstand des Kontexts |
| `chat_beenden`    | beendet einen Chat, nachdem seine Übergabe da ist                                                          |

Die Chats laufen als echte Sessions und nicht als interne Helfer. So kannst du in jeden Chat selbst hineinschauen und eingreifen.

### Was du selbst im Büro tun kannst

Neue Knöpfe an jeder Karte und im Projekt:

- Neuer Chat: im gewählten Projekt, optional mit Auftrag.
- Kompaktieren: schickt `/compact` an die Session.
- Neu starten mit Übergabe: der Chat schreibt seine Übergabe, danach `/clear`, danach liest er sie wieder ein. Figur und Platz bleiben.
- Beenden.

Die Anzeige unter jeder Figur zeigt schon heute, wie voll das Kontextfenster ist. Ab einer Schwelle, zum Beispiel 70 Prozent, wird der Knopf "Neu starten mit Übergabe" hervorgehoben.

## 5. Änderungen am Code

| Bereich                   | Änderung                                                                                                          | Dateien (Startpunkt)                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Protokoll                 | `launchAgent` bekommt `prompt` und `label`, Agenten bekommen `node`, `projectRole` (leiter oder chat) und `label` | `core/asyncapi.yaml`, danach `npm run asyncapi:generate`                                                              |
| Start mit Auftrag         | Auftrag als erste Eingabe an `claude` übergeben                                                                   | `server/src/providers/hook/claude/claude.ts` (`buildLaunchCommand`), `server/src/terminal/standaloneAgentLauncher.ts` |
| Mehrere Chats pro Projekt | eindeutige Beschriftung pro Chat statt nur Directory Name, Projektleiter mit eigenem Abzeichen                    | `server/src/agentRuntime.ts`, `webview-ui/src/components/AgentCard.tsx`, `ToolOverlay.tsx`                            |
| Knöpfe                    | Neuer Chat, Kompaktieren, Neu starten mit Übergabe, Beenden                                                       | `webview-ui/src/components/`, `server/src/clientMessageHandler.ts`                                                    |
| Projektgedächtnis         | Vorlage für `.faust/`, Einrichtung per Knopf "Projekt einrichten"                                                 | neu: `server/src/projects/`                                                                                           |
| MCP Server                | `chat_starten`, `chats_auflisten`, `chat_beenden`                                                                 | neu: `server/src/mcp/`                                                                                                |
| Hub                       | Verbindungen zu Knoten, ID Zuordnung, Weiterleitung von Steuerbefehlen und Terminals                              | neu: `server/src/hub/`, `server/src/cli.ts` (Unterbefehl `hub`)                                                       |
| Kennzeichnung             | Farbe und Name pro Knoten an Karten und Figuren                                                                   | `webview-ui/`                                                                                                         |
| Sprache                   | Oberfläche und Intro auf Deutsch, auf dich zugeschnitten                                                          | `webview-ui/src/`, `IntroBubble.tsx`                                                                                  |

Neue Nachrichtentypen bleiben wie im Original standardmäßig nur mit Token erlaubt (`refuseReadOnly`).

## 6. Reihenfolge

Phase 1: ein Rechner, Projektleiter

1. Protokoll: `prompt`, `label`, `projectRole`.
2. Start mit Auftrag, mehrere beschriftete Chats pro Projekt.
3. `.faust/` Vorlage und Projektleiter Rolle.
4. Knöpfe: Neuer Chat, Kompaktieren, Neu starten mit Übergabe.
5. MCP Server für den Projektleiter.

Prüfung: Auf dem PC startest du einen Projektleiter, er startet zwei Arbeitschats, beide liefern ab, du leerst einen Chat, ohne dass Wissen verloren geht.

Phase 2: zwei Rechner

6. Hub Modus mit Knoten Laptop und PC, zunächst nur Anzeige.
7. Steuerung und Terminals über den Hub.
8. Kennzeichnung Privat und Arbeit, getrennte Flügel im Layout.

Prüfung: Am Handy siehst du Agenten von Laptop und PC im selben Büro und tippst in beide.

Phase 3: Raspberry Pi

9. Hub auf den Pi umziehen, als Dienst beim Start.

## 7. Besetzung (Vorschlag, jederzeit änderbar)

Passend zum Namen Faust Corp, aus Goethes Faust:

| Rolle                                               | Name                   | Persönlichkeit                                                                                                                                              |
| --------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projektleiter (Vorlage für jedes Projekt)           | Wagner                 | Gewissenhaft, ruhig, vergisst nichts. Fasst knapp zusammen, sagt klar, was offen ist und was er von dir braucht. Fragt nach, bevor er etwas Großes anstößt. |
| Arbeitschats                                        | Homunculus 1, 2, 3 ... | Im Labor erschaffen, für eine Aufgabe da, danach wieder weg. Arbeiten zielstrebig und schreiben am Ende ihre Übergabe.                                      |
| Prüfer (optional, später)                           | Mephisto               | Kritisch und ein wenig spitz. Sucht Schwächen in Plänen und Code, bevor du sie findest.                                                                     |
| Büroüberblick über alle Projekte (optional, später) | Lynkeus                | Der Türmer: "Zum Sehen geboren, zum Schauen bestellt". Kennt den Stand aller Projekte auf beiden Rechnern und sagt dir morgens, wo es brennt.               |

Jeder Projektleiter heißt im Büro "Wagner" plus Projekt, zum Beispiel "Wagner: Sport App". Willst du pro Projekt eine eigene Figur, gibt es genug Personal: Gretchen für den Roman, Marthe für die Website und so weiter.

## 8. Offene Punkte

1. Freigaben: Was darf der Projektleiter allein? Vorschlag: Chats starten und beenden darf er allein, Pushes in echte Repos und alles, was nach außen geht, nur mit deiner Zustimmung.
2. Arbeitgeber: Ist es erlaubt, dass Arbeitssessions im privaten Büro angezeigt und gesteuert werden?
3. Name: Bleibt das Produkt "Faust Corp", und soll der CLI Befehl `faust-corp` heißen?
