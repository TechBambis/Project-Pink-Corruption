# Local Pearlconch / JoyHub device control

The main website now reuses its existing session clock, phrase renderer, WebSocket and Stop/Pause controls for two independent actuator streams. No JoyHub account, cloud service, Windows GUI or new TTS backend is required. Setup downloads the optional BLE dependencies once; normal use is offline.

## Main website

Open **http://127.0.0.1:6969/** → **Pearlconch · local device control**.

1. **Find devices** lists nearby BLE advertisements. Choose your device, then **Connect**.
2. If the device has multiple writable characteristics, supply the motor characteristic UUID in the motor write-characteristic field. The bridge deliberately does not guess between multiple writable endpoints.
3. **Enable device control** arms this browser's connection. The upstream Pearlconch device definition maps **channel 1 rotation / channel 2 vibration**; change either selector for another device. Rotation can be left unassigned.
4. Set separate maximum vibration and rotation percentages. Both start at 30%; requests above those caps are clipped. The short channel test lasts 0.5 seconds with selectable 10%, 20% or 30% intensity, limited to the selected motor cap. **Test vibration** and **Test rotation** work without arming or starting a session and disarm automatically; phase/random automation cannot continue after a test. A 10% electrical setting can be too low to start a motor; the UI allows a deliberate stronger test within the configured cap.
5. Start the existing session. **Patterns follow session phases** enables the phase defaults. **Random rotation during conditioning** is separately selectable and off initially.

**Speech cues & timing calibration** provides independent vibration/rotation lead values (0–1,000 ms), speech cue intensity (0–1, clipped to the vibration cap), duration (100–2,000 ms) and phase transition duration (0–2,000 ms). Defaults are zero lead, 10% / 150 ms accents and 250 ms transitions. They are starting values, not a measured optimum or evidence of stronger hypnosis.

**Compare sound & vibration** schedules a tone and one calibrated vibration cue 1.1 seconds ahead during an enabled, unpaused session. Keep the Effects bus audible and speech accents enabled. If motor movement arrives later than the tone, increase vibration lead by the observed delay, then compare again. Rotation lead is configured separately for spoken rotation metadata; do not copy a vibration measurement without checking that motor. The UI has no sensor or automatic onset measurement. A lead only advances a command within available scheduling time: an already due command executes immediately. Connection, Bluetooth transport, motor startup and physical load can change the measured delay.

Generated speech accents can be disabled separately. Explicit script device markers retain their own intensity/duration. Limit changes preserve an ongoing pattern and immediately affect its capped output; they do not resume halted automation. Timing or accent changes discard queued old playback cues. **Resume phase patterns** explicitly restarts phase automation. Changing bridge, channel mapping or automation mode zeros the previous output first.

Manual patterns need a running, unpaused session. Explicit Pause zeros both channels and suspends patterns; Resume restores their saved position. Conversation interruption discards future unheard word commands while preserving the bounded running session pattern. Explicit device clear halts automation until a new command or **Resume phase patterns**. The status indicates when automation is halted. **Stop both**, session finish, the player’s **End session** icon and owner WebSocket closure disarm the device. A page reload keeps channel choices, caps and optional phase settings but requires activation again. Device connection and actuator activation are separate controls. The optional **Reconnect BLE after server restart** restores only the saved connection with zeroed motors; it never arms actuator control. Disconnect disables connection restoration. Repeated connect requests to the same target are serialized and reuse the existing bridge. Error/test feedback has a separate persistent field, so status polling does not erase it. Missing BLE or an unassigned channel silently ignores playback commands.

Only one browser connection owns actuator control at a time. A different tab cannot replace its settings or issue actuator commands. The existing application panic remains a global stop.

## Protocol verified against upstream

