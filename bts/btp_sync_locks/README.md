# Sync lock planning

`match_changes.js` classifies changed match fields. Known display values
(`btp_group_rankings`) and player/official profile changes need
only the changed match lock. Player identities, check-ins, pause/availability
flags, court assignments, officials' identities/check-ins, scheduling, scoring,
results, bye links and unknown setup fields retain conservative expansion through
the captured player/court relation index. Insertions and deletions also expand.
Date values are compared by value. Explicit outgoing effect resources always
take precedence over the metadata shortcut.

The round label (`match_name`) and a player's regional association (`state`)
also retain expansion: they can affect tablet operator assignment after a game.

`resources.js` collects direct writes, effects and dependent matches into a
normalized lock list. Preparation, tablet operator, official and auto-call
domain locks remain held for all match work: assignment, check-in and finish
writers must still wait. Ordinary points on games related only through metadata
may proceed. Directly changed matches remain locked.

Before applying a plan, `btp_sync_plan.js` validates all setup dependency fields
even for matches without a lock. Pure points and player profiles are omitted
from this projection; check-ins, availability and preparation successor flags
are retained. A relevant change completed during planning or lock waiting
causes replanning. Existing point rebasing, rollback and external-effect rules
remain in effect. This module does not change bye propagation.

With `BTS_BTP_SYNC_TIMING=1`, `incremental_plan.lock_scope` reports:

- `direct_match_locks`: distinct matches written by the plan or named by court/
  tablet operator record changes.
- `additional_match_locks`: distinct remaining match locks added by relations
  or effects. Together these two counts equal `match_locks`.
- `local_only_changes`: match changes which need no relation expansion by
  themselves, including metadata, signatures and point-only changes.
- `expansion_reasons`: number of changed matches per dependency category.
  A match can have multiple reasons; these counts are not additive.
- `dependency_matches`: distinct matches contributed by `player`, `court` or
  `effect`. Contributions overlap each other and direct writes.
- `players` / `courts`: distinct relation keys expanded, including effects.

These counts explain scope, not the owner or exact hold time of a contended lock.

## Reihenfolgeänderungen und Auswahl-Lock

`resources.js` leitet die Locks aus den tatsächlichen Änderungen und Effekten
eines bereits berechneten Plans ab. `match_changes.js` bestimmt weiterhin die
abhängigen Spieler und Felder; deren Match-Referenzen erweitern die Sperrmenge.
Spielende, Freilose, Teilnehmer, Check-in, Profile und unbekannte Änderungen
behalten den bisherigen konservativen Umfang.

`ordering_only.js` erkennt ausschließlich Änderungen der Spielnummer und
`match_order`, einschließlich der Nummer in `btp_match_ids.nr`, des internen
Sync-Fingerprints und optionaler Anzeige-Ranglisten. BTP-Identitäten müssen
gleich bleiben. Alle Änderungen müssen in diese Klasse fallen; gemischte Pläne,
Einfügungen, Löschungen und externe Effekte bleiben konservativ. Zugelassen
sind nur passende Match-Edit-Benachrichtigungen und separat gesperrte Folgejobs.
Änderungen der angesetzten Zeit sind weiterhin keine reine Reihenfolgeänderung:
sie können Zulässigkeit und Vorbereitungsregeln beeinflussen.

Der Lock `selection:<Turnier>` schützt die automatische Kandidatenauswahl.
Solche Nummernänderungen benötigen die vier Zuweisungs-Locks nicht, wenn keine
Tabletbedienervergabe aktiv ist und die geänderten Spiele keine zugewiesenen
Offiziellen oder Tabletbediener enthalten. Andernfalls bleibt der bisherige
Umfang erhalten: diese Vergabe-/Freigabepfade können andere Match-Setups
mitschreiben. Die Diagnose unterscheidet `ordering_only`,
`ordering_with_allocation` und `full`.

Automatische Vorbereitung, deren Offiziellenvergabe und die manuelle
Ausführung einer berechneten Vorbereitungsauswahl erwerben `selection`.
Automatische Feldaufrufe verwenden auch außerhalb des Post-Sync-Pfads den
validierten Planner; dessen Commit hält `selection` und prüft den aktuellen
Datenstand erneut. Eine beim Warten veränderte Reihenfolge führt zur Neuplanung.
Das funktioniert auch ohne aktivierte BTP-Verbindung.

Ein gezielter Feldaufruf wählt sein Spiel bereits über die Match-ID. Seine
anschließende automatische Vorbereitung weiterer Spiele läuft als separater
Queue-Job mit frischen Daten. Der erfolgreiche Aufruf wartet nicht auf diesen
Job und hält dabei keinen Lock, den der Folgejob selbst erwerben muss. Geplante
Aufrufe erfassen den Job als Effekt und starten ihn erst nach erfolgreichem
Commit. Die bestehenden Queue-Fehler-/Diagnosepfade bleiben erhalten.

Die Tests in `test_ordering_sync_concurrency.js` halten den Integrations- bzw.
Auswahlpfad gezielt offen: ein echter unbeteiligter Aufruf muss fortschreiten,
DB-Zustand und Feldreferenz müssen erhalten bleiben, und eine wartende
automatische Auswahl muss geänderte Nummern vor der Vergabe berücksichtigen.
`test_btp_sync_locks.js` prüft insbesondere konservative gemischte Pläne,
Offizielle, Tabletbediener, unbekannte Felder und externe Freiloseffekte.
