import type { Usage } from "./call_llm.ts";

type EnvGetter = (name: string) => string | undefined;

export const DEFAULT_PRIMARY_MODEL = "gpt-5";
export const DEFAULT_SUB_MODEL = "gpt-5-codex-mini";

const PRIMARY_FALLBACKS = [
    "gpt-5",
    "gpt-5.1",
    "gpt-5.2",
    "gpt-5-codex",
];

const SUB_FALLBACKS = [
    "gpt-5-codex-mini",
    "gpt-5.1-codex-mini",
    "gemini-2.5-flash",
];

export interface RlmConfigLike {
    primary_agent?: string;
    sub_agent?: string;
    max_prompt_tokens?: number;
    max_completion_tokens?: number;
    max_money_spent?: number;
}

export interface ProxyClientConfig {
    apiKey: string;
    baseURL: string;
}

export interface TokenLimits {
    maxPromptTokens?: number;
    maxCompletionTokens?: number;
}

export interface RuntimeModelResolution {
    primaryAgent: string;
    subAgent: string;
    warnings: string[];
}

function getEnvValue(name: string, getEnv: EnvGetter): string | undefined {
    const value = getEnv(name)?.trim();
    return value ? value : undefined;
}

function readRequiredEnv(name: string, getEnv: EnvGetter): string {
    const value = getEnvValue(name, getEnv);
    if (!value) {
        throw new Error(
            `Missing required env var ${name}. Set it in .env and run via \`deno task ...\` ` +
                `(tasks load .env via --env-file=.env), or use ./rlm and ./rlm-smoke wrappers.`,
        );
    }
    return value;
}

function coercePositiveNumber(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return undefined;
    }
    return value;
}

export function resolveProxyClientConfig(
    getEnv: EnvGetter = (name) => Deno.env.get(name),
): ProxyClientConfig {
    const apiKey = readRequiredEnv("RLM_MODEL_API_KEY", getEnv);
    const rawBaseUrl = readRequiredEnv("RLM_MODEL_BASE_URL", getEnv).replace(/\/+$/, "");
    if (!rawBaseUrl.endsWith("/v1")) {
        throw new Error(
            `RLM_MODEL_BASE_URL must point to the OpenAI-compatible /v1 endpoint (received: ${rawBaseUrl}).`,
        );
    }
    return {
        apiKey,
        baseURL: rawBaseUrl,
    };
}

export function resolveModelNames(
    config: Pick<RlmConfigLike, "primary_agent" | "sub_agent">,
    getEnv: EnvGetter = (name) => Deno.env.get(name),
): { primaryAgent: string; subAgent: string } {
    return {
        primaryAgent: getEnvValue("RLM_PRIMARY_AGENT", getEnv) ||
            config.primary_agent ||
            DEFAULT_PRIMARY_MODEL,
        subAgent: getEnvValue("RLM_SUB_AGENT", getEnv) ||
            config.sub_agent ||
            DEFAULT_SUB_MODEL,
    };
}

export async function fetchAvailableModels(client: ProxyClientConfig): Promise<string[]> {
    const response = await fetch(`${client.baseURL}/models`, {
        headers: {
            Authorization: `Bearer ${client.apiKey}`,
        },
    });

    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(
            `Failed to fetch models from ${client.baseURL}/models: ${response.status} ${response.statusText}. ` +
                `Response: ${bodyText}`,
        );
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(bodyText);
    } catch {
        throw new Error(`Expected JSON from /models, got: ${bodyText}`);
    }

    const data = (parsed as { data?: Array<{ id?: string }> }).data;
    const modelIds = (data ?? [])
        .map((entry) => entry.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (modelIds.length === 0) {
        throw new Error("No models returned by /models; cannot select runtime model.");
    }

    return modelIds;
}

function pickModel(
    role: "primary" | "sub",
    requested: string,
    available: string[],
    getEnv: EnvGetter,
): { selected: string; warning?: string } {
    const availableSet = new Set(available);
    if (availableSet.has(requested)) {
        return { selected: requested };
    }

    const fallbackEnvName = role === "primary" ? "RLM_FALLBACK_PRIMARY" : "RLM_FALLBACK_SUB";
    const fallbackFromEnv = getEnvValue(fallbackEnvName, getEnv);
    if (fallbackFromEnv && availableSet.has(fallbackFromEnv)) {
        return {
            selected: fallbackFromEnv,
            warning:
                `Requested ${role} model '${requested}' is unavailable; using ${fallbackEnvName}='${fallbackFromEnv}'.`,
        };
    }

    const defaultCandidates = role === "primary" ? PRIMARY_FALLBACKS : SUB_FALLBACKS;
    for (const candidate of defaultCandidates) {
        if (availableSet.has(candidate)) {
            return {
                selected: candidate,
                warning:
                    `Requested ${role} model '${requested}' is unavailable; using fallback '${candidate}'.`,
            };
        }
    }

    const selected = available[0];
    return {
        selected,
        warning:
            `Requested ${role} model '${requested}' is unavailable; using first available model '${selected}'.`,
    };
}

export function resolveRuntimeModels(
    requested: { primaryAgent: string; subAgent: string },
    available: string[],
    getEnv: EnvGetter = (name) => Deno.env.get(name),
): RuntimeModelResolution {
    const warnings: string[] = [];

    const primary = pickModel("primary", requested.primaryAgent, available, getEnv);
    const sub = pickModel("sub", requested.subAgent, available, getEnv);

    if (primary.warning) warnings.push(primary.warning);
    if (sub.warning) warnings.push(sub.warning);

    return {
        primaryAgent: primary.selected,
        subAgent: sub.selected,
        warnings,
    };
}

export function resolveTokenLimits(config: RlmConfigLike): TokenLimits {
    return {
        maxPromptTokens: coercePositiveNumber(config.max_prompt_tokens),
        maxCompletionTokens: coercePositiveNumber(config.max_completion_tokens),
    };
}

export function normalizeUsage(rawUsage: unknown): Usage {
    const usage = (rawUsage ?? {}) as Record<string, unknown>;
    const usageMetadata = usage.usageMetadata as Record<string, unknown> | undefined;

    const promptTokens = coercePositiveNumber(usage.prompt_tokens) ??
        coercePositiveNumber(usageMetadata?.promptTokenCount) ??
        0;

    const completionTokens = coercePositiveNumber(usage.completion_tokens) ??
        coercePositiveNumber(usageMetadata?.candidatesTokenCount) ??
        0;

    const totalTokens = coercePositiveNumber(usage.total_tokens) ??
        coercePositiveNumber(usageMetadata?.totalTokenCount) ??
        (promptTokens + completionTokens);

    const promptTokenDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
    const completionTokenDetails = usage.completion_tokens_details as Record<string, unknown> | undefined;

    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cached_tokens: coercePositiveNumber(promptTokenDetails?.cached_tokens) ?? 0,
        reasoning_tokens: coercePositiveNumber(completionTokenDetails?.reasoning_tokens) ?? 0,
        cost: typeof usage.cost === "number" && Number.isFinite(usage.cost)
            ? usage.cost
            : 0,
    };
}
