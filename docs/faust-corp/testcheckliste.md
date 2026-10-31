# Checkliste für den ersten echten Test

Auf einem Rechner mit Claude Code, nach `npm install`, `npm run build`, `npm link`.

1. `faust-corp --port 3100` starten, Adresse mit Token öffnen, Hooks erlauben.
2. "+ Abteilung": Name "Test", Ordner auf ein leeres Testverzeichnis.
   - Erwartet: Raum wird angebaut, Wagner startet im Terminal, liest `.faust/rollen/projektleiter.md` und begrüßt dich.
   - Prüfen: Fragt Claude nach Erlaubnis für den MCP Server `faust`? Wenn ja, notieren.
3. Wagner bitten: "Starte einen Chat, der eine Datei hallo.txt anlegt."
   - Erwartet: Wagner nutzt `chat_starten`, ein Homunculus 1 erscheint und legt die Datei an.
4. Wagner bitten: "Welche Chats laufen?" Erwartet: Antwort aus `chats_auflisten`.
5. Homunculus auswählen, "Neustart" drücken.
   - Erwartet: Er schreibt eine Übergabe in `.faust/uebergaben/`, danach erscheint `/clear`, danach liest er die Übergabe.
   - Prüfen: Bleibt es dieselbe Figur? Wird jede Eingabe abgeschickt oder bleibt Text in der Eingabezeile stehen?
6. "Kompakt" an Wagner drücken. Erwartet: `/compact` läuft.
7. "Sekretär Lynkeus" starten, fragen: "Was läuft gerade?" Dann: "Sag Wagner im Projekt Test, er soll den Stand aktualisieren."
8. "Laufen" einschalten, zu Wagner gehen, "Sprechen" drücken. Erwartet: Wagners Terminal öffnet sich.
9. Zweites Konto: `CLAUDE_CONFIG_DIR=~/.claude-zwei claude` einmal starten und anmelden. Dann einen Ordner mit Konto `~/.claude-zwei` anlegen und dort einen Chat starten.
   - Erwartet: Chat läuft mit dem zweiten Konto, die Figur zeigt Arbeiten und Fertig (etwas verzögert, ohne Hooks).
10. Hub: auf dem zweiten Rechner ebenfalls starten, dann `faust-corp hub --node a=<url> --node b=<url>`. Beide Rechner im Büro sehen, in beide Terminals tippen.

Was nicht wie erwartet läuft: Schritt und was im Terminal stand notieren.
