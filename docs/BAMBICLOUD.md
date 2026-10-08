# BambiCloud: fertige Sessions im lokalen Player

Stand: 2026-10-05. BambiCloud-Tracks sind vollständige Originalaufnahmen mit eigener Narration und Dramaturgie. Der Import behandelt sie als fertige Sessions. Er erstellt keine KI-Nacherzählung und schichtet keine automatische Event-Narration darüber.

## Benutzung

1. App neu laden, **Library** öffnen und unter **From BambiCloud** eine öffentliche `https://bambicloud.com/playlist/<uuid>`-URL einfügen.
2. **Add playlist** übernimmt zunächst nur Metadaten. Links die Sammlung wählen, einen Track auswählen und mit **Play session** starten. Audio beginnt nicht durch den Import.
3. Die Auswahl schaltet auf lokalen Medienbetrieb. Die Laufzeit richtet sich nach dem verfügbaren Rest dieser Playlist; die voreingestellten 20 Minuten schneiden die Aufnahme nicht ab. **Duration** zeigt dabei **Full playlist · h:mm:ss** (bei lokalen Dateien **Full track**). Diese Medienlaufzeit wird nicht als KI-Sessiondauer gespeichert. Bei der Rückkehr zu **Bambi Chat** gilt wieder die separat gewählte KI-Dauer. Früher versehentlich gespeicherte Playlist-Längen über zwei Stunden werden auf 20 Minuten zurückgesetzt.
4. **Show timed trigger words & visuals** schaltet die zusätzlichen Quell-Cues ein. Die Option ist standardmäßig aus. Die Original-Tonspur enthält weiterhin ihre eigenen Sounds.

Suche findet Titel, Playlist, Autor, eigene Tags und Triggernamen. Favoriten, Notizen, Tags und Importmetadaten werden im Browser und über die vorhandene SQLite-Bibliothek gespeichert. Erneuter Import derselben Playlist erzeugt keine doppelten Einträge. Lokale Dateien bleiben daneben verfügbar. Gesperrte/private Dateien erhalten keinen streambaren Link. Fehlende oder unbekannte Cue-Dateien verhindern die Audio-Wiedergabe nicht.

Die Bibliothek trennt **All sessions**, **Favorites**, **On this device** und jede importierte Playlist. Filter ändern nur die angezeigte Sammlung, nicht die laufende Queue. Herzen speichern Favoriten; das Drei-Punkte-Menü öffnet **Notes & tags** oder bei lokalen Dateien die Analyse. Lokale Aufnahmen kommen über **Add files** hinzu. Zusätzliche Timeline-Optionen bleiben in einem geschlossenen Abschnitt.

Die Steuerung liegt direkt im Bild. Mausbewegung, Touch und Tastaturfokus blenden sie ein; bei laufender Wiedergabe verschwindet sie nach 2,4 Sekunden ohne Aktivität. Über den Controls sowie beim Schreiben oder Tastaturfokus bleibt sie sichtbar; KI-Generierung und Sprachausgabe halten sie nicht automatisch offen. Beim Herunterscrollen gibt es keinen schwebenden Mini-Player. Eine Spul-Leiste erscheint nur für ausgewählte lokale oder Cloud-Medien mit bekannter Dauer im Medienbetrieb; Live-KI und externe Sessions haben Laufzeit, Pause und Stop, aber keinen künstlichen Medien-Seek. Mikrofonzustand und KI-Aktivität sind unabhängig: Ein ausgeschaltetes Mikrofon hat ein rotes Symbol, während **Thinking** oder **Speaking** weiterhin angezeigt werden können.

