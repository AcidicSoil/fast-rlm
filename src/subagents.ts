import { loadPyodide } from "pyodide";
import { parse as parseYaml } from "@std/yaml";
import { generate_code, Usage } from "./call_llm.ts";
import { Logger, setLogPrefix, getLogFile, setTerminalLoggingEnabled } from "./logging.ts";
import { startSpinner, showGlobalUsage, showPythonReady, showLlmQueryCall, setTerminalUiEnabled } from "./ui.ts";
import { trackUsage, getTotalUsage, resetUsage } from "./usage.ts";
import {
    fetchAvailableModels,
    resolveModelNames,
    resolveProxyClientConfig,
    resolveRuntimeModels,
    resolveTokenLimits,
    type RuntimeModelResolution,
} from "./provider_config.ts";
import chalk from "npm:chalk@5";
import { CliError, EXIT_CODES, printJsonEnvelope } from "./cli_common.ts";

interface RlmConfig {
    max_calls_per_subagent?: number;
    max_depth?: number;
    truncate_len?: number;
    primary_agent?: string;
    sub_agent?: string;
    max_prompt_tokens?: number;
    max_completion_tokens?: number;
    max_money_spent?: number;
}

function loadConfig(): RlmConfig {
    try {
        const configPath = new URL("../rlm_config.yaml", import.meta.url).pathname;
        const raw = Deno.readTextFileSync(configPath);
        return (parseYaml(raw) as RlmConfig) ?? {};
    } catch {
        return {};
    }
}

const _config = loadConfig();
const MAX_CALLS = _config.max_calls_per_subagent ?? 20;
const MAX_DEPTH = _config.max_depth ?? 3;
const TRUNCATE_LEN = _config.truncate_len ?? 5000;
const REQUESTED_MODELS = resolveModelNames(_config);
const { maxPromptTokens: MAX_PROMPT_TOKENS, maxCompletionTokens: MAX_COMPLETION_TOKENS } =
    resolveTokenLimits(_config);

function emitConfigWarnings(): void {
    if (_config.max_money_spent !== undefined && humanOutputEnabled) {
        console.warn(
            "max_money_spent is deprecated and ignored. Use max_prompt_tokens and max_completion_tokens.",
        );
    }
}

async function resolveRuntimeModelSelection(): Promise<RuntimeModelResolution> {
    const proxy = resolveProxyClientConfig();
    const availableModels = await fetchAvailableModels(proxy);
    const resolution = resolveRuntimeModels(REQUESTED_MODELS, availableModels);

    if (humanOutputEnabled) {
        console.log(
            chalk.dim(
                `Model preflight: requested primary='${REQUESTED_MODELS.primaryAgent}', sub='${REQUESTED_MODELS.subAgent}'`,
            ),
        );
        console.log(
            chalk.dim(
                `Model preflight: using primary='${resolution.primaryAgent}', sub='${resolution.subAgent}'`,
            ),
        );
        for (const warning of resolution.warnings) {
            console.warn(chalk.yellow(`Model preflight warning: ${warning}`));
        }
    }

    return resolution;
}

let humanOutputEnabled = true;

export function setSubagentHumanOutputEnabled(enabled: boolean): void {
    humanOutputEnabled = enabled;
    setTerminalUiEnabled(enabled);
    setTerminalLoggingEnabled(enabled);
}

function truncateText(text: string): string {
    let truncatedOutput = "";
    if (text.length > TRUNCATE_LEN) {
        truncatedOutput = `[TRUNCATED: Last ${TRUNCATE_LEN} chars shown].. ` + text.slice(-TRUNCATE_LEN);
    } else if (text.length === 0) {
        truncatedOutput = "[EMPTY OUTPUT]";
    } else {
        truncatedOutput = "[FULL OUTPUT SHOWN]... " + text;
    }
    return truncatedOutput;
}

