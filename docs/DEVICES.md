# Local device control

Optional Pearlconch/JoyHub support uses a local Bluetooth bridge. Install it with `./scripts/setup-joyhub.sh`; normal operation is offline. The bridge uses the locked Bleak/dbus-fast environment in `packages/devices/requirements.lock` and needs host Bluetooth/BlueZ access on Linux.

## Connect and test

Open **Pearlconch · local device control** in the main app:

1. Find and connect your device. Supply the motor write-characteristic UUID if several are writable.
2. Confirm channels: Pearlconch uses channel 1 rotation, channel 2 vibration. Rotation may remain unassigned.
3. Set separate caps, initially 30%. Use the explicit 0.5-second channel test at 10%, 20% or 30%, bounded by the cap. Tests disarm afterward.
4. Enable device control, then start a session. Phase patterns and random conditioning rotation are separate choices; random rotation starts off.

Connection does not arm output. Reload/reconnect starts with zeros and needs rearming. Only one browser connection owns control. Pause zeros channels; Resume restores the saved pattern. Stop, session completion, owner disconnect and panic disarm. Reconnecting BLE after a server restart restores only the connection. A successful write does not confirm physical movement; check your actual device with the bounded channel test.

## Timing and phases

**Speech cues & timing calibration** sets independent motor leads (0–1000 ms), accent intensity/duration and transition time. Defaults are zero lead, 10% for 150 ms and 250 ms transitions. **Compare sound & vibration** schedules a tone/cue 1.1 seconds ahead; increase vibration lead if movement arrives late. Measure rotation separately. There is no automatic motion sensor.

| Phase | Vibration | Rotation |
| --- | --- | --- |
| Induction | Breathe 15% | Off |
| Deepening | Wave 25% | Slow 20%, second half |
| Conditioning | Constant 30% | Optional intervals |
| Anchor | Pulse 25% | Off |
| Awakening | Fade to zero | Fade to zero |

Optional conditioning intervals have 30–90-second gaps, last 5–10 seconds and stay within caps. Manual rotation overrides them until the next phase. Limit changes immediately cap output; channel/bridge changes zero previous output. Clear halts automation until a new command or **Resume phase patterns**. Definitions live in [device-control.ts](../config/device-control.ts).

## Playback cues

```text
[vib:on:0.3] [vib:off] [vib:buzz:0.2:1000] [vib:fade:0]
[vib:pattern:breathe] [vib:pattern:wave] [vib:pattern:pulse]
[rot:on:0.2] [rot:off] [rot:pattern:slow] [rot:fade:0]
[both:off] [both:fade:0]
```

Additional patterns: vibration `constant`, `strobe`, `ramp_up`; rotation `steady`, `pulse`, `strobe`, `ramp_up`. Legacy `[vib:rotate:0.5]` aliases rotation-on. Intensities are 0–1; durations are bounded to 100–10000 ms. Place tags before their spoken unit. Tags are stripped from displayed/spoken text. Buzz temporarily replaces vibration, then returns to the running pattern; all output stays capped.

Only actual browser playback sends cues. Generation, text-only output and the Firefox overlay cannot actuate devices. Spoken triggers use calibrated accents when enabled; explicit cues override them. Event haptics use delivered speech bindings and suspend phase/random automation. Interruption, seek, layer withdrawal and disabled narration clear pending speech cues. Motion over 150 ms late is dropped; stop/fade still executes. Software pumps target 10 ms intervals, not sample-accurate Bluetooth movement.

## Bridge and checks

The [JoyHub protocol](https://github.com/jeahbwoi720/Joyhub-Bluetooth-Controller) accepts loopback UDP `{"vibe":[30,20,0,0]}` on `127.0.0.1:8888`. BLE packets are `a0 03 <four 0–255 values> aa`; unused channels stay zero. Pearlconch's characteristic is `0000ffa1-0000-1000-8000-00805f9b34fb`; [Buttplug's definition](https://github.com/buttplugio/buttplug/blob/master/crates/buttplug_server_device_config/device-config/protocols/joyhub.yml) confirms channel mapping. No upstream controller code is vendored.

The included bridge validates/serializes writes, zeros on reconnect and answers `{"status":true}` with `bambi-joyhub/1`. Motor datagram expiry after 1.5 seconds zeros output; browser heartbeat expiry after two seconds stops/disarms. An existing upstream UDP bridge is compatible but lacks our connection acknowledgement/watchdog.

```sh
.runtime/joyhub-venv/bin/python tools/joyhub_bridge.py --scan
.runtime/joyhub-venv/bin/python tools/joyhub_bridge.py --address AA:BB:CC:DD:EE:FF --describe
# Add --write-char UUID when needed.
python3 tests/joyhub_bridge_test.py
```

Run `npm test` for ownership, cue, timing and cap checks. Fixtures do not establish physical motion. For editor Flatpak CLI use `flatpak-spawn --host` with absolute Python/tool paths; the server uses the fixed host bridge automatically.
