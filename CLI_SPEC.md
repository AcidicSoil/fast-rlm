# fast-rlm CLI Specification (v1)

This document defines the command-line interface specification for `fast-rlm`.
It specifies syntax and behavior only.

## Scope and compatibility

This spec defines a single `rlm` CLI namespace and behavior.

Backward compatibility requirements:
- `./rlm` remains valid and maps to `rlm run`.
- `./rlm-smoke` remains valid and maps to `rlm smoke`.
- `./viewlog` remains a separate adjacent TUI utility.
- `rlm run` preserves the `JSON_RESULT:{...}` compatibility line in default (human) mode.

## Command tree

- `rlm [global flags] <subcommand> [args]`
  - `run`
  - `smoke`
  - `logs view <log-file> [--tree|--stats|--linear]`
  - `completion <bash|zsh|fish>`
  - `help`
  - `version`

Bare command behavior:
- `rlm` with piped stdin behaves as `rlm run`.
- `rlm` with TTY and no stdin shows help and exits with code `2`.

## Global flags

- `-h, --help`: Show help for current command scope.
- `--version`: Print version and exit `0`.
- `--json`: Emit machine-readable JSON where supported.
- `--no-color`: Disable ANSI color output.
- `-q, --quiet`: Suppress non-essential human informational output.
- `-v, --verbose`: Enable extra diagnostic human output.
- `--plain`: Reserved/deferred in v1 (spec-defined, implementation optional).

## Subcommand specs

### `rlm run`

Primary input contract:
- Reads task/context from stdin.

Flags:
- `--prefix <string>`: Set run log prefix.
- `--output <file>`: Write structured JSON output file.
- `--json`: Emit stable machine JSON on stdout.

Behavior:
- Runs recursive subagent execution using configured runtime models.
- Writes JSONL logs for each run.
- In default human mode, keeps backward-compatible sentinel output:
  - `JSON_RESULT:{"results": ...}`
- `--output <file>` writes:

```json
{
  "results": "...any JSON value or null...",
  "log_file": "string or null",
  "error": "string (optional)"
}
```

`--output` overwrite semantics:
- Overwrites existing file path.

### `rlm smoke`

Input:
- No positional args by default.

Behavior:
- Performs proxy preflight checks:
  - `GET /models`
  - `POST /chat/completions`
- Non-mutating network health check semantics.

Machine output:
- `--json` is spec-defined for this command; implementation may be staged.

### `rlm logs view`

Usage:
- `rlm logs view <log-file> [--tree|--stats|--linear]`

Modes:
- `--tree`: Default tree view.
- `--stats`: Aggregate stats view.
- `--linear`: Linear chronological event view.

Behavior:
- Read-only log inspection.
- Unknown/invalid mode flag is usage error (`2`).

## I/O contract

General rule:
- stdout: primary output (human or machine).
- stderr: diagnostics, warnings, usage/fatal errors.

### `rlm run` output modes

Default human mode (no `--json`):
- Human progress lines are non-stable.
- Must include stable compatibility sentinel line:
  - `JSON_RESULT:{...}`

Machine mode (`--json`):
- stdout emits exactly one JSON object:

```json
{
  "ok": true,
  "results": "...any JSON value...",
  "log_file": "logs/....jsonl",
  "error": null,
  "warnings": []
}
```

On failure:

```json
{
  "ok": false,
  "results": null,
  "log_file": "logs/....jsonl or null",
  "error": "message",
  "warnings": ["optional warning strings"]
}
```

No extra human lines on stdout in `--json` mode.

## Config and environment rules

### Required proxy connection env

- `RLM_MODEL_BASE_URL` (must end with `/v1`)
- `RLM_MODEL_API_KEY`

`.env` loading by wrappers/tasks is convenience only.

### Model selection precedence

Requested model names precedence:
1. Future CLI model flags (if added)
2. Env vars:
   - `RLM_PRIMARY_AGENT`
   - `RLM_SUB_AGENT`
3. `rlm_config.yaml`:
   - `primary_agent`
   - `sub_agent`
4. Built-in defaults

Runtime model resolution may differ from requested models after `/models` preflight.
Fallback order includes:
- `RLM_FALLBACK_PRIMARY`, `RLM_FALLBACK_SUB`
- internal fallback lists
- first available model

Fallback/warning messages should be surfaced.

### Budget/safety config keys (`rlm_config.yaml`)

- `max_calls_per_subagent`
- `max_depth`
- `truncate_len`
- `max_prompt_tokens`
- `max_completion_tokens`
- `max_money_spent` is deprecated/ignored

## Exit code taxonomy

- `0`: success
- `1`: generic/unclassified failure
- `2`: invalid usage / argument validation
- `3`: config/env error
- `4`: proxy/network/API failure
- `5`: model preflight/resolution failure
- `6`: runtime execution failure
- `7`: output write failure (`--output`)
- `130`: interrupted (SIGINT/Ctrl-C)

Error messaging:
- concise, actionable, stderr-first.

## Safety and operational rules

- `rlm run` is stdin-first and non-interactive by default.
- With TTY + no stdin, show help rather than prompting.
- Respect color conventions (`--no-color`, `NO_COLOR`, `TERM=dumb`).
- SIGINT should terminate promptly with bounded cleanup and code `130`.
- Logs may contain prompt/output snippets; treat logs as sensitive run artifacts.

## Completion

Spec-defined command:
- `rlm completion bash`
- `rlm completion zsh`
- `rlm completion fish`

If not implemented yet:
- print actionable “not implemented” message to stderr
- exit `1`

## Examples

```bash
./rlm < input.txt
```

```bash
rlm run < input.txt
```

```bash
rlm run --prefix demo < input.txt
```

```bash
rlm run --output result.json < input.txt
```

```bash
rlm run --json < input.txt
```

```bash
./rlm-smoke
```

```bash
rlm smoke
```

```bash
rlm logs view logs/<file>.jsonl --tree
```

```bash
rlm logs view logs/<file>.jsonl --stats
```

```bash
rlm logs view logs/<file>.jsonl --linear
```

```bash
./viewlog logs/<file>.jsonl
```