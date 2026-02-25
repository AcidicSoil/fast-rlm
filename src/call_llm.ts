import { OpenAI } from "openai";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { normalizeUsage, resolveProxyClientConfig } from "./provider_config.ts";

export interface Usage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens: number;
    reasoning_tokens: number;
    cost: number;
}

interface CodeReturn {
    code: string;
    success: boolean;
    message: any;
    usage: Usage;
}

export async function generate_code(
    messages: any[],
    model_name: string
): Promise<CodeReturn> {
    const { apiKey, baseURL } = resolveProxyClientConfig();
    const client = new OpenAI({
        apiKey,
        baseURL,
    });
    const completion = await client.chat.completions.create({
        model: model_name,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...messages
        ],
        temperature: 0.1, // Low temperature for code generation
    });

    const content = completion.choices[0].message.content || "";

    const replMatches = [...content.matchAll(/```repl([\s\S]*?)```/g)];
    let code = replMatches.map(m => m[1].trim()).join("\n");

    const usage = normalizeUsage(completion.usage);
    if (!code) {
        return {
            code: "",
            success: false,
            message: completion.choices[0].message,
            usage: usage
        };
    }

    return {
        code: code,
        success: true,
        message: completion.choices[0].message,
        usage: usage
    };
}

if (import.meta.main) {
    // Test with a dummy context
    const query_context = "Just return fibonacci sequence";
    const out = await generate_code([
        { "role": "user", "content": query_context }
    ], "gemini-2.5-pro");
    console.log(out)

}
