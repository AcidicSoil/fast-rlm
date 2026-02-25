import chalk from "npm:chalk@5";
import {
    fetchAvailableModels,
    resolveModelNames,
    resolveProxyClientConfig,
    resolveRuntimeModels,
} from "./provider_config.ts";

interface ChatCompletionsResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
}

interface SmokeCommandOptions {
    jsonMode?: boolean;
}

async function fetchJson(url: string, apiKey: string, body?: unknown): Promise<unknown> {
    const response = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Expected JSON response from ${url}, got: ${text}`);
    }
}

export async function runSmokeCommand(options: SmokeCommandOptions = {}): Promise<number> {
    const jsonMode = Boolean(options.jsonMode);
    const proxy = resolveProxyClientConfig();
    const requested = resolveModelNames({});

    if (!jsonMode) {
        console.log(chalk.cyan(`Checking proxy: ${proxy.baseURL}`));
    }

    const modelIds = await fetchAvailableModels(proxy);
    const runtime = resolveRuntimeModels(requested, modelIds);

    const chatJson = await fetchJson(
        `${proxy.baseURL}/chat/completions`,
        proxy.apiKey,
        {
            model: runtime.primaryAgent,
            messages: [{ role: "user", content: "Reply with the single word: ok" }],
            temperature: 0,
        },
    ) as ChatCompletionsResponse;

    const content = chatJson.choices?.[0]?.message?.content?.trim();
    if (!content) {
        throw new Error("Chat completion returned empty content");
    }

    if (jsonMode) {
        Deno.stdout.writeSync(new TextEncoder().encode(JSON.stringify({
            ok: true,
            model_count: modelIds.length,
            model: runtime.primaryAgent,
            response: content,
            warnings: runtime.warnings,
        }) + "\n"));
    } else {
        console.log(chalk.green(`✓ /models returned ${modelIds.length} model(s)`));
        for (const warning of runtime.warnings) {
            console.log(chalk.yellow(`Model preflight warning: ${warning}`));
        }
        console.log(chalk.green(`✓ /chat/completions succeeded with model ${runtime.primaryAgent}`));
        console.log(chalk.bold(`Response: ${content}`));
    }

    return 0;
}

if (import.meta.main) {
    const code = await runSmokeCommand({ jsonMode: Deno.args.includes("--json") });
    Deno.exit(code);
}