export async function subagent(
    context: string,
    subagent_depth = 0,
    parent_run_id?: string,
    runtimeModels?: RuntimeModelResolution,
) {
    emitConfigWarnings();
    const logger = new Logger(subagent_depth, MAX_CALLS, parent_run_id);

    const models = runtimeModels ?? await resolveRuntimeModelSelection();
    const model_name = subagent_depth == 0 ? models.primaryAgent : models.subAgent;
    let stdoutBuffer = "";

    const pyodide = await loadPyodide({
        stderr: (text: string) => console.error(`[Python Stderr]: ${text}`),
        stdout: (text: string) => {
            stdoutBuffer += text + "\n";
        },
    });
    showPythonReady(subagent_depth);

    const llm_query = async (context: string) => {
        if (subagent_depth >= MAX_DEPTH) {
            stdoutBuffer += "\nError: MAXIMUM DEPTH REACHED. You must solve this task on your own without calling llm_query.\n";
            throw new Error("MAXIMUM DEPTH REACHED. You must solve this task on your own without calling llm_query.");
        }
        showLlmQueryCall(subagent_depth);
        const output = await subagent(context, subagent_depth + 1, logger.run_id, models);
        return output;
    };
    pyodide.globals.set("llm_query", llm_query);

    // Initialize context
    // We use JSON.stringify to safely embed the string into Python code
    const setup_code = `
context = ${JSON.stringify(context)}
__final_result__ = None

def FINAL(x):
    global __final_result__
    __final_result__ = x

def FINAL_VAR(x):
    global __final_result__
    __final_result__ = x
`;
    await pyodide.runPythonAsync(setup_code);

    const initial_code = `
print("Context type: ", type(context))
print(f"Context length: {len(context) if hasattr(context, '__len__') else 'N/A'}")

if len(context) > 500:
    print(f"First 500 characters of str(context): ", str(context)[:500])
    print("---")
    print(f"Last 500 characters of str(context): ", str(context)[-500:])
else:
    print(f"Context: ", context)
`;
    stdoutBuffer = "";
    await pyodide.runPythonAsync(initial_code);
    const messages = [
        {
            "role": "user", "content": `
Outputs will always be truncated to last ${TRUNCATE_LEN} characters.
code:\n\`\`\`repl\n${initial_code}\n\`\`\`\n
Output:\n${stdoutBuffer.trim()}
    `,
        },
    ];

    // Step 0 has no usage (just initial context)
    const noUsage: Usage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        cached_tokens: 0,
        reasoning_tokens: 0,
        cost: 0,
    };

    logger.logStep({
        step: 0,
        code: initial_code,
        output: stdoutBuffer.trim(),
        hasError: false,
        usage: noUsage,
    });

    for (let i = 0; i < MAX_CALLS; i++) {
        const llmSpinner = startSpinner("Generating code...");
        const { code, success, message, usage } = await generate_code(messages, model_name);
        messages.push(message);

        // Track usage globally
        trackUsage(usage);
        const totalUsage = getTotalUsage();
        if (
            MAX_PROMPT_TOKENS !== undefined &&
            totalUsage.prompt_tokens > MAX_PROMPT_TOKENS
        ) {
            throw new Error(
                `Prompt token budget exceeded: ${totalUsage.prompt_tokens} used, limit is ${MAX_PROMPT_TOKENS}`,
            );
        }
        if (
            MAX_COMPLETION_TOKENS !== undefined &&
            totalUsage.completion_tokens > MAX_COMPLETION_TOKENS
        ) {
            throw new Error(
                `Completion token budget exceeded: ${totalUsage.completion_tokens} used, limit is ${MAX_COMPLETION_TOKENS}`,
            );
        }

        llmSpinner.success("Code generated");

        if (!success) {
            logger.logStep({ step: i + 1, code, reasoning: message.reasoning, usage });

            messages.push({
                "role": "user",
                "content": "Error: We could not extract code because you may not have used repl block!",

            });
            continue;
        }

        if (humanOutputEnabled && message.reasoning) {
            console.log(message.reasoning);
        }

        // Reset stdout buffer for this execution
        stdoutBuffer = "";

        try {
            await pyodide.runPythonAsync(code);
        } catch (error) {
            if (error instanceof Error) {
                stdoutBuffer += `\nError: ${error.message} `;
            } else {
                stdoutBuffer += `\nError: ${error} `;
            }
        }
        const truncatedText = truncateText(stdoutBuffer);


        const finalResult = pyodide.globals.get("__final_result__");
        if (finalResult !== undefined) {
            logger.logStep({ step: i + 1, code, reasoning: message.reasoning, usage });
            let result = finalResult;
            if (result && typeof result.toJs === "function") {
                result = result.toJs();
            }
            logger.logFinalResult(result);
            return result;
        }

        const hasError = stdoutBuffer.includes("Error");
        logger.logStep({
            step: i + 1,
            code,
            output: truncatedText,
            hasError,
            reasoning: message.reasoning,
            usage,
        });


        messages.push({
            "role": "user",
            "content": `Output: \n${truncatedText}`,
        });
    }

    throw new Error("Did not finish the function stack before subagent died");
}

