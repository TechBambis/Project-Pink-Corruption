# Cydonia on SaladCloud: initial RTX 3090 deployment

This configuration serves inference only. Bambi's application, SQLite, microphone, Kokoro and playback remain on your local machine. Your private repository does not need to be uploaded. This is a setup example, not a verified native/cloud support guarantee.

## Fill in the container form

| Portal field | Initial value |
| --- | --- |
| Container Group Name | `bambi-cydonia-test` |
| Public/private registry | Public Registry |
| Registry service, if requested | GitHub Container Registry / GHCR |
| Image Name | `ghcr.io/ggml-org/llama.cpp:server-cuda-b11382` |
| GPU | RTX 3090, 24 GB |
| vCPU / RAM / disk | 4 / 24 GB / 50 GB |
| Replicas | 1 |
| Priority | Low |
| Scheduled scaling | Disabled for the initial manual test |
| Command | Leave unset: use the image's existing `/app/llama-server` entrypoint |
| Container Gateway | Enable, port `8080`, authentication enabled |
| Limit each server to a single active connection | Disabled; llama.cpp supplies one inference slot while metadata requests can still run |
| Gateway server response timeout | `100000` milliseconds |

The official public CUDA 12 image and its AMD64 manifest were verified in GHCR on 2026-10-05. Version: `b11382`; source revision: `11fe02151f79c41d0d4af7da708755d73b9c0da6`. For an immutable AMD64 image reference use:

```text
ghcr.io/ggml-org/llama.cpp@sha256:e8318a7b3988f9ca57b28c03486569e60def08f2b7b060550ebfa046e175e6cb
```

The manifest describes about 2.59 GB of compressed image layers. This is registry verification, not a live Salad GPU test. Use CUDA 12 for this first 3090 baseline; the CUDA 13 tag is a separate image and may require a newer host driver. [Official images](https://github.com/ggml-org/llama.cpp/blob/master/docs/docker.md).

## Environment variables

The exact key/value template is [salad-cydonia-environment.json](salad-cydonia-environment.json). Enter its pairs in the portal's Environment Variables editor. Replace `LLAMA_API_KEY` with a private randomly generated model key. This placeholder must not be used as an actual credential. The public model does not require an HF token.

The template starts at 16,384 context tokens, one inference slot, full GPU offload, Flash Attention and Q8 KV cache. A smaller physical batch limits working buffers. The additional host prompt cache is disabled to leave headroom within 24 GB RAM; active-slot prompt caching still works. Keep mmap defaults and do not enable mlock for this initial configuration.

The immutable model URL is pinned to the same revision as [the model manifest](cydonia-cloud-model.json). The stock server downloads the model to `/tmp/cydonia-q5.gguf` at startup. Unlike our separate Python download helper, this stock-image path does not independently verify the repository's SHA-256. It uses the pinned HTTPS artifact URL. [Server flags and environment variables](https://github.com/ggml-org/llama.cpp/blob/11fe02151f79c41d0d4af7da708755d73b9c0da6/tools/server/README.md).

Do not put `docker run` in Command. A Salad command replaces both CMD and ENTRYPOINT. Environment variables are enough for this image. [Command behavior](https://docs.salad.com/container-engine/how-to-guides/specifying-a-command).

`LLAMA_ARG_HOST=::` provides the IPv6 listener required by Salad's gateway. [IPv6 requirement](https://docs.salad.com/container-engine/how-to-guides/gateway/enabling-ipv6).

## Startup and readiness

Configure an **exec** startup probe with these individual command arguments:

```json
["curl", "--noproxy", "*", "--fail", "--silent", "--max-time", "3", "http://[::1]:8080/health"]
```

Use a 10-second period, 5-second timeout, success threshold 1 and failure threshold 360: approximately one hour of startup tolerance for slow model downloads. These are initial settings, not a startup-time prediction. Use the same exec command for readiness with a 10-second period and failure threshold 3. Leave liveness disabled for the first baseline to avoid unnecessary restarts during debugging. Probe traffic runs inside the container; it does not require the gateway key.

The 16,763,985,312-byte model alone takes approximately 22 minutes at a sustained 100 Mbit/s, or 4.5 minutes at 500 Mbit/s, before allocation/loading overhead. Actual bandwidth varies. Salad discards runtime storage on stop or node reallocation, so a new node must download it again. This is why one Low-priority replica is an inexpensive test target rather than an always-available service. [Startup probes](https://docs.salad.com/container-engine/explanation/infrastructure-platform/startup-probes), [storage lifecycle](https://docs.salad.com/container-engine/tutorials/performance/high-performance-storage-solutions), [priority interruptions](https://docs.salad.com/container-engine/explanation/billing-pricing/priority-pricing).

Q5 with 16K context is a plausible 24 GB starting point, not a measured VRAM guarantee. Confirm full offload and actual allocations in logs. If it fails for GPU memory, reduce batch buffers or context while keeping Bambi's context setting matched. Increase to 24K/32K only after a successful baseline; the full persona is retained and an undersized mandatory prompt is rejected rather than silently cut.

## Connect the local app

Copy the container group's actual HTTPS access domain from Salad. In your ignored local `.env.cloud` set:

```dotenv
BAMBI_CLOUD_URL=https://YOUR-ACTUAL-SALAD-ACCESS-DOMAIN
BAMBI_CLOUD_MODEL=Cydonia-24B-v4.3
BAMBI_CLOUD_API_KEY=YOUR-PRIVATE-MODEL-KEY
BAMBI_CLOUD_GATEWAY_KEY=YOUR-SALAD-API-KEY
BAMBI_CLOUD_CONTEXT=16384
BAMBI_CLOUD_KIND=llama.cpp
BAMBI_CLOUD_TIMEOUT_MS=300000
BAMBI_CLOUD_DEFAULT=false
```

The model key is the value of container `LLAMA_API_KEY`. The gateway key is your Salad API key and is never placed in the inference container or browser. The local adapter sends both `Authorization: Bearer …` and `Salad-Api-Key: …` for models, templates, tokenization and generation. [Gateway authentication](https://docs.salad.com/container-engine/how-to-guides/gateway/sending-requests).

Reload the local application-owned server:

```bash
source scripts/env.sh
python3 scripts/lifecycle.py restart-server
```

Open `/setup` and check cloud readiness, then select Cydonia in Voice & AI. A 300-second application timeout cannot override Salad's gateway response timeout; long initial prefill must reach streaming output before that deadline. [Gateway limits](https://docs.salad.com/container-engine/explanation/gateway/load-balancer-options).

Start with ordinary chat and a short interrupted voice response. For an explicitly billable evaluation use `npm run eval:conversation -- --run --limit 12`, then review the report before expanding. No generation request is automatically retried after an uncertain failure.

## Billing and availability

Check current [provider pricing](https://salad.com/pricing/) and your dashboard before starting a deployment. Rates, allocations and interruptions are provider-controlled. Keep one replica for an initial test and stop the group afterward; verify its stopped state. Closing local Bambi does not stop provider compute. Historical price calculations stay in the local archive.
