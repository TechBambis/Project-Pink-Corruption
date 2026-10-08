# Privacy, access and local session context

On first use of the main app or `/setup`, **Your companion, your choices** appears before the model guide. Optional features are preselected except **Local date and time** and **Approximate place from IP**. Access remains unauthorized until **Save and continue**; preselection never starts capture, downloads, device connections or an IP lookup. Choose individual features or **Keep optional access off**. Existing configured choices are preserved. The choice is remembered; it is not asked again on every launch. Reopen it near the bottom of settings under **Extras → Local tools → Privacy & access**. Model setup also provides a shortcut.

| Optional permission | Scope |
| --- | --- |
| Microphone | User-started audio capture and local transcription; browser/OS permission is an additional requirement |
| Device control | Supported device discovery, connection, bridge polling and actuation |
| Model downloads | Explicit downloads of pinned public model/speech files; copying user-selected verified files remains offline |
| Online session audio | Public BambiCloud playlist, cue and audio requests |
| Cloud AI | Requests to the configured remote inference/token-count endpoint, including shared conversation history and any separately permitted clock/place context |
| Local date and time | Device time zone and the local backend clock, added as optional session context |
| Approximate place from IP | A separate, explicit IP lookup; no automatic startup/periodic lookup |

Required app storage, audio playback and basic hardware detection appear checked and disabled. These describe necessary local functions, rather than optional authorizations. Imported files are chosen by the user; audio can still be muted. Optional controls are enforced app feature gates, not an operating-system sandbox or a promise that native processes cannot technically read system information. Microphone capture and device discovery/connection require a concrete user action and any browser/OS permissions. When access is disabled, Scan, Connect and enabling device control open the access dialog without performing the requested operation; save a grant and retry. Camera, screen capture and browser geolocation remain denied in the packaged shell. Ordinary profile saves do not grant optional permissions.

Saving choices stops the active session and discards pending contributions, preventing cached narration from continuing with revoked context. Download leases, cloud requests and microphone recognition are cancelled on revocation. Devices receive their stop command before access is removed and the owned BLE bridge disconnects. An online-media response is destroyed so its existing request cancellation stops the upstream transfer. A verified file remains available after download permission is disabled.

## Date, time and approximate place

Date/time works without the internet. The device sends only a validated IANA time zone when enabled. The local backend formats its current date/time for that zone at contribution time. This is a clock snapshot, not an observation of the listener. Changing facts follow the reusable fixed prompt prefix so time changes do not invalidate its inference cache. The same authorization check applies to reactive/situational conversation and generated event narration. Fixed authored speech is not rewritten.

**Find approximate place** first saves the displayed access choices, then makes one HTTPS GET to `https://get.geojs.io/v1/ip/geo.json`. The provider is GeoJS, whose [endpoint documentation](https://www.geojs.io/docs/v1/endpoints/geo/), [privacy policy](https://www.geojs.io/privacy/) and [terms](https://www.geojs.io/tos/) were reviewed on 2026-10-08. GeoJS's policy describes Cloudflare as its network provider. Both necessarily receive the connecting public IP. No chat, account key, microphone recording or model prompt is sent to this endpoint. Requests have no credentials, no redirects, an eight-second deadline, a 16 KiB response limit and a 30-second retry interval. No payment/account was opened.

The lookup describes the **local backend's outbound public IP**. For the packaged/local app, this is its network connection, subject to proxies/VPNs; a future remotely hosted web app must implement a separate client-location design. The app validates and stores only city, optional region, country, source label and lookup time in the private profile. IP, coordinates, ISP and postal code are discarded. Unknown or missing city results fail rather than inventing a place or consulting another provider. A previous saved place is retained if a new lookup fails.

The result is approximate, possibly stale, and can point to an ISP, VPN exit or another city. It cannot establish the listener's residence, precise position, weather, surroundings or physical safety. **Forget place** cancels a pending lookup and removes the saved result. Turning its permission off also removes it. Restarting the app does not refresh it automatically.

Optional context may gently inform narration, for example an evening setting, without repeatedly announcing the time or implying surveillance. It is quoted data with explicit instructions to respect listener corrections and keep IP location approximate. The single **Cloud AI** switch also covers sending separately permitted clock/place context. Clock and IP-place remain off by default; enabling cloud AI does not enable either. The internal legacy context flag is synchronized with cloud AI on new saves; a previously saved separate opt-out remains effective until the choices are saved again. This is not a transcript scrubber: earlier spoken/user-written mentions can remain in saved history and be shared when cloud AI is authorized. Clear conversation memory separately to remove those transcripts. Prompts are guidance, not a semantic guarantee of every generated sentence.

## Validation and release scope

`npm run check`, `npm test`, `npm run build`, `npm run repo:check` and `npm run test:model-setup` cover the source change. The isolated browser check uses a temporary profile and mocked IP provider, exercises denied API calls, initial choices, saved grants, one explicit lookup, coarse-only persistence, revocation/deletion, setup ordering and small-screen layout. It does not query the developer's public IP, download model weights or qualify a new desktop installer. Native permission tests check the Electron policy independently of a physical microphone; the request handler rereads backend consent and fails closed.

Desktop source/shell staging includes the new policy module and this guide. Rebuild a new immutable package and run native acceptance on each target before distribution; existing release evidence belongs to its original artifacts.
