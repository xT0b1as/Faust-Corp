# Faust Corp: Anleitung

Stand: 30.10.2026. Alle sieben Punkte aus dem Umbauplan sind umgesetzt.

## Installieren (auf jedem Rechner)

```bash
git clone https://github.com/xT0b1as/Faust-Corp
cd Faust-Corp
npm install
npm run build
npm link          # danach gibt es den Befehl faust-corp
```

Für eigene Commits braucht das Repo außerdem `gitleaks` (Prüfung auf versehentlich eingecheckte Schlüssel).

## Ein Rechner

```bash
faust-corp --port 3100
```

Die ausgegebene Adresse mit `?token=...` im Browser öffnen. Beim ersten Start fragt das Büro, ob es die Hooks in `~/.claude/settings.json` eintragen darf.

## Am Handy über Tailscale

```bash
faust-corp --port 3100 --allowed-host <rechner>.<tailnet>.ts.net
tailscale serve --bg 3100
```

Am Handy `https://<rechner>.<tailnet>.ts.net/?token=...` öffnen und auf den Homescreen legen. Nie `--host 0.0.0.0` verwenden. Die Adresse mit Token ist ein Schlüssel.

## Laptop und PC in einem Büro (Hub)

1. Auf jedem Rechner einen normalen Server starten (wie oben, jeweils mit eigenem Claude Account).
2. Den Hub starten, auf einem der Rechner oder später auf dem Raspberry Pi:

```bash
faust-corp hub --port 3200 \
  --node pc=https://pc.<tailnet>.ts.net/?token=<token-vom-pc> \
  --node laptop=https://laptop.<tailnet>.ts.net/?token=<token-vom-laptop>
```

Ohne Tailscale auf einem Rechner geht ein SSH Tunnel: `ssh -N -L 3101:127.0.0.1:3100 arbeitslaptop` und dann `--node laptop=http://127.0.0.1:3101/?token=...`.

Mit `--public-url https://<hub>.<tailnet>.ts.net` (die Adresse, unter der die Rechner den Hub erreichen) bekommt Sekretär Lynkeus zusätzlich den Überblick über alle Rechner: Lagebericht, Projektliste und Weiterleiten an jeden Wagner, egal auf welchem Rechner.

Der Hub braucht Node.js 22 oder neuer, aber kein Claude. Figuren zeigen ihren Rechner (`@pc`, `@laptop`), Ordner tragen ein Abzeichen, beim Anlegen wählst du den Rechner aus. Ist ein Rechner aus, verschwinden seine Figuren und kommen beim Wiederverbinden zurück.

## Benachrichtigungen aufs Handy

Mit `--ntfy https://ntfy.sh/<eigenes-geheimes-thema>` meldet sich das Büro über die App ntfy, wenn jemand auf deine Freigabe wartet oder Wagner bzw. Lynkeus fertig sind. Meldungen innerhalb von 20 Sekunden kommen als eine Nachricht. Das Thema wie ein Passwort wählen, jeder mit dem Namen kann mitlesen; ein eigener ntfy Server im Tailnet geht auch. Mit Hub nur am Hub setzen, sonst kommt alles doppelt.

## Dauerbetrieb

Die Chats eines Rechners hängen an seinem Server: Startet der Server neu, enden sie. Ihr Wissen bleibt in `.faust/`, also startest du danach einfach Wagner wieder. Damit der Server mit dem Rechner startet und nach einem Absturz neu anläuft, liegen Vorlagen in `scripts/faust-corp/`:

- Linux und Raspberry Pi: `faust-corp.service` (Knoten) und `faust-corp-hub.service` (Hub), als systemd Dienst des Benutzers. Die Einrichtung steht oben in den Dateien.
- macOS: `de.faustcorp.node.plist` für launchd.
- Windows: `install-windows-task.ps1` legt eine geplante Aufgabe an, die beim Anmelden startet.

In allen Vorlagen `CHANGE-ME` durch deinen Rechnernamen bzw. Benutzer ersetzen.

### Raspberry Pi als Hub

