# Local service security

The main app and Kokoro bind to IPv4 loopback. Host/Origin admission checks additionally reject foreign browser origins and rebinding hosts. These controls do not isolate the app from software running as the same operating-system user. Do not expose these ports through a reverse proxy, LAN binding or public tunnel.

## Main app

Every HTTP route, including reply diagnostics and static files, checks the exact Host header (`127.0.0.1:<port>` or `localhost:<port>`). A supplied Origin must be the app's local HTTP origin. Cross-site Fetch Metadata requests are rejected. Requests without Origin remain available for native lifecycle and diagnostic clients.

WebSocket upgrades also require an explicit matching Origin and `/ws`. Native test clients must set the Origin header. Browser extensions are blocked, pending explicit pairing. These checks are browser access controls, not authentication against local processes that can choose their own headers.

Responses prevent framing and MIME sniffing and suppress referrers. API and service health responses use `Cache-Control: no-store`. JSON and WebSocket payloads retain their 128 KiB limits. This is not a complete content security policy or an XSS audit.

## Kokoro

Direct browser requests are rejected, including requests from the app's origin; the browser uses the main app's proxy. All GET/POST routes validate Host. Health and voice catalogs remain accessible to native clients without a credential.

Every render POST requires JSON, one Content-Length header, no Transfer-Encoding, and `X-Bambi-TTS-Token`. The service creates a random 256-bit credential on startup, atomically publishes it to the ignored `runtime/tts-access.token`, and rotates it on each restart. On Unix, the credential file is created with mode 0600. The Node client rereads it for each render and never sends it to remote custom providers or follows render redirects.

For isolated instances, set `BAMBI_TTS_TOKEN_FILE` to the same private path in both processes. Alternatively, set `BAMBI_TTS_TOKEN` to the same 64 lowercase hexadecimal characters in both environments. Never commit, package, log or pass this credential to the browser. Missing credentials result in HTTP 401; they do not disable protection. Native render clients must send that credential.

The service retains its 64 KiB body limit, 3,000-character text limit, single render lock, busy rejection and cancellation checks. Socket reads time out after 30 seconds. This is not a complete CPU/memory sandbox. Windows user-profile paths and inherited ACLs still require verification before shipping a Windows beta.

## Verification and remaining release gates

`tests/local-access.test.ts` starts the actual app with an isolated database, simulated UDP and disabled backend calls. It tests diagnostic protection, rejected hosts/origins/extensions, accepted app requests, rejected/accepted WebSocket upgrades, invalid/oversized JSON, malformed WebSocket messages, oversized WebSocket disconnects without a server crash, and native emergency stop access. It also tests client credential rotation and withholding credentials from remote providers.

`tests/local_audio_test.py` starts the real offline Kokoro service with a temporary credential and forbids outbound socket connections. It tests rejected browser/rebinding requests, missing/wrong credentials, wrong content type, oversized bodies, accepted WAV rendering and busy handling. It checks token generation, rotation and Unix file permissions.

Restart the owned application and speech services after updating their code to activate changes. Remaining beta gates include a verified Windows install/start/stop path, direct model/Whisper endpoint review, media-decoder resource limits and broader real-browser/headset checks. These regression tests are not a complete penetration test or native-platform release approval.
