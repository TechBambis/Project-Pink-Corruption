# Optional cloud text inference

The application supports a server-configured llama.cpp, Ollama or OpenAI-compatible endpoint. Selected conversation context and memories are sent to that endpoint. Audio rendering, microphone transcription, media, visuals and SQLite storage remain local.

## Connect your own endpoint

```sh
npm run setup -- --cloud
# Fill in the ignored .env.cloud file:
npm start
```

Set the URL, served model ID, API key and context capacity from your actual server. The named example contains placeholders only. Optional sampler settings, gateway authentication and token-counter settings are documented in [.env.cloud.example](../.env.cloud.example).

Choose the configured model by name in the app after **/setup** reports readiness. Keys remain on the local server and are not returned to the browser. Setup does not create subscriptions or provision GPU tasks.

The native llama.cpp adapter uses its template/tokenizer to check the request budget. Mandatory persona/input content is not silently truncated; optional memory and complete older exchanges are fitted to available space. Match context settings to the server and available memory rather than selecting them from model file size alone.

## Connect an existing Ollama server

Use the exact model name from `/api/tags`, including its tag. For example, through your own local tunnel:

```dotenv
BAMBI_CLOUD_URL=http://127.0.0.1:11434
BAMBI_CLOUD_MODEL=qwen3.6-35b-a3b:latest
BAMBI_CLOUD_KIND=ollama
BAMBI_CLOUD_CONTEXT=32768
BAMBI_CLOUD_API_KEY=
BAMBI_CLOUD_GATEWAY_KEY=
BAMBI_CLOUD_DEFAULT=false
```

The native adapter disables thinking output, streams replies, supports structured listening decisions and requests the configured context size. Clear credentials and tokenizer settings belonging to a previous provider before switching endpoints. `BAMBI_CLOUD_DEFAULT=false` keeps remote inference from becoming the default for a new profile. Existing saved selections are preserved. The browser shows the configured model name.

The example requests 32,768 tokens to accommodate the full default Classic instructions. Use a capacity tested on the server. A model's advertised maximum is not its current runtime allocation. Larger contexts need additional memory and should be agreed with the server owner. At 4,096 tokens, long Classic instructions can exceed the budget; the app reports that rather than silently clipping them. Token budgeting for Ollama uses estimates.

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

Finding a model in `/setup` confirms availability, not that full session preparation has completed. Remote preparation uses `BAMBI_CLOUD_TIMEOUT_MS` (five minutes by default). Cold preparation processes the full fixed instructions and can be slow on a CPU-only server. Test the complete selected persona before inviting beta testers; a short connectivity reply does not validate that path.

`npm run eval:conversation` lists synthetic evaluation fixtures without inference. Adding `-- --run` calls the configured model and can consume paid compute; review its output manually.

Stop GPU resources in the provider dashboard when finished. Stopping local Bambi or only the inference process does not establish that provider billing has stopped.
