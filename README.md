# fast-rlm

A minimal implementation of Recursive Language Models (RLMs) using Deno and Pyodide.

> **📺 Watch the full video for free**
> **[RLM Tutorial](https://youtu.be/nxaVvvrezbY)**

## What are RLMs

RLMs are an inference technique where an LLM interacts with arbitrarily long prompts through an external REPL. The LLM can write code to explore, decompose, and transform the prompt. It can recursively invoke sub-agents to complete smaller subtasks. Crucially, sub-agent responses are not automatically loaded into the parent agent's context — they are returned as symbols or variables inside the parent's REPL.

## Support

If you find this helpful, consider supporting on Patreon — it hosts all code, projects, slides, and write-ups from the YouTube channel.

[<img src="https://c5.patreon.com/external/logo/become_a_patron_button.png" alt="Become a Patron!" width="200">](https://www.patreon.com/NeuralBreakdownwithAVB)

---

## Installation

### 1. Install Deno

```bash
curl -fsSL https://deno.land/install.sh | sh
```

Then follow the instructions to add Deno to your `PATH`, or add it manually:

```bash
export DENO_INSTALL="$HOME/.deno"
export PATH="$DENO_INSTALL/bin:$PATH"
```

Verify:

```bash
deno --version
```

### 2. Install uv (Python package manager)

To use from python scripts, or try benchmarking with huggingface datasets

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 3. Install Bun (for the log viewer)

```bash
curl -fsSL https://bun.sh/install | bash
```

### 4. Install log viewer dependencies

```bash
cd tui_log_viewer && bun install
```

---

## Provider Setup (CLIProxyAPI)

fast-rlm expects an OpenAI-compatible proxy endpoint (for example, CLIProxyAPI).
Set runtime env vars in either `.env` or `.envrc`:

**.env**
```
RLM_MODEL_BASE_URL=http://127.0.0.1:8317/v1
RLM_MODEL_API_KEY=rlm-local
```

**.envrc**
```bash
export RLM_MODEL_BASE_URL=http://127.0.0.1:8317/v1
export RLM_MODEL_API_KEY=rlm-local
```

Optional model overrides:

```bash
export RLM_PRIMARY_AGENT=gpt-5
export RLM_SUB_AGENT=gpt-5-codex-mini
```

Optional pinned fallbacks if requested models are not available in `/models`:

```bash
export RLM_FALLBACK_PRIMARY=gpt-5
export RLM_FALLBACK_SUB=gpt-5-codex-mini
```

Use `deno task ...` (or `./rlm` / `./rlm-smoke`) so `.env` is loaded via `--env-file=.env`.
If using `.envrc`, run `direnv allow` once in the project root.

Quick smoke test against the proxy before running a full subagent task:

```bash
deno task smoke_proxy
```

---

## Configuration

All hyperparameters are set in `rlm_config.yaml` at the project root:

```yaml
max_calls_per_subagent: 20   # max LLM calls a single subagent can make
max_depth: 3                 # max recursive subagent depth
truncate_len: 5000           # output characters shown to the LLM per step
primary_agent: "gpt-5"               # root-agent model (native ID from /models)
sub_agent: "gpt-5-codex-mini"        # child-agent model (native ID from /models)
max_prompt_tokens: 200000            # hard cap across all runs
max_completion_tokens: 50000         # hard cap across all runs
```

Edit this file to change any setting before running. If the file is missing, built-in defaults are used.
Do not use OpenRouter-style `provider/model` identifiers; use model IDs returned by your proxy `/models` endpoint.

---

## Running Examples

A working example is in `test_counting_r.ts`. Run it with:

```bash
deno task smoke_proxy
deno task test_counting_r
```

Direct wrappers (same behavior, `.env` included by default):

```bash
./rlm-smoke
./rlm < input.txt
```

To write your own script, copy `test_counting_r.ts` and edit the `PROMPT` and `PREFIX` constants at the top. Then run it directly:

```bash
FORCE_COLOR=1 deno run --env-file=.env --allow-read --allow-env --allow-net --allow-sys=hostname --allow-write your_script.ts
```

Or add it as a task in `deno.json` the same way `test_counting_r` is defined.

---

## CLI Spec (Unified `rlm` namespace)

A unified CLI interface spec is documented in [`CLI_SPEC.md`](./CLI_SPEC.md).

It defines the command tree and behavior for:
- `rlm run` (compatible with `./rlm`)
- `rlm smoke` (compatible with `./rlm-smoke`)
- `rlm logs view` (CLI log inspection)

Compatibility notes:
- `./viewlog` remains the separate interactive TUI log viewer utility.
- `rlm run` preserves the `JSON_RESULT:{...}` output line for script compatibility, and also defines a cleaner `--json` mode.

---

## Running Benchmarks

First install Python dependencies (only needed for benchmarks):

```bash
uv sync
```

All benchmarks are under `benchmarks/` and use `uv run`:

```bash
uv run benchmarks/oolong_synth_benchmark.py
uv run benchmarks/longbench_benchmark.py
```

---

## Log Viewer

![TUI Log Viewer](images/tui.jpeg)

Every run saves a `.jsonl` log file to `logs/`. Use the `viewlog` script to open it in the interactive TUI viewer:

```bash
./viewlog logs/<logfile>.jsonl
```

You can also pass just the filename if the log is in the `logs/` directory:

```bash
./viewlog my_run_abc123.jsonl
```

Run `./viewlog` with no arguments to list recent logs.

### Installing the log viewer (OpenTUI app)

The viewer is a Bun + OpenTUI app in `tui_log_viewer/`. Install its dependencies once:

```bash
cd tui_log_viewer && bun install
```

After that `./viewlog` handles launching it automatically.
