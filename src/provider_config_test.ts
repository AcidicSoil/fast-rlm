import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.11";
import {
    DEFAULT_PRIMARY_MODEL,
    DEFAULT_SUB_MODEL,
    normalizeUsage,
    resolveModelNames,
    resolveProxyClientConfig,
    resolveRuntimeModels,
    resolveTokenLimits,
} from "./provider_config.ts";

Deno.test("resolveProxyClientConfig requires env vars", () => {
    assertThrows(
        () => resolveProxyClientConfig(() => undefined),
        Error,
        "RLM_MODEL_API_KEY",
    );
});

Deno.test("resolveProxyClientConfig validates /v1 and trims slash", () => {
    const values: Record<string, string> = {
        RLM_MODEL_API_KEY: "test-key",
        RLM_MODEL_BASE_URL: "http://127.0.0.1:8317/v1/",
    };
    const config = resolveProxyClientConfig((name) => values[name]);
    assertEquals(config, {
        apiKey: "test-key",
        baseURL: "http://127.0.0.1:8317/v1",
    });
});

Deno.test("resolveModelNames uses env > config > defaults", () => {
    const envValues: Record<string, string> = {
        RLM_PRIMARY_AGENT: "gpt-5-codex",
        RLM_SUB_AGENT: "gemini-2.5-flash",
    };
    assertEquals(
        resolveModelNames(
            { primary_agent: "cfg-primary", sub_agent: "cfg-sub" },
            (name) => envValues[name],
        ),
        {
            primaryAgent: "gpt-5-codex",
            subAgent: "gemini-2.5-flash",
        },
    );

    assertEquals(
        resolveModelNames(
            { primary_agent: "cfg-primary", sub_agent: "cfg-sub" },
            () => undefined,
        ),
        {
            primaryAgent: "cfg-primary",
            subAgent: "cfg-sub",
        },
    );

    assertEquals(
        resolveModelNames({}, () => undefined),
        {
            primaryAgent: DEFAULT_PRIMARY_MODEL,
            subAgent: DEFAULT_SUB_MODEL,
        },
    );
});

Deno.test("resolveRuntimeModels keeps requested when available", () => {
    const resolved = resolveRuntimeModels(
        { primaryAgent: "gpt-5", subAgent: "gpt-5-codex-mini" },
        ["gpt-5", "gpt-5-codex-mini"],
    );
    assertEquals(resolved.primaryAgent, "gpt-5");
    assertEquals(resolved.subAgent, "gpt-5-codex-mini");
    assertEquals(resolved.warnings.length, 0);
});

Deno.test("resolveRuntimeModels uses fallback env when requested model missing", () => {
    const envValues: Record<string, string> = {
        RLM_FALLBACK_PRIMARY: "gpt-5",
        RLM_FALLBACK_SUB: "gpt-5-codex-mini",
    };
    const resolved = resolveRuntimeModels(
        { primaryAgent: "missing-primary", subAgent: "missing-sub" },
        ["gpt-5", "gpt-5-codex-mini"],
        (name) => envValues[name],
    );
    assertEquals(resolved.primaryAgent, "gpt-5");
    assertEquals(resolved.subAgent, "gpt-5-codex-mini");
    assertEquals(resolved.warnings.length, 2);
});

Deno.test("resolveRuntimeModels uses deterministic defaults", () => {
    const resolved = resolveRuntimeModels(
        { primaryAgent: "missing-primary", subAgent: "missing-sub" },
        ["gpt-5", "gpt-5-codex-mini"],
        () => undefined,
    );
    assertEquals(resolved.primaryAgent, "gpt-5");
    assertEquals(resolved.subAgent, "gpt-5-codex-mini");
    assertEquals(resolved.warnings.length, 2);
});

Deno.test("resolveTokenLimits accepts only positive numbers", () => {
    assertEquals(
        resolveTokenLimits({
            max_prompt_tokens: 1000,
            max_completion_tokens: 2500,
        }),
        {
            maxPromptTokens: 1000,
            maxCompletionTokens: 2500,
        },
    );
    assertEquals(
        resolveTokenLimits({
            max_prompt_tokens: -1,
            max_completion_tokens: 0,
        }),
        {
            maxPromptTokens: undefined,
            maxCompletionTokens: undefined,
        },
    );
});

Deno.test("normalizeUsage handles OpenAI usage shape", () => {
    const usage = normalizeUsage({
        prompt_tokens: 120,
        completion_tokens: 80,
        total_tokens: 200,
        prompt_tokens_details: { cached_tokens: 10 },
        completion_tokens_details: { reasoning_tokens: 20 },
        cost: 0.003,
    });
    assertEquals(usage, {
        prompt_tokens: 120,
        completion_tokens: 80,
        total_tokens: 200,
        cached_tokens: 10,
        reasoning_tokens: 20,
        cost: 0.003,
    });
});

Deno.test("normalizeUsage handles usageMetadata fallback", () => {
    const usage = normalizeUsage({
        usageMetadata: {
            promptTokenCount: 50,
            candidatesTokenCount: 25,
            totalTokenCount: 75,
        },
    });
    assertEquals(usage, {
        prompt_tokens: 50,
        completion_tokens: 25,
        total_tokens: 75,
        cached_tokens: 0,
        reasoning_tokens: 0,
        cost: 0,
    });
});
