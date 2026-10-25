# Tempo vor dem Turnier prüfen

Nach der Sprachvorbereitung lässt sich der vorhandene lokale Vorrat prüfen:

```sh
python3 scripts/tts-tempo-audit.py \
  --cache data/speech-cache \
  --output /tmp/bts-tempo-pruefung
```

Der Ausgabeordner muss neu sein. Python benötigt nur seine Standardbibliothek;
die Aussprache von Zahlen übernimmt das vorhandene Node-Modul des BTS.
Optional begrenzt `--voice hallensprecher` oder `--voice hallensprecherin` die
Auswahl. Die Prüfung öffnet keine Serververbindung, generiert nichts und
schreibt nicht in den Cache.

`index.html` enthält Runden, Platzierungen und ausgewählte Vergleichsbausteine.
Die Seite zeigt, ob eine längere Kontextquelle vorliegt. Ein Hörtempo-Regler
vergleicht dieselbe Aufnahme mit erhaltener Tonhöhe; er beeinflusst nur die
Prüfseite. Sichtbare Beispiele werden als unveränderte WAV-Kopien beigefügt.
`report.json` enthält alle Messwerte, einschließlich der nicht in der Tabelle
gezeigten Aufnahmen. Gespeicherte ältere Vorräte können neben neuen Varianten
derselben Wörter vorkommen; die Kontextquelle macht den Unterschied sichtbar.

Gemessen werden Dauer, hörbare Zeitspanne, grob aktive Audiozeit, Randstille
und innere Pausen. Für einen Vergleich werden Ziffern zuerst wie bei der
echten Synthese ausgeschrieben. Deutsche Vokalgruppen liefern eine grobe
Silbenschätzung. Als Vergleich dienen Feld-, Spielnummern- und
Disziplinaufnahmen derselben Stimme. Namen werden nicht anhand einer
pauschalen Tempovorgabe beurteilt.

Ein deutlich niedrigerer relativer Wert oder eine lange innere Pause erzeugt
den Hinweis **Tempo prüfen**. Er ist kein Nachweis eines Aussprachefehlers.
Gerade kurze Wörter, Zahlwörter und die beabsichtigte Betonung brauchen eine
Hörprüfung. Es gibt keine automatische pauschale Beschleunigung.

Der [Hörvergleich vom 24.10.2026](../debug/speech-tempo-2026-10-24/context-preflight/index.html)
enthält drei tatsächlich neu erzeugte Kontextproben. Bei „Spiel um Platz fünf
und sechs“ verkürzt sich die Dauer bei gleichem Tempofaktor von 2,74 auf
1,61 Sekunden. Diese einzelne Messung ersetzt keine Hörfreigabe für andere
Texte, Stimmen oder neu gezogene Synthesevarianten.
