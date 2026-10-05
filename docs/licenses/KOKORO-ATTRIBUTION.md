# Kokoro voice embedding attribution

`voices/bambi_classic.npy` is a modified derivative of the Kokoro-82M v1.0 voice embeddings published by hexgrad under Apache-2.0. Upstream model card and license declaration: https://huggingface.co/hexgrad/Kokoro-82M. Release files: https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1.

Modification: normalized averaging of `af_nicole` (0.15), `af_bella` (0.425) and `af_heart` (0.425). The method, weights and SHA-256 of the raw tensor bytes (excluding the NPY header) are recorded in `voices/bambi_classic.json`. No reference recordings were used. This local blend is not an unchanged upstream voice.

The complete Apache-2.0 license is retained in [KOKORO-APACHE-2.0.txt](KOKORO-APACHE-2.0.txt). This notice applies to the derived embedding, not to the whole application's own source code.
