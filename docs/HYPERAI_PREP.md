# Prepare Cydonia before starting paid GPU compute

Use a CPU workspace for model download and, if a CUDA development image is available, compilation. No GPU is required to download a GGUF. Select any free-CPU option only if your account currently offers it; use the allowance displayed in the provider dashboard. This workflow does not assume a free-session duration. [CPU membership](https://hyper.ai/en/docs/membership).

## Upload the small setup bundle

Use `bambi-cydonia-prep` as the workspace name, leave initial data bindings empty and allocate enough persistent storage for the 16.8 GB model and build files. When possible use the same `pytorch-2.8-2204` / CUDA 12.8 image for CPU preparation and the later GPU execution. Availability of that image on Free CPU is not verified. Download-only preparation works in a regular Python CPU image as well.

Upload `bambi-cloud-setup.zip` to the Jupyter file browser under `/hyperai/home`. It contains only public model metadata, download/build/serve helpers and this guide. It contains no application source, authored persona, conversations, credentials or model weights.

From your local Bambi checkout, generate this bundle with `python3 scripts/cloud/package-setup.py`. The ZIP is written to `runtime/bambi-cloud-setup.zip`. Packaging does not download the model or start compute resources.

In the workspace terminal:

```bash
cd /hyperai/home
python3 -m zipfile -e bambi-cloud-setup.zip .
cd bambi-cloud-setup
python3 scripts/cloud/download-model.py
```

The helper downloads the pinned public Q5_K_M file to `models/cloud`, prints progress, resumes a partial download when run again and checks file size and SHA-256 before activating it. It does not need a Hugging Face token. Keep this folder under `/hyperai/home` so the model and scripts are preserved when closing the execution. [Persistent working directory](https://hyper.ai/en/docs/gear/output).

### If the workspace cannot reach Hugging Face

`Network is unreachable` is a connection failure, not a model-size or authentication error. Check IPv4 and IPv6 separately without downloading weights:

```bash
python3 scripts/cloud/check-network.py
```

If IPv4 works but IPv6 fails, use `python3 scripts/cloud/download-model.py --ipv4`. HyperAI's FAQ recommends `https://hf-mirror.com` for Hugging Face connection problems. To opt into that public mirror:

```bash
HF_ENDPOINT=https://hf-mirror.com python3 scripts/cloud/download-model.py --ipv4
```

This changes only the public artifact host. Revision, byte count and SHA-256 checks remain pinned, and no token is sent. A reachable homepage does not establish reachable model redirects/CDN; verify the actual download. If neither endpoint is reachable, stop retrying the large download and check outbound connectivity with the provider or download locally and upload the verified file. Port mapping handles incoming services; it does not fix outbound downloads. [Provider's Hugging Face troubleshooting](https://beta.hyper.ai/en/docs/gear/faq).

The current helper explicitly follows HTTP 308 redirects for GET/HEAD, including on Python 3.10 images. If an earlier bundle exits with HTTP 308, replace its helper with the current bundle before retrying. Redirect loop limits, Range validation and the pinned size/SHA-256 checks still apply.

## Optional CUDA build on the CPU workspace

Check the toolkit:

```bash
nvcc --version
```

CUDA must be at least 12.8 for the intended Blackwell GPU. A CUDA runtime label alone does not establish that `nvcc` is installed. If the compiler is absent, finish the model download first; compile later in a CUDA development environment.

For an Ubuntu image that has `nvcc` but lacks ordinary development packages, install the following in the cloud workspace. Run as root, or prefix the commands with `sudo` if that is how the image grants access:

```bash
apt-get update
apt-get install -y git cmake build-essential libcurl4-openssl-dev libssl-dev
bash scripts/cloud/build-llama.sh
```

This checks out the pinned upstream revision and explicitly targets CUDA architecture 120, so GPU discovery is not needed during compilation. It uses two build jobs by default to limit memory pressure. It does not run inference or create a provider task. Runtime libraries and the NVIDIA driver still need to be compatible on the later GPU workspace. [Upstream CUDA build](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md), [Blackwell toolchain requirement](https://github.com/ggml-org/llama.cpp/blob/master/ggml/src/ggml-cuda/CMakeLists.txt).

System packages installed outside `/hyperai/home` are not preserved by traditional HyperAI containers. The model, source and build output are preserved inside the working directory; reuse the same base image and reinstall missing system dependencies after restart. Check CUDA compatibility on your own allocation. [Storage persistence](https://hyper.ai/en/docs/gear/storage-persistence).

## Close CPU preparation, then bind it to GPU

After a successful download, close the CPU execution in the portal and check its saved Working Directory. Start/restart a GPU execution and select that previous directory as the working directory at `/hyperai/home` in Bind data. This copies its contents to the new execution and consumes additional storage. Avoid repeatedly duplicating the entire model; check your actual storage quota. [Binding behavior](https://hyper.ai/en/docs/gear/databinding).

For repeated use, a private data warehouse model with read-only input binding can avoid repeated workspace copies. That is a later refinement; the first CPU-to-GPU transfer can use the saved working directory. If you bind the prepared directory at `/hyperai/input/input0` instead, it is read-only: point `BAMBI_CLOUD_MODEL_FILE` at the actual model there and keep runtime/key files in a writable workspace.

In the GPU workspace, confirm the actual available GPU memory with `nvidia-smi`, finish the build if needed, then:

```bash
cd /hyperai/home/bambi-cloud-setup
umask 077
mkdir -p .runtime
python3 - <<'PY'
from pathlib import Path
import secrets
key = Path('.runtime/cloud-api.key')
if not key.exists():
    key.write_text(secrets.token_hex(32) + '\n')
    key.chmod(0o600)
print('Private key is ready in .runtime/cloud-api.key; keep it private.')
PY
export BAMBI_LLAMA_SERVER="$PWD/.runtime/cloud-llama/build/bin/llama-server"
export BAMBI_CLOUD_CONTEXT=16384
bash scripts/cloud/serve-cydonia.sh
```

This creates a private model key without overwriting an existing one, starts one slot and binds port 8080 to loopback. For a 24 GB VRAM allocation, 16K is the initial context baseline. Match the app's context setting to the running server. Previous development measurements are retained locally; [CLOUD_COMPUTE.md](CLOUD_COMPUTE.md) describes connection and diagnostics.

Access it from the local app through HyperAI's SSH access details and a local tunnel:

```bash
ssh -N -L 127.0.0.1:8085:127.0.0.1:8080 -p ACTUAL_SSH_PORT ACTUAL_USER@ACTUAL_HOST
```

Use the account's actual connection values. Configure your local `.env.cloud` URL to `http://127.0.0.1:8085`, the model ID to `Cydonia-24B-v4.3`, context to `16384` and the private key to the file's value. Leave `BAMBI_CLOUD_GATEWAY_KEY` empty for this tunnel. [HyperAI SSH tunnels](https://hyper.ai/en/docs/gear/ssh-tunnel).

Stop the GPU execution in the provider portal when finished. Closing the browser or stopping only llama-server does not stop container compute usage. [Usage accounting](https://hyper.ai/en/docs/getting-started/quota-and-usage).

For the next session, reuse the prepared workspace instead of repeating download and compilation. [HYPERAI_OPERATIONS.md](HYPERAI_OPERATIONS.md) explains restarting the server, finding the current SSH port, reconnecting the local tunnel and stopping the workspace afterward.
