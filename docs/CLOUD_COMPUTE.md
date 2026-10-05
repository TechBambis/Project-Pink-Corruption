# Optional cloud text inference

The application supports a server-configured Cydonia-24B-v4.3 endpoint. Selected conversation context and memories are sent to that endpoint. Audio rendering, microphone transcription, media, visuals and SQLite storage remain local.

## Connect your own endpoint

```sh
npm run setup -- --cloud
# Fill in the ignored .env.cloud file:
npm start
```

Set the URL, served model ID, API key and context capacity from your actual server. The named example contains placeholders only. Optional sampler settings, gateway authentication and token-counter settings are documented in [.env.cloud.example](../.env.cloud.example).

Choose Cydonia in the app after **/setup** reports readiness. Keys remain on the local server and are not returned to the browser. Setup does not create subscriptions or provision GPU tasks.

The native llama.cpp adapter uses its template/tokenizer to check the request budget. Mandatory persona/input content is not silently truncated; optional memory and complete older exchanges are fitted to available space. Match context settings to the server and available memory rather than selecting them from model file size alone.

## Optional remote provisioning

The setup helpers use the exact model revision and SHA-256 in [cydonia-cloud-model.json](cydonia-cloud-model.json). Model downloads happen only when explicitly invoked.

For a HyperAI workspace, follow [HYPERAI_PREP.md](HYPERAI_PREP.md), then [HYPERAI_OPERATIONS.md](HYPERAI_OPERATIONS.md) for repeat sessions and shutdown. `python3 scripts/cloud/package-setup.py` packages selected public setup files without credentials, model weights or internal verification reports.

A [SaladCloud setup example](SALAD_CLOUD.md) and [environment template](salad-cydonia-environment.json) are retained for that optional deployment.

Our serving helper binds inference to remote loopback and requires a private key file. Use a private SSH tunnel or a correctly authenticated HTTPS gateway. Do not expose the local Bambi UI or SQLite storage through the cloud endpoint.

An explicit tunnel example, using your own SSH details:

```sh
ssh -N -L 127.0.0.1:8085:127.0.0.1:8080 -L 127.0.0.1:8086:127.0.0.1:8082 USER@HOST
```

Set the local cloud URL to `http://127.0.0.1:8085`; keep the matching private model key in ignored local configuration. Stored server profiles are in [cydonia-server-profiles.json](cydonia-server-profiles.json); validate memory and latency on your actual allocation.

## Diagnostics and costs

**/setup** and reply diagnostics report planning, first-token, speech and browser playback timing. These are software clock measurements, not physical speaker latency.

`npm run eval:conversation` lists synthetic evaluation fixtures without inference. Adding `-- --run` calls the configured model and can consume paid compute; review its output manually.

Stop GPU resources in the provider dashboard when finished. Stopping local Bambi or only the inference process does not establish that provider billing has stopped.
