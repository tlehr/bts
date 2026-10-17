# Gesicherter Stand: bts-context-v1

Sicherung vom 17.10.2026, Kennung `20261017T085739Z`. Beide Repositories verwenden den zusammengehörigen **lokalen, annotierten Tag `bts-context-v1-stable`**. Der Tag wird erst nach Abschluss der unten protokollierten Prüfungen angelegt. Es wird nichts gepusht.

## Code und Kompatibilität

| Bestandteil | Lauffähiger Code-Commit | Branch vor den Experimenten |
| --- | --- | --- |
| BTS | `b97808f985f627494469d49bcfc9c1296ce0942e` | `feat/localTts` |
| Sprachserver | `a0bedd8703ce0d1ad0214caf3fa5566a06d4191d` | `feat/localTts` |

Die Sicherungscommits ergänzen diese Dokumentation und das bereinigte [Versionsmanifest](bts-context-v1-baseline.json). Im BTS wird außerdem ausschließlich ein veralteter Test an den bereits vorhandenen dateibasierten Testclient-Export angepasst; der produktive Code bleibt bytegleich zum oben genannten Stand. Der jeweilige Tag verweist auf den vollständigen Sicherungsstand. Die Annotation beider Tags nennt die exakten beiden Tag-Zielcommits. Der BTS hat das Remote `git@github.com:tlehr/bts.git`; im Sprachserver ist kein Remote eingetragen. Es gab zuvor keine Tags.

Die zusätzliche Entwicklungs-/Testabhängigkeit `bts-testclient` wird mit Commit `cbba35510eac71616c3abb47f7d0d746cab3b18f` als eigenes lokales Bundle erhalten. Ihr dateibasierter Export ist der Grund für die reine Testkorrektur: Der alte Test erwartete ein Array und scheiterte reproduzierbar bei `report.traces[0]`. Der korrigierte Test liest denselben Export über dessen Streaming-Schnittstelle und prüft weiterhin die tatsächliche letzte Revision und die Deduplizierung. Das Testclient-Repository selbst wird nicht verändert.

Die laufende API wurde authentifiziert und ausschließlich lesend geprüft: `kitten_cpp`, `KittenML/kitten-tts-2`, Modellrevision `f2eee74f4467855ad58fe16f1fb7b7df473263fd`, Strategie `bts-context-v1`. Ihre Synthesekonfiguration stimmt mit der im BTS-Cache gespeicherten Identität überein (`3e5e1815b0336cbff90930907cef159c4a7ce9d7ea18f744cde8433934c9768d`). Die regulären API-Tests und die BTS/FastAPI/Chrome-Integration prüfen den gemeinsamen Vertrag, Quellen, Schnitte, Cache und höchstens einen offenen API-Auftrag.

Der Sprachserver hat Paketversion **1.0.0**. Der native Kitten-Quellstand ist `1ce0bb504e5452795b52ca9a3c3950e982d82bb1`, mit dem vorhandenen CPU-Patch; Modell `model-tq2_1.gguf`, Decoder `default`. Die Vorbereitung verwendet `kittenml 0.9.4` und Torch `2.9.1+cpu`. Das Manifest enthält die tatsächlichen Worker-, Modell-, Decoder-, Bibliotheks- und Sprecherprofil-Hashes. Es sind keine Referenz-WAVs oder Zugangsdaten im Manifest enthalten.

## Stimmen und Synthese

- `hallensprecher` und `hallensprecherin`, jeweils Profilversion `1`, Sprache `de-DE`, eigene Referenz-WAV und bestätigtes Transkript. WAV-/Transkript-Hashes stehen im Manifest; die privaten Dateien bleiben außerhalb von Git.
- Zentral im gesicherten Turnier: `auto` (lokaler Server mit Browser-Fallback), `hallensprecher`; 38 Ausspracheersetzungen, deren Version durch einen SHA-256 dokumentiert ist. Der private Turnierexport bewahrt die tatsächlichen Ersetzungen auf.
- Temperatur `0.8`, top-k `50`, top-p `0.8`, min-p `0`, Wiederholungsstrafe `1.1`/Fenster `50`, Run-Strafe `1.3`/Grace `10`, maximal `1000` neue Tokens; Textteilung `380` Zeichen, Zwischenraum `0.16 s`.
- Vier Modell- und vier Decoder-Threads. Kontextquellen Seed `42`, begrenzter Team-Kontext-Fallback Seed `43`. Zahlenausschreibung `de-numbers-v1` im BTS, Anzeige mit Ziffern.
- Vorbereitete Wiedergabe: Hallensprecher `1.155`, Hallensprecherin `1.05`; die vorhandenen quellengebundenen Korrekturen zu D05, D08 und D12 bleiben erhalten. Tempo, Randstille, Fades und Wortgrenzen sind in `context-tts.md` beschrieben.

