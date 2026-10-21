# Gemeinsamer pi-blitz-Standard

Dieser Standard gilt für die Logo-Familie und den Repository-Aufbau der pi-blitz-Extensions. Er wurde am 17. Oktober 2026 auf Mircos ausdrücklichen Auftrag aus dem Handoff-Beispiel erstellt. Diese Datei ist die maßgebliche gemeinsame Quelle für diesen Umfang. Produktspezifikationen regeln weiterhin das Verhalten der einzelnen Extensions.

Workbench koordiniert die Anwendung. Das Erstellen dieses Dokuments ändert keine bestehenden Repositories, Assets oder Veröffentlichungen und erteilt keine Veröffentlichungsfreigabe.

## Logo-Familie

Die gestalterische Referenz ist [Handoffs vorhandenes Logo](../assets/logo.png). Für die gemeinsame Familie gelten folgende Merkmale.

- Ein eigenständiges, gut erkennbares Produktsymbol verbindet sich mit einem gelben Blitz als gemeinsamem Motiv.
- Dunkelblau und Blau bilden die Grundfarben, leuchtendes Cyan und Gelb die Akzente. Kräftige Konturen, abgerundete Formen und sparsame Schattierungen beziehungsweise Verläufe folgen der Referenz.
- Das Logo ist ein Bildzeichen ohne eingebauten Produktnamen. Der Produktname steht im umgebenden Text.
- Das veröffentlichte Logo liegt als quadratisches PNG mit transparentem Außenbereich unter `assets/logo.png`. Eine vorhandene editierbare Gestaltungsquelle bleibt als solche erkennbar erhalten.
- Die README zeigt das Logo am Anfang zentriert mit einer Darstellungsbreite von 320. Alternativtext benennt das jeweilige Produktlogo. `package.json` nimmt das Logo in die npm-Dateiauswahl auf und verweist mit `pi.image` auf seine öffentlich erreichbare Bilddatei.

Das Handoff-Bild zeigt zwei versetzte Terminalfenster mit Codezeilen und einem verbindenden Blitz. Diese Darstellung ist Handoff-spezifisch; andere Produkte verwenden ihr eigenes Produktsymbol. Die Referenzdatei hat 1254 × 1254 Pixel und einen Alphakanal. Ihre konkrete Auflösung ist keine Pflicht für alle Logos. Exakte Farbwerte, Schriftarten oder Vektorkoordinaten sind nicht festgelegt.

## Herkunft und Quelle des Blitz-Motivs

Die ursprüngliche Quelle des Blitz-Motivs ist **offen**. Eine separate Blitz-Datei, eine editierbare Originalquelle und die ursprüngliche Urheberschaft sind anhand der vorliegenden Handoff-Unterlagen nicht belegt.

Die verfügbare Bildreferenz ist das zusammengesetzte `assets/logo.png`. Der Commit `80c99cac7edfce2000d2dcfa557d1015191cfabf` vom 5. September 2026 fügte es mit der Beschreibung „Rename project to pi-blitz-handoff“ erstmals dem Handoff-Repository hinzu. Das belegt den Eingang in dieses Repository, nicht die Entstehung oder Herkunft des Motivs.

Die unveränderliche veröffentlichte Referenz ist <https://raw.githubusercontent.com/MircoBlitz/pi-blitz-handoff/v1.4.0/assets/logo.png>. Ihr SHA-256 lautet `616eaa079b10ccda5a50f1ed0d9d3c87b051cd06a9153fe0f53686de1dbca604`.

Bis eine Originalquelle tatsächlich vorliegt, wird diese PNG-Datei als Bildreferenz bezeichnet, nicht als editierbare Blitz-Quelle. Eine später bestätigte Originalquelle wird hier mit ihrem tatsächlichen Pfad und belegbarer Herkunft ergänzt. Der Namensbestandteil „Blitz“ steht für Mircos Nachnamen und ist kein Geschwindigkeitsversprechen.

