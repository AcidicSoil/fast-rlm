## Handoff: switch `fast-rlm` to an existing `CLIProxyAPI` endpoint

### Inputs the user provides

* `CLI_PROXY_BASE_URL` (example: `http://127.0.0.1:8317/v1`)
* `CLI_PROXY_API_KEY` (example: `rlm-local`)

---

## 1) Set runtime env vars (overrides built-in defaults)

### WSL/Linux (bash)

```bash
export RLM_MODEL_BASE_URL="$CLI_PROXY_BASE_URL"
export RLM_MODEL_API_KEY="$CLI_PROXY_API_KEY"
```

### One-liner (no shell state)

```bash
RLM_MODEL_BASE_URL="$CLI_PROXY_BASE_URL" \
RLM_MODEL_API_KEY="$CLI_PROXY_API_KEY" \
python test_counting_r.py
```

---

## 2) Verify the endpoint is OpenAI-compatible (models + chat)

```bash
curl -s "$CLI_PROXY_BASE_URL/models" \
  -H "Authorization: Bearer $CLI_PROXY_API_KEY" | head
```

```bash
curl -s "$CLI_PROXY_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $CLI_PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gemini-2.5-pro",
    "messages":[{"role":"user","content":"Reply with the single word: ok"}]
  }'
```

If `/models` works but chat fails, the usual cause is an invalid/unsupported `model` name for the proxy. Use one returned by `/models`.

---

## 3) Update `fast-rlm` model IDs (important)

When you point `fast-rlm` at `CLIProxyAPI`, you generally stop using OpenRouter-style IDs (`provider/model`). Use the *native* IDs exposed by the proxy (e.g., `gemini-2.5-pro`, `gemini-2.5-flash`, `gpt-5-codex`, `claude-…`), based on what `/models` returns.

Minimal config (`rlm_config.yaml`):

```yaml
primary_agent: "gpt-5"
sub_agent: "gpt-5-codex-mini"
max_depth: 3
max_completion_tokens: 50000
max_prompt_tokens: 200000
```

Optional runtime overrides:

```bash
export RLM_PRIMARY_AGENT="gpt-5"
export RLM_SUB_AGENT="gpt-5-codex-mini"
export RLM_FALLBACK_PRIMARY="gpt-5"
export RLM_FALLBACK_SUB="gpt-5-codex-mini"
```

---

## 4) Disable/avoid OpenRouter-only knobs (if present in your config)

* If you have `max_money_spent` / spend-based gating: expect it to be unreliable unless the proxy/provider returns cost metadata. Use token caps instead.
* If you hardcoded OpenRouter model names anywhere (`openrouter/...`, `z-ai/...`, `minimax/...`): replace them with proxy model IDs.

---

## 5) Quick checklist (what “done” looks like)

* `RLM_MODEL_BASE_URL` points at `.../v1`
* `RLM_MODEL_API_KEY` is accepted by the proxy
* `/models` returns a list
* `fast-rlm` config uses model IDs that appear in that list
* A single `run(...)` call succeeds without referencing OpenRouter-formatted models