## Lokale private Sicherungen

Die Sicherungen liegen jeweils unter:

```text
/home/tim/repos/bts/data/v1-freeze/20261017T085739Z/
/home/tim/repos/bts-sprachserver/data/v1-freeze/20261017T085739Z/
```

Diese Verzeichnisse sind von Git ausgeschlossen und privat zugänglich. Sie enthalten:

- Git-Bundles des ursprünglichen Code-Standes, später zusätzlich Bundles mit dem v1-Tag; Git-Status und die unveränderte Arbeitskopie-Differenz als `uncommitted.patch` samt Hash.
- Tatsächliche BTS-Konfiguration und Sprachserver-`.env`, API-Schlüsseldatei, Stimmenkonfiguration und Kopien der Referenz-WAVs. Zugangsdaten werden weder angezeigt noch committed.
- Geprüfte native Installation und Erkennungsmodell; unveränderte große Dateien werden mit Hardlinks erhalten. Das ist eine Sicherung auf demselben Datenträger, kein Ersatz für eine externe Sicherung.
- Sprachserver-SQLite mittels Online-Backup, unveränderte WAVs, BTS-Cacheindex und WAVs. Bestehende Dateien werden nicht überschrieben oder entfernt. Die Hardlinks benötigen keine zweite Kopie der Audiodaten.
- Private Online-Kopien der BTS-Daten und einen API-Turnierexport. Diese sind **kein transaktionsübergreifender Rücksetzpunkt eines weiterlaufenden Turniers**. Eine Code-Rückkehr darf aktuelle Ergebnisse nicht durch alte Turnierdaten ersetzen.
- Die historischen Hörlabordateien einschließlich der bevorzugten Variante 1, Varianten 5/6 und des korrigierten D05/D08/D12-Hörsatzes. Historische Frames bleiben an ihre damaligen WAV-Hashes gebunden.
- Testprotokolle und tatsächliche Laufzeit-/Paketmetadaten. Private Audios, Caches und Geheimnisse werden nicht nach Git übernommen.

Die beiden bereits vorgefundenen BTS-Änderungen bleiben in der ursprünglichen Arbeitskopie unverändert: ein zusätzliches `as` in `debug/README.md` und einfache statt doppelter Leerzeichen im Referenzabsatz des Arbeitsdokuments. Beide sind separat im Patch gesichert und werden nicht als unbekannte Änderungen mitcommitted. Der Referenzabsatz widerspricht damit seinem Begleittext und der vollständigen Vorlage. Produktiver Code und der historische Hörtest verwenden weiterhin die gesicherte bisherige Fassung.

## Tests und bekannte Grenzen

| Prüfung am gesicherten Stand | Ergebnis |
| --- | --- |
| Sprachserver, `.venv/bin/python -m pytest -q` | 108 bestanden, zwei teure Modelltests ausdrücklich nicht aktiviert |
| BTS/FastAPI/Chrome, `BTS_SPEECH_INTEGRATION=1 mocha test/test_speech_end_to_end.js` | 37 bestanden: 20 mitgeladene Texttests und 17 Browser-Integrationsfälle |
| Vollständige BTS-Suite vor der Testkorrektur | 1.168 bestanden, 17 opt-in Fälle nicht aktiviert; der oben beschriebene veraltete Trace-Test scheitert |
| Vollständige BTS-Suite nach der Testkorrektur | 1.168 bestanden, 17 opt-in Fälle nicht aktiviert; ein Testclient-Benchmark überschreitet sein festes 15-Sekunden-Limit |
| Derselbe Benchmark allein, unverändertes Zeitlimit | Bestanden in 9,230 Sekunden |
| Trace-Tests nach der reinen Kompatibilitätskorrektur | 19 bestanden |
| ESLint der Testkorrektur; `git diff --check` | Bestanden |

Es wird kein durchgehend grüner vollständiger Gesamtlauf behauptet: Der reproduzierbare Exportfehler ist als reine Testanpassung behoben; der einzelne Benchmark-Timeout trat im Gesamtlauf auf und ließ sich allein nicht reproduzieren. Die ursprünglichen Fehlprotokolle werden ebenso wie die Wiederholungen aufbewahrt. Die Sprachausgabe-Integration ist separat vollständig grün. Die Protokolle heißen unter anderem `bts-tests.log`, `speech-tests.log`, `browser-tests.log`, `trace-tests-fixed.log` und `benchmark-recheck.log` in den privaten Sicherungen.

