# Vergleich mit einem unveraenderten alten Server

`npm run debug:reference -- --dry-run` zeigt die geplanten Commits und Einstellungen.
`npm run debug:reference` vergleicht standardmaessig zwei echte Serverlaeufe von je
zehn Minuten: `cf73f0a731dd26aac4fb360a71b5d2b165deef0f` und den aktuellen Commit.
Dieser Baseline-Commit ist der direkte Vorgaenger von `14cd5aa` ("Optimize BTP sync
and no-match cascades"). Sein Server benutzt noch die globale Update-Queue.
`91f07b9` ist dagegen nur der Ausgangspunkt der zuletzt uncommitteten Arbeiten und
enthaelt bereits die am 4. Oktober committeten Optimierungen.

Der Vergleich legt unter `/tmp/bts-reference-*` zwei separate, unveraenderte
Git-Checkouts und Kopien derselben Daten an. Er startet ausschliesslich eigene
Prozesse auf Port 4540, prueft vorher den Port und beendet nur diese Prozesse.
Der Live-Server und seine Daten werden nicht zurueckgesetzt. Aendert sich die
Quelldatenbank waehrend des Kopierens, wird der Vergleich abgebrochen.

Externe BTP-Verbindungen werden **nur in den Kopien** deaktiviert. Dieser erste
Referenzvergleich misst daher Punkte, Vorbereitung/Aufrufe und Admin-Antworten
ohne parallele externe BTP-Syncs; er ersetzt keinen Vergleich mit reproduzierbar
zugespielten BTP-Daten. Beide Seiten nutzen den gleichen Diagnosemodus ohne
Serverprobes. Queue-Daten bleiben ausdruecklich nicht verfuegbar. Der Testclient
verwendet die aktuellen Empfangsmessungen auch mit dem alten Server; der Server
wird nicht um neue Telemetrie oder Optimierungen erweitert.

Parameter: `--bts-dir PATH`, `--source DATA`, `--refs COMMIT,COMMIT`, `--port N`,
`--tournament KEY`, `--expected-matches N`, `--seed TEXT`. Fuer einen kurzen
Protokoll-Smoke: `--runtime-ms 15000`; nur 600000 ms nutzt die komplette feste
Testsequenz mit Pause. Der Bericht enthaelt volle Commit-IDs, Quellfingerprints,
Node-Version/CPU, Client-Quellhash, Laufzeit und Empfangswerte je Server. Abweichende
Anfangszustaende werden als `identical_initial_states: false` ausgewiesen und
duerfen nicht als streng kontrollierter Vergleich bezeichnet werden.

## Historische Geraetezuordnung

Der alte Server identifiziert Panels anhand der letzten Stelle ihrer IP-Adresse
und ignoriert die vom Client mitgeschickte TV-ID. Ohne Anpassung teilen sich
simulierte Panels auf localhost dieselbe ID. Der Vergleich setzt daher auf beiden
Seiten `--legacy-loopback-devices`: TVs und Tablets erhalten getrennte
IPv4-Loopback-Adressen und passende IDs. Dies ist eine Clientanpassung;
der archivierte Server bleibt unveraendert. Fuer normale Live-Tests ist die
Option ausgeschaltet. Maximal 125 Felder, nur lokale IPv4-Server.

Der erste Zehn-Minuten-Lauf des alten Servers war deswegen fuer TV-Latenzen
ungeeignet: nur 96 von 1175 Updates wurden zugeordnet. Dies war ein
Testaufbaufehler, kein belegter Zustellverlust des historischen Servers.
Die gueltige optimierte Langzeitmessung wurde behalten; nur der ungueltige
Baseline-Lauf wurde mit korrigierter Geraetezuordnung wiederholt. Ein eigener
30-Sekunden-Vergleich von altem und aktuellem Server erfasste jeweils alle
70 Updates bei TV und Admin. Details und Werte im
[Ergebnisbericht vom 11. Oktober](performance_results_2026-10-11.md).
