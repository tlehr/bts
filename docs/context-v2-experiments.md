# Kontext-v2: isolierte Untersuchung

Produktiv bleibt `bts-context-v1`. Die [gesicherte v1](bts-context-v1-baseline.md) liegt in beiden Repositories auf dem annotierten lokalen Tag `bts-context-v1-stable`. Der BTS-Tag verweist auf `23922ac5c6f81505552c269eef6d50de58775089`, der Sprachserver-Tag auf `cba19aeaa117df6dcb3c5157fa8b11278bbba006`. Die zwei vorgefundenen Dokumentänderungen liegen weiterhin im ursprünglichen Checkout und zusätzlich in privaten Sicherungspatches. Es wurde nichts gepusht.

Dieser Branch `feat/localTts-context-v2-experiments` liegt ausschließlich in der separaten Arbeitskopie `data/context-v2-worktree`. Er erweitert die produktiven Ansagetexte, Kontextstrategie, Prioritäten oder API nicht. Die Anwesenheitskontrolle, D13 und D15 werden nicht verändert.

## Erste Messbasis

`scripts/tts-context-benchmark-plan.js` exportiert die **bestehende** v1-Stückelung für D01, D05, D08 und D12. Beide Feldpositionen, vollständige Namen, D05-Pausen, D08-Klapptafel und die gemeinsame D12-Klausel stammen unmittelbar aus dem v1-Renderer. Jede Montage erhält eine vollständige Referenz mit denselben gesprochenen Inhalten. Die echte Zahlenausschreibung und optional die 38 privaten Ausspracheersetzungen werden übernommen.

Der erste Plan umfasst neun vollständige Quelltexte mit zusammen 1.300 gesprochenen Zeichen, 13 Wiedergabestücke und acht Fälle. Das sind geplante Mengen, noch keine Aussage über erfolgreiche Schnitte oder Inferenzzeit. Die bevorzugte historische Variante 1 und die Varianten 5/6 werden separat erhalten. Ihre festen Schnittstellen sind ausschließlich für ihre jeweils geprüften WAV-Hashes gültig.

Der Runner liegt im Sprachserver-Experimentierworktree unter `bts_sprachserver/context_lab.py`; Bedienung und Protokollschema beschreibt dessen `docs/context-lab.md`. Er verwendet die gleiche native Kitten-Anbindung, eine eigene Arbeitsablage und einen eigenen Audio-/Schnittcache. Der Produktivserver bleibt unberührt. Reale Walltimes unter möglicher paralleler Produktivlast werden als solche gekennzeichnet. Kalte und rein cachebasierte warme Läufe sind getrennt.

Die isolierte Arbeitskopie benötigt die bestehenden ignorierten Abhängigkeiten: `node_modules` und `static/bup/dev`. BUP steht unverändert auf `96c680e08cdb32c7c53d490f0c538fac5e287003`; ein privates Bundle liegt neben den v1-Sicherungen. Dieser zusätzliche Wiederherstellungshinweis wurde nach Erkennen der Arbeitskopie-Abhängigkeit ergänzt, ohne einen vorhandenen Tag zu überschreiben. Der private Sicherungsmanifest enthält den exakten Stand.

Die weiteren Experimente A–D beginnen erst nach dieser gemessenen v1-Messbasis. Ihre Ergebnisse und eine spätere Integrationsentscheidung werden hier ergänzt. Technische Grenzprüfung und gemessene Laufzeit werden stets von einer noch ausstehenden subjektiven Hörbewertung getrennt.
