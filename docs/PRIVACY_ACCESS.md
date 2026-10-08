# Privacy & access

First launch asks which optional features may run. Required local playback/storage remains available. Optional access is unauthorized until choices are saved. Most options are preselected; clock/place start unchecked. Choose **Keep optional access off**, or save individual grants. Reopen **Extras → Privacy & access** to change them.

| Permission | Access |
| --- | --- |
| Microphone | Local capture/transcription; revocation releases capture |
| Devices | Optional device connection/control; separate arming is still required |
| Model downloads | Explicit model transfers; existing verified data needs no download permission |
| Online media | Requested remote media |
| Cloud AI | Selected conversation/memory and separately permitted clock/place context sent to the configured provider |
| Local clock | System date/time/time zone, read only when enabled |
| Approximate place | One requested IP-location lookup |

The IP lookup uses **[GeoJS](https://www.geojs.io/privacy/)** only after **Find approximate place**. GeoJS and its network provider see the backend’s outbound public IP. No chat or audio is sent; saved data excludes the IP and coordinates. Results are approximate (often an ISP/VPN location), not a home address. Store only coarse location; no background refresh. **Forget place** cancels/removes it; revoking permission also removes it. Failed lookups retain the previous saved result.

Clock/place context is quoted as optional data and respects listener corrections. Enabling cloud AI does not enable clock/place access. Earlier location mentions can remain in conversation history; clear memories separately if needed.

Backend access gates enforce requests independently of UI. Desktop microphone access is limited to the app's own main frame; camera is denied. Revocation cancels affected work. Settings imports cannot grant permissions. These app gates do not sandbox other programs/users on the OS. [Local security](LOCAL_SECURITY.md).

Verification: `npm run test:model-setup` and permission/access tests in `npm test`; browser location tests use a mocked provider.