Als Player-Vorbilder wurden [Media Chrome](https://github.com/muxinc/media-chrome) und [Plyr](https://github.com/sampotts/plyr) geprüft. Ihre Medien-Controls sind nützlich; unsere Oberfläche bleibt eine eigene Anpassung, damit AudioContext, Cue-Zeitgeber, Engine-Zustände und Hard Stop denselben bestehenden Player bedienen. Keine neue Produktionsabhängigkeit oder Übernahme fremden Player-Codes.

Automatische Fortsetzung bleibt in derselben Playlist, überspringt nicht verfügbare Einträge und endet nach dem letzten verfügbaren Track. Ein späterer lokaler Upload oder eine andere importierte Playlist wird nicht angehängt. Pause, Seek, Master-/Session-Lautstärke und Hard Stop bedienen den vorhandenen Player. Beim natürlichen Ende wird die Session abgeschlossen. Die Wiedergabe benötigt kein geladenes Sprachmodell und keine TTS.

Automatische Ticks, zusätzliche Hintergrundbetten und Brainwave-Töne werden im Originalbetrieb unterdrückt. Eine ausdrücklich gewählte zusätzliche AI-Begleitung bleibt eine separate Betriebsart: Chat und Sprachausgabe sind möglich, ohne ein eigenes choreografiertes Event-Programm über die Aufnahme zu legen, auch wenn dessen Einstellung für KI-Sessions aktiviert bleibt; die Auswahl eines importierten Tracks stellt wieder auf Originalbetrieb zurück.

## Was die Live-Recherche tatsächlich ergab

Der öffentliche [API-Endpunkt](https://api.bambicloud.com/playlists?uuid=ff15f538-6e6b-433c-b68b-b4af5ee5d14d) lieferte sechs verfügbare Tracks. Die geprüfte Audio-URL antwortete auf `Range: bytes=0-15` mit HTTP 206 und 16 Bytes. Damit sind öffentliche Metadaten und der seekfähige Audio-Pfad nachgewiesen, keine vollständige Hörprüfung aller Aufnahmen.

| Feld | Befund | Verwendung |
|---|---|---|
| `duration` | Millisekunden; tatsächliche Media-Dauer kann abweichen | Playlist-Länge planen, nach geladenen Media-Metadaten korrigieren |
| `files` | Geordnete Playlist; `trackNum` ist keine verlässliche globale Reihenfolge | Reihenfolge des Arrays erhalten |
| `patreonTiers` | `null` oder Array | Nichtleere Tiers als gesperrt behandeln |
| `triggers` | Namen und weitere Katalogangaben, keine Wortzeiten | Anzeige und Suche, keine geschätzten Effekte |
| `hapticsURL` | In der geprüften ersten Aufnahme eine JSON-Liste mit 82 zeitcodierten Triggern | Optionalen Cue-Adapter verwenden |
| `scriptURL` | Separater Script-Link vorhanden | Nicht importiert; keine Volltranskripte speichern |

Der Name `hapticsURL` ist irreführend, wenn man daraus direkt Gerätebefehle ableitet. Das konkret geprüfte Format besteht aus `{start, stop, trigger, snap}`: Start/Stop in Millisekunden, Triggername und ein optionales Snap-Flag. Bei drei der 82 Einträge fehlt `stop`; dafür verwendet der Adapter eine ausdrücklich lokale Text-Anzeigedauer von 300 ms, ohne den beobachteten Start zu ändern. Es enthält keine hier nachgewiesenen Vibrations-/Rotationswerte. Der Adapter akzeptiert ausschließlich dieses gemessene Format, validiert Intervalle und entfernt unbekannte Felder. Andere Formate bleiben ungenutzt.

Die anschließende Live-Prüfung von sieben Cue-Dateien einer weiteren öffentlichen Playlist fand außerdem ein Ende vor dem Start in „Bambi Takeover“ und Intervalle über 60 Sekunden in zwei anderen Tracks. Deshalb normalisiert der Adapter fehlende, rückwärts laufende oder über 60 Sekunden lange Endintervalle auf 300 ms Textanzeige; der Start bleibt unverändert. Einträge mit ungültigem Start/Trigger oder ungültigen Feldtypen werden einzeln ausgelassen, statt die ganze Datei zu verwerfen. Die API meldet `adjustedEnds` und `skipped`, die UI zeigt diese Zahlen. Alle sieben Dateien ließen sich danach mit 51–148 Cues laden. Ein komplett unbrauchbares oder unbekanntes Format bleibt ein Fehler; dessen Audio kann unabhängig weiterlaufen.

Die offizielle [BambiCloud-Webanwendung](https://bambicloud.com) lädt diese Datei gesondert zur aktuellen Aufnahme. [Churchs Audio-Routen](https://github.com/HarleyVader/js-bambisleep-church/blob/aaffd4212f2c448e2792cadf298b2011f55fafa8/src/routes/audio.js) zeigen den Playlist-/CDN-Transport; die vertiefte Untersuchung des offiziellen Players lieferte den zusätzlichen Cue-Pfad. Öffentlicher Zugriff ist keine zugesicherte langfristig stabile Drittanbieter-API.

## Synchronisation und Mehrwert

Die optionalen Cues folgen `HTMLMediaElement.currentTime`, nicht dem LLM und nicht einem Timer seit Sessionstart. Ein Seek positioniert den Cue-Cursor neu. Verpasste Cues werden nicht als spätere Effektserie nachgeholt; ein Cue, der mehr als 150 ms verspätet erkannt wird, fällt aus. Cue-Texte nutzen vorhandene Untertitel-/Fokuswort-Schalter, und erkannte Trigger nutzen die vorhandenen visuellen Reaktionen, etwa die Augen-Schließbewegung. Die Originalaufnahme liefert den Ton vollständig. Quell-Cues erzeugen ausschließlich Text und visuelle Reaktionen, keine zusätzlichen Snaps, Giggles, Glocken, Blink-Töne oder andere lokale Sounds. Das `snap`-Flag bleibt Metadatum und löst keinen Sound aus. Einen Zusatzsound-Schalter gibt es bei Aufnahmen nicht. Automatische lokale Trigger-/Hintergrundsounds sind beim Datei-Playback deaktiviert; die eigenen KI-Sessions behalten ihre Sound-Funktionen. Der Cue-Adapter erzeugt keine Hardwarebefehle.

KI-Sprachausgabe, Engine-Events und Aufnahme-Cues nutzen dieselbe Triggeranzeige: mittig, fett, in der bestehenden rosa Textfarbe, mit gemeinsamem Format für Triggernamen. Die gewöhnliche Wortanzeige tritt während eines Triggers zurück. „Blink“ verwendet dieselbe größere Schrift wie die vorhandene Blink-Anzeige. Textanzeige folgt dem bestehenden Audio-/Ausgabezeitgeber; Pause friert sie ein, Seek/Stop löschen sie. Die Darstellung ist auf 300–2000 ms begrenzt; bei Aufnahme-Cues dient das gemessene bzw. normalisierte Intervall als Vorgabe. Die Augen-Schließebene liegt über den Texten, die Bedienung darüber. Die Cue-Option wird als vorhandene Benutzereinstellung gespeichert.

Der lokal gespeicherte Namenskatalog enthält alle 65 am 2026-10-05 über `https://api.bambicloud.com/triggers` geprüften Trigger; die unveränderte STABLE-2.0-Liste bleibt erhalten. Namen werden ohne Quellbeschreibungen übernommen. Der zusammengeführte lokale Katalog enthält 66 Einträge, weil die alte Sammelbezeichnung für Körper-Lock-Trigger zusätzlich erhalten bleibt. Cue-Dateien dürfen weitere Namen enthalten. Ein Quell-Cue löst genau ein Ereignis mit seinem vollständigen Namen aus; „Bambi eyes lock“ fällt nicht auf „Bambi“ zurück. Die mittige Cue-Anzeige funktioniert bei eingeschalteter Cue-Option auch ohne normale Untertitel/Fokuswörter. Der allgemeine Trigger-Schalter bleibt maßgeblich.

„Bambi Reset“ verwendet eine rein visuelle, lokal definierte 1,3-s-Überblendung: 250 ms ausblenden, 350 ms schwarz, 700 ms zurück. Die nächste Triggerreaktion kann sie ersetzen; Seek/Stop löschen sie und reduzierte Bewegung unterdrückt sie. Ein vorheriges fiktionales Sleep-Augenbild wird aufgehoben. Diese Darstellung startet keinen Session-Neustart, erzeugt keine Reset-Narration und löscht weder App-Daten noch Einstellungen. Diese Zeiten sind ein lokales Design, keine Behauptung über Quell-Video-Timing.

Die Library kennzeichnet verfügbare Zeitdaten mit einem Icon direkt rechts neben dem Herz: rosa bei vorhandener Cue-URL, gedämpft ohne Zeitdaten. Der Tooltip erklärt die Bedeutung. Es erscheint kein dauerhafter Hinweistext im Player. Ein vorheriger Cue-Zähler darf nicht als Status einer Aufnahme ohne Zeitdaten stehen bleiben. Trigger-Katalogangaben und Script-Dateien liefern allein keine gesprochenen Zeitpunkte.

Das **Trigger markers**-Icon neben der Lautstärke erscheint nur bei Aufnahmen mit geladenen, gültigen Zeitmarken. Rosa zeigt den eingeschalteten Zustand; Tooltip und Tastaturbedienung erklären die Funktion. Die Option ist standardmäßig eingeschaltet; die Einstellung wird gespeichert. Dünne rosa Linien zeigen Quell-Startzeitpunkte relativ zur tatsächlichen Aufnahme-Dauer. Hover und Tastaturbedienung zeigen den nächstgelegenen Trigger mit Zeitstempel. Hover führt weder einen Seek noch einen Trigger aus. Die Option blendet ausschließlich die Markierungen aus; die Option für Triggerwörter und visuelle Reaktionen bleibt unabhängig davon. Zeitdaten werden unabhängig von der Aktivierung der Trigger-Effekte geladen. Ohne Cue-Daten bleibt der Zeitstrahl unmarkiert. Die Linien werden auf einer kleinen Canvas bei Daten-, Größen- oder Optionsänderung gezeichnet, nicht in jedem Playback-Frame; auch bei dichten Cue-Dateien entsteht keine Liste tausender DOM-Elemente.

Dies synchronisiert die vom Autor gelieferten Trigger-Cues. Es beweist weder deren phonetische Genauigkeit noch lückenlose Erkennung aller gesprochenen Wörter. Ein Track ohne solche Daten erhält keine erfundenen Zeitpunkte. Insbesondere „Pink“, „Blink“ oder Giggle-Themen werden nur dann als Quell-Cues angezeigt, wenn sie tatsächlich in den validierten Daten stehen. Vollständige Wort-/Szenenchoreografie wäre ein gesonderter, lokal geprüfter Timeline-Schritt.

Unser Fünf-Phasen-Modell **24/16/40/10/10** bleibt für unsere eigenen Engine-Zustände unverändert. Die Originalaufnahme wird nicht umgebaut, und ihre Dramaturgie wird nicht als dieselbe Phasenstruktur ausgegeben. Automatische Hintergrundvisuals sind weiterhin unsere Darstellung; nur die optionalen Quell-Cues folgen nachgewiesenen Track-Zeitpunkten.

## Technischer Umfang

| Lokaler Endpoint | Aufgabe |
|---|---|
| GET `/api/bambicloud/playlist?url=…` | Öffentliche Playlist normalisieren |
| GET `/api/bambicloud/stream?url=…` | Audio streamen, einzelne Byte-Ranges weiterreichen |
| GET `/api/bambicloud/cues?url=…` | Begrenztes JSON abrufen und timed Trigger-Liste validieren |

Upstream-Ziele sind auf HTTPS und `api.bambicloud.com` bzw. `cdn.bambicloud.com` beschränkt, einschließlich Redirect-Prüfung. Es gibt Abbruch bei Client-Abmeldung, Zeit-/Größenlimits und keine Cookie-Weitergabe. Metadaten/Cues sind auf 2 MiB, Audio-Streams auf 1 GiB begrenzt. Es werden keine Medien auf Platte archiviert, keine Patreon-Anmeldung und kein privater Zugriff ergänzt. Netzwerkzugriffe entstehen beim expliziten Import, bei Track-Auswahl bzw. aktivierten Cue-Daten; Wiederherstellung der Bibliothek lädt keine externe Aufnahme.

Laufzeitkosten: **LOW** CPU/GPU für Metadaten, Streaming und Cue-Cursor; Netzwerk erforderlich. Kein zusätzliches LLM/TTS für Originalbetrieb. Bestehende Visuals kosten weiterhin entsprechend ihrer gewählten Darstellung.

## Prüfung und nächste sinnvolle Schritte

`node --import tsx --test tests/bambicloud.test.ts` prüft Metadaten, Zugriffsschranken, Redirect-/Range-Verhalten, Antwortlimits und Cue-Validierung/Seek. `node scripts/bambicloud-browser-check.mjs` prüft den echten Browserplayer mit synthetischem Audio und isolierten API-/Gerätepfaden: Import, Persistenz, Sperren, Originalmodus trotz aktivierter AI-Präferenzen, tatsächliche Dauer, zeitgesteuerte Cues, Pause/Seek/Stop, Playlist-Fortsetzung und Abschluss. Die ignorierten Ergebnisdateien liegen unter `runtime/bambicloud-*.json`.

Für den weiteren Ausbau bringt eine manuelle Hör-/Bildprüfung einer ausgewählten Aufnahme den größten Nutzen: gelieferte Cue-Zeiten gegen gesprochenen Wortanfang vergleichen, Abweichungen dokumentieren und erst dann einen optionalen per-Track-Zeitoffset anbieten. Danach wären explizite Track-Timelines für Scannerbewegung, Pink-/Blink-Cues und andere tatsächlich belegte Szenen sinnvoll. Geräte-Haptik bleibt ein eigener, aktivierbarer Adapter mit Fähigkeitsprüfung, Begrenzung und unabhängigen Stop/Pause; aus dem Feldnamen allein wird keine Geräte-Choreografie erzeugt. Keine neuen Top-Level-Phasen, keine LLM-Entscheidung über Effektzeiten.

## HarleyVaders Audio-Vibration: geprüfter Übernahmekandidat

Am 2026-10-05 wurde der aktuelle Church-Stand erneut direkt abgerufen: Commit `aaffd4212f2c448e2792cadf298b2011f55fafa8`. Quelle: [`public/audio-player.js`](https://github.com/HarleyVader/js-bambisleep-church/blob/aaffd4212f2c448e2792cadf298b2011f55fafa8/public/audio-player.js#L266), insbesondere `_ensureAudioContext`, `_startAnalysisLoop`, `_driveVibration` und `_toggleBpSync`.

**BEOBACHTET:** Ein `MediaElementAudioSourceNode` führt über einen Lautstärke-Gain zu einem `AnalyserNode` mit `fftSize = 256`. Pro `requestAnimationFrame` liest der Player 128 Byte-Frequenzwerte aus. Sein als `rms` benannter Wert ist `sqrt(mean(bin²)) / 255`, also eine Zusammenfassung der skalierten Frequenzwerte, kein RMS der linearen Audio-Wellenform. Die Vibrationsstärke ist `min(1, (rms * 2.5)^0.7)`. Der Player sendet sie direkt an sämtliche verbundenen Buttplug-Geräte mit Vibrationsfähigkeit. Dafür werden keine BambiCloud-Trigger-Zeitdaten ausgewertet. Abschalten der Sync-Option ruft `stop()` für die Geräte auf. Eine eigene Sendetaktbegrenzung, eigene Attack-/Release-Glättung oder explizite Pause-/Puffer-Gates sind in diesem Analysepfad nicht enthalten; die Browser-Analyse besitzt ihre eigene Standardglättung. Die Audio-Sync-Funktion steuert keine Rotation.

**EINORDNUNG:** Harleys Beschreibung stimmt mit diesem Code überein: Haptik folgt dem Audiosignal. Das ergänzt unsere bisherige Auswertung von Trigger-Zeitdaten und funktioniert grundsätzlich auch bei Tracks ohne Cue-Datei. Das Signal erkennt weder Wörter noch Triggerbedeutungen. Stimme, Musik und dauerhafte Hintergrundklänge können alle Vibration verursachen. Die eingestellte Audio-Lautstärke beeinflusst hier das gemessene Signal; Änderungen am Pegel ändern deshalb auch die Haptik.

**EMPFOHLENE INTEGRATION, NOCH NICHT IMPLEMENTIERT:**

| Betriebsart | Vorgesehenes Verhalten |
|---|---|
| Aus | Keine neue Haptik aus Originalaufnahmen |
| Audio | Geglättete Vibrationshüllkurve aus der laufenden Aufnahme, auch ohne Zeitdaten |
| Trigger | Kurze, lokal definierte Vibrationsereignisse an validierten Quell-Cues |
| Hybrid | Niedrige Audio-Grundkurve; Cue-Ereignisse übernehmen kurz den Vordergrund, anschließend kehrt die Kurve zurück |

Für uns ist eine kleine eigenständige Implementierung des Prinzips sinnvoller als ein Git-Cherry-Pick des ganzen Players. `AudioEngine.attach()` bindet Medien bereits an unseren AudioContext; ein Analyseabzweig dieser konkreten Aufnahme kann dort ergänzt werden. Der vorhandene Master-Analyser wäre ungeeignet, weil er zusätzlich andere Busse einschließlich Mikrofon-Monitor, Effekten und AI-Stimme erfasst. Die Aufnahme darf nicht erneut an einen zweiten Media-Source-Node gebunden oder über einen zweiten hörbaren Pfad ausgegeben werden.

Der Adapter sollte Waveform-RMS oder eine bewusst gewählte Frequenzmessung, Rauschschwelle, Empfindlichkeit und Attack-/Release-Glättung anbieten. Ein vorgeschlagener Sendetakt von höchstens 20 Hz ist eine lokale Designentscheidung, kein aus Church gemessener Wert. Lautstärkeabhängigkeit muss im Bedienverhalten ausdrücklich festgelegt werden. Pegel, Cue-Puls und vorhandene Engine-/Manuell-Kommandos brauchen eine definierte Priorität: Der aktuelle `DeviceController` hält einen Zustand je Kanal und mischt keine unabhängigen Audio-/Cue-Quellen. Ein fortlaufender `on`-Befehl würde andere Muster überschreiben. Deshalb sind Quellenarbitration und Ablauf veralteter Audio-Werte erforderlich, bevor Hybridbetrieb eingeschaltet werden kann.

Ausgabe läuft durch unseren vorhandenen Geräte-Controller und BLE-/UDP-Pfad mit gewähltem Kanal und Benutzer-Maximum. Audio-Sync aktiviert nur Vibration; Rotation bleibt separat. Pause, Seek, Buffering, Track-Ende, Track-Wechsel und Stop verwerfen den bisherigen Audio-Wert; Hard Stop und Geräte-Stop bleiben vorrangig. Wiedereinstieg liest die aktuelle Aufnahme statt alter Ereignisse. Die bestehenden fünf Phasen und die Engine-/LLM-Aufteilung bleiben unverändert. Rechenkosten des Analyseabzweigs: **LOW COST**, kein Sprachmodell oder neue Produktionsabhängigkeit nötig.

Eine spätere Implementierungsprüfung muss Stille/konstante Töne/Transienten, Glättung, Sendetakt, Benutzergrenze, Quellenpriorität sowie Pause/Buffering/Seek/Stop prüfen. Ein Browser-Test kann die Analyse mit synthetischem Audio und einem aufgezeichneten Geräte-Transport verifizieren; reale Bewegung wurde in dieser Recherche nicht getestet. Quellencredit: HarleyVader/Church für die Audio-Sync-Inspiration, BambiCloud für Aufnahme- und Cue-Daten. In Churchs `package.json` steht MIT; der geprüfte Repository-Baum enthält keine eigenständige Lizenzdatei. Diese Recherche hat keinen fremden Quellcode in die Anwendung übernommen.