Beim Snapshot meldete die laufende API `ready` und historische fehlgeschlagene Jobs (`492`, letzter gespeicherter Fehler `alignment_failed`). Das ist ein kumulativer Datenbankbefund und kein Nachweis, dass alle aktuellen Ansagen fehlgeschlagen sind. Wortgrenzen ungewöhnlicher Namen können weiterhin scheitern; die bestehenden begrenzten Kontext-/Einzelaufnahme-Fallbacks bleiben Teil von v1. Automatische Tests ersetzen keine Hörabnahme von Aussprache oder Sprachmelodie. Ein erfolgreicher Tag behauptet keine fehlerfreie Aussprache aller Namen.

Teile des Arbeitsdokuments, besonders Abschnitt 10.4 und ältere Teile von `context-tts.md`, beschreiben einen früheren Planungshorizont. Für den gesicherten tatsächlichen Scheduler gelten der Code und der Abschnitt „Zusätzliche Vorbereitung bei Leerlauf“ in `local-tts-integration.md`: laufende Spiele nach Aufrufzeit, vorbereitete Spiele nach Vorbereitungsaufrufzeit; vollständige benötigte Pakete sofort, alle weiteren Gruppen nur bei Leerlauf. Alle übrigen Tabletbediener sind dessen letzte Gruppe. Die sechs Balkenkategorien sind ebenfalls dort dokumentiert. Diese Sicherung korrigiert weder Ansagetexte noch Scheduler.

## Wiederherstellung ohne Überschreiben der Arbeitskopie

Zuerst beide Tags prüfen:

```bash
git -C /home/tim/repos/bts show bts-context-v1-stable --no-patch
git -C /home/tim/repos/bts-sprachserver show bts-context-v1-stable --no-patch
```

Für eine getrennte Prüfung neue, noch nicht existierende Zielpfade verwenden:

```bash
git -C /home/tim/repos/bts worktree add --detach /pfad/zum/bts-v1 bts-context-v1-stable
git -C /home/tim/repos/bts-sprachserver worktree add --detach /pfad/zum/sprachserver-v1 bts-context-v1-stable
```

Falls die ursprünglichen Repositories fehlen, zunächst die lokalen `repository-tagged.bundle` mit `git bundle verify` prüfen und daraus in neue Verzeichnisse klonen. Für die vollständige ursprüngliche Dokument-Arbeitskopie kann anschließend der jeweilige gesicherte Patch mit `git apply --check` geprüft und in der neuen Arbeitskopie angewendet werden. Das geschieht niemals ungeprüft im laufenden Checkout.

Abhängigkeiten anhand der mitgetaggten `package-lock.json` beziehungsweise `requirements-*.lock` installieren; die nativen Build-/Modellrevisionen müssen dem Manifest entsprechen. Private Konfiguration, Sprecherreferenzen und native Installation aus der Sicherung in einen **separaten** Prüfpfad übernehmen oder auf die erhaltene unveränderte Installation zeigen. Absolute Dateipfade ausdrücklich prüfen; API-Schlüssel bleiben lokal. Der Kitten-Integritätscheck muss die dokumentierten Hashes bestätigen. Ein CPU-spezifisches Binary wird auf anderer Hardware anhand der gepinnten Quellen neu gebaut und erneut geprüft.

BTS- und Sprachserver-Code immer als Paar prüfen; v1 ist erfolgreich verfügbar, wenn `/health` die gesicherte Modell-/Kontextidentität meldet und die vorhandenen Tests bestehen. Beim Wechsel eines laufenden Dienstes zuerst dessen regulären Stop-/Startweg verwenden; keine zweite Instanz auf derselben Datenbank und kein `reset --hard`. Aktuelle Turnierdaten und inzwischen erzeugte Cachedateien erhalten. Ein abweichender Cache-Schlüssel darf keine vorhandene Quelldatei überschreiben.

## Grenze zu v2

Erst nach erfolgreicher Sicherung werden getrennte Worktrees mit Branch `feat/localTts-context-v2-experiments` angelegt. Neue Runner, Messdaten, WAVs und Schnittvorschläge bleiben dort beziehungsweise in eigenen privaten Labordaten. Die produktiven Checkouts verbleiben auf `feat/localTts`, ihre API und `bts-context-v1` werden nicht auf v2 umgestellt. D13, D15 und Anwesenheitskontrolle werden nicht verändert.