## Repository-Aufbau

Der gemeinsame Aufbau trennt Produktcode, öffentliche Dokumentation, Assets und lokale Arbeitsmittel.

| Ort | Inhalt |
| --- | --- |
| Root | `README.md`, `CHANGELOG.md`, `LICENSE`, `SECURITY.md`, `package.json`, erforderliche Paket-/TypeScript-Konfiguration und versionierte `.gitignore` |
| `extensions/` | Pi-Einstieg `index.ts` und nach zusammengehöriger Verantwortung aufgeteilte Implementierungsmodule |
| `assets/` | `logo.png` und bei Bedarf aussagekräftige Screenshots |
| `docs/` | Produktspezifikation und weitere dauerhafte, produktbezogene Dokumentation |
| `templates/` | Ausgelieferte Vorlagen, soweit das Produkt welche benötigt |

`index.ts` übernimmt die Registrierung und Integration der Extension. Fachlogik liegt in verständlich benannten Modulen statt in einer großen Sammeldatei. Produktabhängige Verzeichnisse entstehen nur bei tatsächlichem Bedarf; Handoffs Vorlagen oder Screenshots sind keine Pflichtausstattung jeder Extension.

Die README erklärt Zweck, Einrichtung und Benutzung des tatsächlichen Produkts. Das Changelog beschreibt veröffentlichte Änderungen. Paketmetadaten verweisen auf das jeweilige Repository, seine Dokumentation und sein Logo. `pi.extensions` benennt den wirklichen Einstieg; die npm-Dateiauswahl beschränkt sich auf die benötigten Produktdateien und öffentlichen Begleitdokumente.

### Lokale Tests und öffentliche Historie

Tests sind ausschließlich lokale funktionale Prüfhilfen. Die zugehörigen Ignore-Regeln werden in `.gitignore` versioniert; die Tests selbst bleiben lokal. Das öffentliche Repository und das npm-Artefakt enthalten keine Tests oder lokalen Testartefakte. Eine Testarchitektur ist kein Reviewziel dieses Standards.

Private Checkpoint-Historie und lokale Arbeitsunterlagen bleiben vom neuen öffentlichen Stand fern. Lokale Pi-Arbeitsunterlagen unter `.pi/` und temporäre Agentenartefakte unter `.pi-tmp/` sind keine öffentlichen Produktbestandteile.

Bereits getrackte Dateien werden durch `.gitignore` allein nicht aus Git entfernt. Vor einer beauftragten Veröffentlichung sind deshalb sowohl der tatsächliche öffentliche Dateibaum und die dafür vorgesehene Historie als auch der Inhalt des npm-Artefakts zu prüfen. Eine Änderung bestehender öffentlicher Historie benötigt ihre eigene Freigabe.

## Quellen und Stand der Anwendung

Die praktischen Vorlagen sind Handoffs `assets/logo.png`, `README.md`, `package.json` und die Aufteilung unter `extensions/`, `assets/`, `docs/` und `templates/`. Für veröffentlichte Handoff-Fakten ist der Stand `v1.4.0`, Commit `c1087ddecc6d883f67cb0b0d5d6f05d5c37b4d1c`, die Referenz. Die neue Regel zu ausschließlich lokalen Tests und privater Checkpoint-Historie stammt aus Mircos ausdrücklicher gemeinsamer Entscheidung vom 17. Oktober 2026 und geht dem älteren Handoff-Beispiel vor.

Der veröffentlichte Stand von Handoff 1.4.0 enthielt noch einen versionierten `test/`-Baum und getrackte `.pi/`-Dateien. Ab 1.4.1 bleiben diese Dateien lokal und sind aus dem neuen öffentlichen Dateibaum ausgeschlossen. Private Checkpoint-Commits werden nicht mitveröffentlicht; die bereits vorhandene öffentliche Historie wird nicht umgeschrieben. Die unbekannte Blitz-Originalquelle bleibt offen.
