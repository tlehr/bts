# Kontext-v2: isolierte Untersuchung

Produktiv bleibt `bts-context-v1`. Die [gesicherte v1](bts-context-v1-baseline.md) liegt in beiden Repositories auf dem annotierten lokalen Tag `bts-context-v1-stable`. Der BTS-Tag verweist auf `23922ac5c6f81505552c269eef6d50de58775089`, der Sprachserver-Tag auf `cba19aeaa117df6dcb3c5157fa8b11278bbba006`. Die zwei vorgefundenen Dokumentänderungen liegen weiterhin im ursprünglichen Checkout und zusätzlich in privaten Sicherungspatches. Es wurde nichts gepusht.

Dieser Branch `feat/localTts-context-v2-experiments` liegt ausschließlich in der separaten Arbeitskopie `data/context-v2-worktree`. Er erweitert die produktiven Ansagetexte, Kontextstrategie, Prioritäten oder API nicht. Die Anwesenheitskontrolle, D13 und D15 werden nicht verändert.

## Erste Messbasis

`scripts/tts-context-benchmark-plan.js` exportiert die **bestehende** v1-Stückelung für D01, D05, D08 und D12. Beide Feldpositionen, vollständige Namen, D05-Pausen, D08-Klapptafel und die gemeinsame D12-Klausel stammen unmittelbar aus dem v1-Renderer. Jede Montage erhält eine vollständige Referenz mit denselben gesprochenen Inhalten. Die echte Zahlenausschreibung und optional die 38 privaten Ausspracheersetzungen werden übernommen.

Der gemessene v1-Plan umfasst neun vollständige Quelltexte mit zusammen 1.300 gesprochenen Zeichen, 13 Wiedergabestücke und acht erfolgreich exportierte Fälle. Tatsächlich erzeugt wurden 100,520 s Originalaudio in 446,510 s Inferenz, RTF 4,442; Modellladen separat 2,175 s. Der warme Durchlauf brauchte null neue Synthese und kein Modellladen. Die bevorzugte historische Variante 1 und die Varianten 5/6 bleiben bytegleich erhalten und liegen zusätzlich als separate pegelangepasste Hörkopien vor. Ihre festen Schnittstellen gelten ausschließlich für ihre jeweils geprüften WAV-Hashes.

Der Runner liegt im Sprachserver-Experimentierworktree unter `bts_sprachserver/context_lab.py`; Bedienung und Protokollschema beschreibt dessen `docs/context-lab.md`. Er verwendet die gleiche native Kitten-Anbindung, eine eigene Arbeitsablage und einen eigenen Audio-/Schnittcache. Der Produktivserver bleibt unberührt. Reale Walltimes unter möglicher paralleler Produktivlast werden als solche gekennzeichnet. Kalte und rein cachebasierte warme Läufe sind getrennt.

Die isolierte Arbeitskopie benötigt die bestehenden ignorierten Abhängigkeiten: `node_modules` und `static/bup/dev`. BUP steht unverändert auf `96c680e08cdb32c7c53d490f0c538fac5e287003`; ein privates Bundle liegt neben den v1-Sicherungen. Dieser zusätzliche Wiederherstellungshinweis wurde nach Erkennen der Arbeitskopie-Abhängigkeit ergänzt, ohne einen vorhandenen Tag zu überschreiben. Der private Sicherungsmanifest enthält den exakten Stand.

## Ergebnisse A–D

Erst nach der v1-Messbasis wurden A–C synthetisiert: 13 neue Quellen, 688 Zeichen einschließlich Kontext, 56,600 s Originalaudio, 336,611 s Inferenz, RTF 5,947; zusätzlich wurde eine schon gemessene v1-Quelle verwendet. Vier der ursprünglichen 43 Fälle waren wegen zweier nicht zuverlässig ausgerichteter Grenzen eines fremdsprachigen Doppelteams unvollständig. Kein Synthesefehler wurde versteckt.

Der verfeinerte Plan ergänzt acht Schnitt-/Montagefälle ohne neue Quelltexte. Mit einem ausdrücklich eingeschalteten **Laboranker** und vollständig gesperrter neuer Synthese entstanden 51 exportierbare Fälle: A 33, B neun, C neun. Ein Ausschnitt nach „gegen“ hat keine sichere Pause und bleibt mit seinen zwei Montagen sichtbar als manueller Grenzkandidat markiert. Er zählt nicht als automatisch freigegebener Schnitt. V1 verwendet diesen Anker nicht.

