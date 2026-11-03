# Zentrale Sprachhelfer

Helfer, Starter, Windows-/Linux-Oberflächen, Launcher-Quellen und Paket-Erzeugung gehören zum Repository **bts-sprachserver**. Die vollständige Anleitung steht dort unter `docs/speech-helpers.md`; die Quellen liegen unter `bts_sprachserver/helper_assets/`, der Agent unter `bts_sprachserver/helper_agent.py`.

BTS zeigt unter **Einstellungen → Sprache & Durchsagen** den Status an und leitet Steuerung sowie Downloads über die authentifizierte API `/v1/helpers` weiter. Persönliche Starter werden vollständig auf dem Sprachserver erzeugt. BTS baut keine Helferpakete, verwaltet keine Leases und enthält keinen Helfer-Laufzeitcode.

Für die Umstellung beide Projekte aktualisieren, das private Runtimepaket unter `<BTS_DATA_DIR>/helpers` auf dem Sprachserver bereitstellen und bestehende Helfer durch neu heruntergeladene Starter verbinden. Optional am Sprachserver `BTS_HELPER_PUBLIC_URL` setzen; für HTTPS ist zusätzlich `BTS_HELPER_CERTIFICATE_SHA256` erforderlich. Hauptschlüssel werden nie in persönliche Starter übernommen.

Die Verbindung lässt sich zur Laufzeit umstellen. BTS zeigt anschließend die Helfer des neuen Sprachservers und meldet dort Bedarf. Helfer bleiben am bisherigen Server angemeldet; sie werden nicht automatisch verschoben. Bereits ausgestellte reguläre Audiolinks bleiben bis zu ihrem Ablauf nutzbar.
