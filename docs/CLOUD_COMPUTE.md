# Optional cloud inference

Cloud sends selected conversation context and memories to your configured endpoint. Speech, recordings, media, visuals and SQLite stay local.

```sh
npm run setup -- --cloud
# Configure ignored .env.cloud from .env.cloud.example, then:
npm start
```

Set `BAMBI_CLOUD_URL`, the exact served `BAMBI_CLOUD_MODEL`, adapter (`llama.cpp`, `ollama` or `openai-compatible`), allocated context and credentials from your server. Keep `BAMBI_CLOUD_DEFAULT=false` for opt-in use. The [environment template](../.env.cloud.example) includes optional gateway/tokenizer settings. Keys stay server-side. Restart after changing configuration, check `/setup` readiness and select the model.

Use authenticated HTTPS or a private SSH tunnel. Do not expose the local Bambi UI or database. Native llama.cpp counts its template/tokenizer; Ollama uses estimates. Test the complete selected persona at the server's actual context capacity. Mandatory instructions are never silently clipped; a short connectivity reply is insufficient.

Cloud setup does not provision GPU resources or subscriptions. Monitor your provider's usage and stop resources there when finished; closing Bambi does not stop provider billing.