| Untersuchung | Technischer Befund | Entscheidung |
| --- | --- | --- |
| A: Johann Bjarne Schöttmer, Lena Fischer, Muhammad Sytsh Abdulquddus jeweils vor/nach „gegen“ | Beide Positionen, „gegen“ und Bündelung Name+„gegen“ aus jeweils einer Quelle; vollständige verschiedene Begegnungen und isolierte Namen als Referenzen | Positionsprofile getrennt halten; Natürlichkeit und kontrastive Betonung noch offen |
| B: zwei tatsächliche Doppelteams | Beide Namen und „und“ bleiben zusammen; ein aktiver Schnittkandidat nach „gegen“ | Keine flächendeckende Vorbereitung oder produktive Ankerfreigabe |
| C: Beispielspiel 189 und tatsächliches Spiel 131 | B03, B04, B05 sowie B04+B05 und Teams aus denselben Quellen; Rundentext aus anderem Kontext probeweise wiederverwendet | Längere Bündelung vorziehen, vollständiger v1-Spielblock bleibt Referenz |
| D: vorhandener v1-Cache | 591 passende ursprüngliche Quellen; 1.647 gültige quellengebundene Schnittaudits aus 590 Quellen; 539 Quellen mit mehreren Schnitten | Vorhandene Donoren zuerst nutzen; keine hypothetischen Rollen-/Hallenquellen durchgenerieren |

Der reine warme A–C-Lauf hatte 14 Quell- und 54 Schnittcache-Treffer, null neue Synthese und kein TTS-/Alignment-Modellladen. Ein gesonderter repräsentativer Teamwechsel montierte zwei Varianten nach 5,747 bzw. 5,898 s Laborzeit ohne neue Synthese. Die danach erzeugte vollständige v1-Kontrolle brauchte eine neue Quelle mit 134 Zeichen und 10,080 s Originalaudio in 58,093 s Inferenz (RTF 5,763), bereit nach 66,847 s. Diese Bereitschaftszeiten gelten für die dokumentierte Laborreihenfolge und enthalten Datei-/Identitätsprüfung; es ist kein gleichzeitiger Live-BTS-Latenzvergleich.

Die Inventur des gespeicherten Turniers zeigt eine wichtige Grenze: Für 412 bekannte Spiele benötigt v1 412 Spielquellen mit 55.654 Zeichen. Eine hypothetische v2-Vorbereitung aller Köpfe plus aller tatsächlichen Team-Wiederholungsquellen ergäbe 667 Quellen mit 66.572 Zeichen, **19,6 % mehr Text**. Das ist eine Textmengenrechnung, kein gemessener Ganzturnier-Kaltlauf. Die 107 unbekannten/nicht verwendbaren Konstellationen werden nicht erfunden. Bei unverändertem warmem Bestand benötigen beide Strategien null neue Quellen.

## Reproduktion und Hörvergleich

`scripts/tts-context-v2-plan.js` erzeugt A–C aus demselben privaten Turnierexport und dem Baseline-Plan. `--warm-change plan.json` erzeugt den repräsentativen Änderungsvergleich, ohne den Turnierstand zu verändern. Die Planprüfungen kontrollieren Zahlenausschreibung, echte Teams, getrennte Prosodiepositionen, Quellenidentität und das Fehlen kombinatorischer Vorräte.

Die ausführliche Auswertung, Tabellen aller Fälle, konkrete spätere Integrationsvorlage und Bedienbefehle liegen im **Sprachserver-Repository auf demselben Experimentierbranch** unter `docs/context-v2-evaluation.md` und `docs/context-lab.md`. Private Messungen liegen dort unter `data/context-lab`. `hoerpaket-context-v2/index.html` enthält 62 aktuelle Hörfälle plus die historischen Varianten 1/5/6; `hoerpaket-context-v2.zip` enthält die unveränderten Quellen, Rohschnitte, bearbeiteten Stücke, Hörkopien, Audits, Messberichte und Prüfsummen. Stimmenprofile, Zugangsdaten und private Worker-Verzeichnisse sind ausgeschlossen. Hörnotizen bleiben im Browser.

Vorschlag: v1 zunächst beibehalten; vor einer späteren v2 vorhandene geeignete Donoren indexieren, vollständige Spielblöcke und Rolle+Name als Standard erhalten, Positionsstücke gezielt nach tatsächlichem Bedarf einsetzen. Wiederholungsquellen brauchen einen belegten Nutzen und einen bestandenen Hörvergleich. Der Cache muss Quelle, Stimme, Modell-/Samplingidentität, Ausspracheversion, Prosodieposition und Verarbeitungsversion unterscheiden. Lange funktionierende Teile werden nicht allein für theoretische Wiederverwendung zerlegt. Queue und Prioritäten bleiben unverändert.

Technische Messung und Grenzprüfung bestätigen keine natürliche Sprachmelodie. Die Aussprache- und Klangbewertung der neuen Kombinationen steht ausdrücklich aus; sämtliche Fälle bleiben `subjective_quality: not-rated`.

## Prüfung

Die gezielten BTS-Sprach-/Plantests bestehen: **210 erfolgreich, 17 optionale Native-/Browserfälle ausgesetzt**; die 37 gemeinsamen Text-/FastAPI-/Chrome-Fälle der eingefrorenen v1 wurden zuvor separat erfolgreich ausgeführt. ESLint für die beiden Laborpläne und ihre Tests ist erfolgreich. Der Sprachserver-Gesamttest und der Hörexport sind in der ausführlichen Auswertung dokumentiert. Die Baseline-Datei benennt die Grenzen der vollständigen BTS-Testläufe offen.