The upstream [Joyhub-Bluetooth-Controller](https://github.com/jeahbwoi720/Joyhub-Bluetooth-Controller) accepts loopback UDP **JSON motor percentages**, not CLI text such as `rotate 0.5`:

```json
{"vibe":[30,20,0,0]}
```

Destination is fixed at **127.0.0.1:8888**. The four-channel BLE motor packet is `a0 03 <channel1> <channel2> <channel3> <channel4> aa`, where each percentage is converted to 0–255. `STOP` and an all-zero motor packet stop both mapped actuators. No raw commands, heating, suction, pump or guessed rotation opcodes are sent. Unused channels remain zero. The device determines what each physical motor does; the [Buttplug Pearlconch device definition](https://github.com/buttplugio/buttplug/blob/master/crates/buttplug_server_device_config/device-config/protocols/joyhub.yml) identifies rotation at index 0 (UI channel 1) and vibration at index 1 (UI channel 2). This corrects the initial user-provided opposite assignment. Its motor characteristic is `0000ffa1-0000-1000-8000-00805f9b34fb`, matching the observed device. The [independent JoyHub protocol implementation](https://github.com/buttplugio/buttplug/blob/master/crates/buttplug_server/src/device/protocol_impl/joyhub.rs) also confirms the same packet layout. Neither source code is vendored.

Select **JoyHub-Controller · UDP** for an already running upstream bridge. This mode can send compatible packets but the upstream implementation has no connection acknowledgment; the UI explicitly shows that BLE connectivity is unconfirmed. It must run on the same machine because the destination is loopback.

The included Linux bridge additionally replies to `{"status":true}` with `bambi-joyhub/1` connection status. Status requests never move the motors or extend the actuator watchdog. It accepts only local datagrams and validates four finite percentages before encoding a packet. BlueZ support comes from [Bleak](https://bleak.readthedocs.io/en/latest/), not from the upstream Windows media-analysis/GUI dependencies.

## Setup and CLI

```bash
./scripts/setup-joyhub.sh
.runtime/joyhub-venv/bin/python tools/joyhub_bridge.py --scan
.runtime/joyhub-venv/bin/python tools/joyhub_bridge.py --address AA:BB:CC:DD:EE:FF --describe
.runtime/joyhub-venv/bin/python tools/joyhub_bridge.py --address AA:BB:CC:DD:EE:FF --write-char MOTOR_CHARACTERISTIC_UUID
```

Setup installs **Bleak 3.0.2 (MIT)** and **dbus-fast 5.0.4 (MIT)** into their own `.runtime/joyhub-venv`; neither Kokoro nor its dependencies are changed. The lock file is `packages/devices/requirements.lock`. Preserve the installed packages' license files when redistributing the environment. This bridge implementation is local project code; upstream Python source is not vendored. The upstream README declares MIT licensing, and is cited as the packet-layout source.

Fedora needs a functioning Bluetooth adapter and BlueZ/system D-Bus. Inside the editor Flatpak, the server launches only this fixed bridge through `flatpak-spawn --host --watch-bus` so it can access host Bluetooth. For a manual CLI scan in that environment, prepend `flatpak-spawn --host` and use absolute Python/tool paths. Running outside Flatpak uses the Python interpreter directly. The bridge binds locally, serializes BLE writes and sends zeros before accepting commands after every connection/reconnection. No initial network setup happens during normal startup.

## Playback metadata

Supported tags are removed from both display and TTS input and passed as validated cue objects:

```text
[vib:on:0.3] [vib:off]
[vib:pattern:breathe] [vib:pattern:pulse] [vib:pattern:wave]
[vib:pattern:strobe] [vib:pattern:constant] [vib:pattern:ramp_up]
[vib:buzz:0.2:1000] [vib:fade:0]
[rot:on:0.2] [rot:off]
[rot:pattern:slow] [rot:pattern:steady] [rot:pattern:pulse]
[rot:pattern:strobe] [rot:pattern:ramp_up] [rot:fade:0]
[both:off] [both:fade:0]
```

The legacy conceptual `[vib:rotate:0.5]` is accepted as a rotation-on alias. Intensities must be 0–1; buzz/fade durations are bounded to 100–10,000 ms. Vib/rot fades default to five seconds and a both-channel fade to ten seconds. Unknown, invalid or raw commands are stripped and ignored. Place a cue immediately before the corresponding spoken unit for alignment. At the end of a phrase, cues run after its measured spoken duration; explicit SFX pauses maintain their order. The existing trigger renderer can add its mapped effect before attached trailing cues.

The server never drives actuators when it generates text. Only the browser's actual playback cue sends a command. Device metadata and generated accents are scheduled ahead from the narration AudioContext's estimated output clock, with each motor's configured lead subtracted once. Global `both:off` stays one global halt at its scheduled audio time. The Node synthesis loop and native bridge pump have 10 ms intervals (a nominal 100 Hz software target); actual BLE delivery and mechanical movement can be slower and are not sample-accurate. Pause zeros both channels, discards transient/queued cues and freezes the baseline pattern; an explicit Resume continues that baseline without replaying old accents. Motion cues more than 150 ms late are discarded, while late off/fade commands still execute. Text-only output does not execute device markers. The Firefox overlay strips the metadata but does not arm or forward device control.

A `buzz` is a temporary vibration overlay: it replaces the output for its bounded duration while the underlying pattern clock continues, then returns to that current pattern value. A new buzz replaces the previous accent. Off/fade/clear/stop and interruption remove the active accent; off/fade also discard queued matching motion cues. Fade starts at the actual capped output, including an active accent. Caps apply to both streams throughout.

In ordinary playback, enabled spoken trigger sequences get one calibrated accent at the spoken word unless explicit word-level device metadata already supplies a command. Spoken one-shot effects do not add this default. In event mode, the existing **event haptics** option enables event mappings and phase/random automation is suspended. Compiled speech slot bindings align accents with the actual trigger or Blink word, including fractionation's transition before narration, every voiced Blink and eligible motif recalls. Only successfully scheduled speech dispatches bound cues; unavailable/late/disabled narration cannot fire them from a timer. Layer withdrawal, user interruption, seek, pause and disabling narration/triggers/event haptics clear pending device playback. Other explicitly mapped event transitions may retain their independent haptic cue.

Technical prompt directions are appended to the existing selected persona, with separate vibration/rotation command lists when device control is armed. Existing source roleplay content is not rewritten, and no additional narration or claims about device sensations are generated by the controller.

## Defaults and automation

Phase positions reuse `packages/session-director/phases.ts`. Device defaults and interval limits live in `config/device-control.ts`:

| Session phase | Vibration | Rotation |
| --- | --- | --- |
| Induction | Breathe, 15% | Off |
| Deepening | Wave, 25% | Slow, 20%, from halfway through this phase |
| Conditioning | Constant, 30% | Off between optional randomized intervals |
| Anchor | Pulse, 25% | Off |
| Awakening | Fade current capped output to zero | Fade current capped output to zero; no new rotation |

When selected, random rotation occurs only in Conditioning: a 30–90-second gap followed by a 5–10-second interval at up to 30%, respecting the rotation cap. Every interval ends with rotation zero. Manual rotation cues override this phase's automatic rotation until the next phase. Phase changes and automatic rotation starts blend from the current capped output over the configured transition duration; explicit off/stop remains immediate. This timing is independent of AI generation. Awakening fades both channels from their current output to zero over ten seconds (or the remaining session time, if shorter), preserving an already inactive channel at zero. Session completion independently stops and disarms the controller.

Pattern synthesis uses continuous bounded values: Breathe is a six-second cosine envelope, Wave four seconds, Pulse a 1.2-second cycle, Strobe a 0.5-second cycle and Ramp up ten seconds. Rotation Slow/Steady set continuous motor speed through the channel percentage; they do not invent a separate mechanical-direction protocol.

Two-second browser-heartbeat expiry stops/disarms the Node controller. The native bridge independently zeros motors if valid motor datagrams stop for 1.5 seconds. Reconnection zeros motors rather than replaying an old nonzero target. The unmodified upstream bridge does not provide that receiver-side watchdog or connection acknowledgment; use the included local bridge for both behaviors.

## Verification and physical limits

```bash
source scripts/env.sh
npm run check
node --import tsx --test tests/devices.test.ts tests/device-audio.test.ts tests/device-speech-playback.test.ts tests/session-events.test.ts tests/script-audio.test.ts tests/tick.test.ts
python3 tests/joyhub_bridge_test.py
```

The retained TypeScript and Python tests cover protocol validation, cue parsing, bounds, pulse phase, transient return, late cue rejection, separate motor lead, capped fades without new rotation, live settings, speech delivery eligibility, event bindings, random intervals, ownership, heartbeat expiry and bridge watchdog behavior. They use fixtures or simulated transport rather than establishing physical movement.

A successful BLE write is not a physical motion acknowledgment. Confirm the characteristic/channel mapping on your own device with the explicit short test within the selected caps. The native status reports write counters for diagnosing delivery; the UI does not claim confirmed motor motion.