interface RunSubagentCommandOptions {
    context: string;
    prefix?: string;
    outputFile?: string | null;
    jsonMode?: boolean;
}

function validatePrefix(prefix: string): void {
    if (prefix.length === 0 || prefix.length > 64) {
        throw new CliError("usage", "--prefix must be between 1 and 64 characters.");
    }
    if (!/^[A-Za-z0-9._-]+$/.test(prefix)) {
        throw new CliError("usage", "--prefix may only contain letters, numbers, dot, underscore, and dash.");
    }
    if (prefix.includes("..") || prefix.includes("/") || prefix.includes("\\")) {
        throw new CliError("usage", "--prefix must not contain path separators.");
    }
}

async function writeOutputAtomically(outputFile: string, payload: unknown): Promise<void> {
    const tmp = `${outputFile}.tmp.${crypto.randomUUID()}`;
    try {
        await Deno.writeTextFile(tmp, JSON.stringify(payload));
        await Deno.rename(tmp, outputFile);
    } catch (err) {
        try {
            await Deno.remove(tmp);
        } catch {
            // ignore cleanup errors for tmp file
        }
        throw new CliError("output", `Failed writing output file '${outputFile}': ${String(err)}`, { cause: err });
    }
}

export async function runSubagentCommand(opts: RunSubagentCommandOptions): Promise<number> {
    const jsonMode = Boolean(opts.jsonMode);
    const outputFile = opts.outputFile ?? null;

    if (opts.prefix) {
        validatePrefix(opts.prefix);
        setLogPrefix(opts.prefix);
    }

    setSubagentHumanOutputEnabled(!jsonMode);
    resetUsage();

    let out: unknown = null;
    let fatalError: string | null = null;

    try {
        out = await subagent(opts.context);

        if (!jsonMode) {
            showGlobalUsage(getTotalUsage());
            console.log("JSON_RESULT:" + JSON.stringify({ results: out }));
        }
    } catch (err) {
        fatalError = err instanceof Error ? err.message : String(err);
        if (!jsonMode) {
            console.error(chalk.red(`\nFatal error: ${fatalError}`));
        }
    } finally {
        await Logger.flush();
    }

    const logFile = getLogFile();
    const outputPayload = {
        results: out ?? null,
        log_file: logFile ?? null,
        ...(fatalError ? { error: fatalError } : {}),
    };

    if (outputFile) {
        await writeOutputAtomically(outputFile, outputPayload);
    }

    if (jsonMode) {
        printJsonEnvelope({
            ok: fatalError === null,
            results: out ?? null,
            log_file: logFile ?? null,
            error: fatalError,
            warnings: [],
        });
    } else if (logFile) {
        console.log(chalk.green(`\n📝 Log saved to: ${logFile}`));
        console.log(chalk.dim(`   View with: ./viewlog ${logFile}`));
    }

    return fatalError ? EXIT_CODES.RUNTIME : EXIT_CODES.OK;
}

if (import.meta.main) {
    const prefixIdx = Deno.args.indexOf("--prefix");
    const outputIdx = Deno.args.indexOf("--output");
    const jsonMode = Deno.args.includes("--json");

    const prefix = prefixIdx !== -1 ? Deno.args[prefixIdx + 1] : undefined;
    const outputFile = outputIdx !== -1 ? Deno.args[outputIdx + 1] : null;

    const queryContext = await new Response(Deno.stdin.readable).text();
    const code = await runSubagentCommand({
        context: queryContext,
        prefix,
        outputFile,
        jsonMode,
    });
    Deno.exit(code);
}
