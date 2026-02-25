export const EXIT_CODES = {
    OK: 0,
    GENERIC: 1,
    USAGE: 2,
    CONFIG: 3,
    PROXY: 4,
    MODEL: 5,
    RUNTIME: 6,
    OUTPUT_WRITE: 7,
    INTERRUPTED: 130,
} as const;

export type CliErrorKind =
    | "usage"
    | "config"
    | "proxy"
    | "model"
    | "runtime"
    | "output"
    | "interrupted"
    | "generic";

export class CliError extends Error {
    kind: CliErrorKind;
    override cause?: unknown;

    constructor(kind: CliErrorKind, message: string, options?: { cause?: unknown }) {
        super(message);
        this.name = "CliError";
        this.kind = kind;
        this.cause = options?.cause;
    }
}

export interface RunJsonEnvelope {
    ok: boolean;
    results: unknown | null;
    log_file: string | null;
    error: string | null;
    warnings: string[];
}

export function exitCodeForError(err: unknown): number {
    if (err instanceof CliError) {
        switch (err.kind) {
            case "usage":
                return EXIT_CODES.USAGE;
            case "config":
                return EXIT_CODES.CONFIG;
            case "proxy":
                return EXIT_CODES.PROXY;
            case "model":
                return EXIT_CODES.MODEL;
            case "runtime":
                return EXIT_CODES.RUNTIME;
            case "output":
                return EXIT_CODES.OUTPUT_WRITE;
            case "interrupted":
                return EXIT_CODES.INTERRUPTED;
            default:
                return EXIT_CODES.GENERIC;
        }
    }
    return EXIT_CODES.GENERIC;
}

export function redactSecrets(input: string): string {
    return input
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
        .replace(/(RLM_MODEL_API_KEY\s*=\s*)([^\s]+)/g, "$1[REDACTED]");
}

export function printJsonEnvelope(payload: RunJsonEnvelope): void {
    Deno.stdout.writeSync(new TextEncoder().encode(JSON.stringify(payload) + "\n"));
}

export async function withFinalizer<T>(
    run: () => Promise<T>,
    finalize: () => Promise<void>,
): Promise<T> {
    let primaryError: unknown;
    try {
        return await run();
    } catch (err) {
        primaryError = err;
        throw err;
    } finally {
        try {
            await finalize();
        } catch (finalizeError) {
            if (primaryError) {
                if (primaryError instanceof Error) {
                    (primaryError as Error).message = `${(primaryError as Error).message}\nCleanup warning: ${String(finalizeError)}`;
                }
            } else {
                throw finalizeError;
            }
        }
    }
}