1. Raspberry Pi OS (64 Bit) und Tailscale installieren, `sudo tailscale up`.
2. Node.js 22 installieren, zum Beispiel über nvm: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash`, dann `nvm install 22`.
3. Repo klonen, `npm install`, `npm run build`.
4. `~/.pixel-agents/nodes.txt` mit einer Zeile pro Rechner anlegen (`pc=https://pc.<tailnet>.ts.net/?token=...`), dann `chmod 600 ~/.pixel-agents/nodes.txt`.
5. `faust-corp-hub.service` einrichten und `tailscale serve --bg 3200` ausführen.
6. Am Handy `https://<pi>.<tailnet>.ts.net/?token=...` öffnen. Den Token zeigt `journalctl --user -u faust-corp-hub` beim Start.

Claude muss auf dem Pi nicht installiert sein.

## Im Büro

Alles Folgende findest du unter "+ Agent":

- Sekretär Lynkeus: Er hat den Überblick über alle Projekte, gibt Lageberichte und reicht Aufträge an die Projektleiter weiter. Er läuft auf dem ersten verbundenen Rechner.
- - Abteilung: Du gibst Name, Ordner, Rechner und Konto an. Das Büro baut einen Raum mit zwei Arbeitsplätzen an und setzt Wagner als Projektleiter ein.
- - Directory: Hier legst du einen Ordner ohne eigenen Raum an. Das Feld "Claude Konto" nimmt einen Konfigurationsordner wie `~/.claude-arbeit` für einen zweiten Account. Einmal anmelden geht mit `CLAUDE_CONFIG_DIR=~/.claude-arbeit claude` und dann `/login`.
- In jeder Ordnerzeile gibt es drei Knöpfe:
  - Projektleiter: richtet beim ersten Mal `.faust/` ein und startet Wagner.
  - Neuer Chat mit Auftrag: startet einen Chat mit Name und Auftrag.
  - Bearbeiten: ändert den Ordner.

An einem ausgewählten Agenten:

- Neuer Chat: startet einen weiteren Chat im selben Projekt.
- Kompakt: schickt `/compact`.
- Neustart: Der Agent schreibt eine Übergabe, wird geleert und liest die Übergabe wieder ein.

Laufen (unten in der Mitte): Damit bewegst du dich mit deiner eigenen Figur durchs Büro.

- Bewegen: mit Pfeiltasten oder WASD, am Handy durch Tippen auf den Boden.
- Steht ein Agent nah genug, erscheint "Sprechen" (oder du drückst E). Das öffnet sein Terminal.

## Projektgedächtnis `.faust/`

```
.faust/projekt.md        Wissen, Ziele, Regeln, Entscheidungen
.faust/stand.md          aktueller Stand, pflegt Wagner
.faust/aufgaben/         eine Datei pro Aufgabe
.faust/uebergaben/       Übergaben vor Neustart oder Ende eines Chats
.faust/rollen/           Rolle von Wagner und Regeln für jeden Chat
```

`CLAUDE.md` im Projekt bekommt einmalig einen Block, der diese Dateien einbindet. Dadurch kennt jeder Chat Wissen und Stand, auch einer, den du selbst startest.

Wagner hat eigene Werkzeuge (MCP Server `faust`):

- `chat_starten` startet einen Arbeitschat. Ohne Namen heißen sie Homunculus 1, 2, 3 und so weiter.
- `chats_auflisten` zeigt die laufenden Chats.
- `chat_nachricht` schickt einem Chat eine Nachricht.
- `chat_beenden` beendet einen Chat.

Er darf Chats allein starten und beenden. Pushes und alles, was nach außen geht, nur mit deiner Zustimmung.

## Bekannte Grenzen

- Sessions eines zweiten Kontos laufen ohne Hooks, ihr Status kommt aus den Session Dateien und ist etwas langsamer.
- Ohne `--public-url` sieht der Sekretär im Hub nur den Rechner, auf dem er läuft.
- Getestet ist alles mit Unit Tests und im Browser mit einem Platzhalter statt des echten `claude`. Der erste echte Durchlauf mit Claude Code steht noch aus. Achte dabei besonders auf "Neustart" (Eingaben ins Terminal) und auf die Freigabe der MCP Werkzeuge.
