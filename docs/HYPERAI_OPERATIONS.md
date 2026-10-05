# Reuse a prepared HyperAI workspace

Keep your downloaded model, pinned CUDA build and private inference key in persistent workspace storage. Reuse the prepared working directory rather than repeating downloads; confirm your provider's current restart/binding behavior in the [workspace documentation](https://hyper.ai/en/docs/gear/workspace).

## Start inference

Open the workspace and its terminal, then:

```sh
cd /hyperai/home/bambi-cloud-setup
export BAMBI_LLAMA_SERVER="$PWD/.runtime/cloud-llama/build/bin/llama-server"
# Select a context your actual GPU can sustain; match this in local .env.cloud:
export BAMBI_CLOUD_CONTEXT=16384
bash scripts/cloud/serve-cydonia.sh
```

A saved `.runtime/server-profile.json` supplies validated settings; explicit `BAMBI_CLOUD_*` environment values take precedence. Without a saved profile/override, the helper's context default is 32768. That default is not a memory guarantee. Check `nvidia-smi`, server startup and actual requests before increasing context.

Keep the existing `.runtime/cloud-api.key` private. The helper also starts the authenticated loopback token counter. [Server profile presets](cydonia-server-profiles.json) are examples to measure, not universal hardware defaults.

## Connect the local app

Copy the current SSH connection details from the running workspace. Register your own public SSH key as required by the provider. Open a tunnel on the machine running Bambi, using your actual private key path, port, user and host:

```sh
ssh -i /path/to/your/private-key \
  -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -N -L 127.0.0.1:8085:127.0.0.1:8080 \
  -L 127.0.0.1:8086:127.0.0.1:8082 \
  -p ACTUAL_SSH_PORT ACTUAL_USER@ACTUAL_HOST
```

Keep the tunnel terminal open. Do not open another tunnel on occupied local ports. Provider access values can change after a restart; see [SSH access](https://hyper.ai/en/docs/gear/ssh) and [tunnels](https://hyper.ai/en/docs/gear/ssh-tunnel).

In ignored local `.env.cloud`, set the endpoint to `http://127.0.0.1:8085`, the served model to `Cydonia-24B-v4.3`, the matching inference key and the same context as the server. Set `BAMBI_CLOUD_TOKENIZER_URL=http://127.0.0.1:8086` when using the counter forward; leave the Salad gateway key empty for this SSH connection.

Restart the local application after changing its environment:

```sh
source scripts/env.sh
python3 scripts/lifecycle.py restart-server
```

Open **/setup**, check cloud readiness and select Cydonia. Lifecycle reconnection exists for installations with a deliberately configured private tunnel state; a fresh clone does not contain that state or your SSH keys. The manual tunnel above is sufficient for a first connection.

## Finish and troubleshoot

Stop the GPU workspace/container in the provider dashboard and confirm its stopped state. Closing Bambi, Jupyter or only the inference process does not establish that billed compute has stopped. [Usage accounting](https://hyper.ai/en/docs/getting-started/quota-and-usage).

If authentication fails, check the current access details and registered public key. If ports are occupied, reuse or close the existing tunnel. If readiness fails, check workspace state, inference logs and the tunnel. Missing binaries/libraries after restart require the preparation steps in [HYPERAI_PREP.md](HYPERAI_PREP.md).

Only selected text context goes to the configured cloud endpoint; audio, media and SQLite stay on the local application machine.
