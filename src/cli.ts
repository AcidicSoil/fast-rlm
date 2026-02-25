import {
    CliError,
    EXIT_CODES,
    exitCodeForError,
    redactSecrets,
} from "./cli_common.ts";

interface GlobalFlags {
    help: boolean;
    version: boolean;
    json: boolean;
    noColor: boolean;
    quiet: boolean;
    verbose: boolean;
}

interface ParsedCli {
    global: GlobalFlags;
    command?: string;
    args: string[];
}

const VERSION = "fast-rlm v1";

function defaultGlobalFlags(): GlobalFlags {
    return {
        help: false,
        version: false,
        json: false,
        noColor: false,
        quiet: false,
        verbose: false,
    };
}

function printHelp(): void {
    console.log(`fast-rlm CLI

Usage:
  rlm [global flags] <subcommand> [args]

Subcommands:
  run
  smoke
  logs view <log-file> [--tree|--stats|--linear]
  completion <bash|zsh|fish>
  help
  version

Global flags:
  -h, --help
  --version
  --json
  --no-color
  -q, --quiet
  -v, --verbose
  --plain (reserved)
`);
}

function parseGlobalArgs(argv: string[]): ParsedCli {
    const global = defaultGlobalFlags();
    let i = 0;

    while (i < argv.length) {
        const arg = argv[i];
        if (!arg.startsWith("-")) break;

        if (arg === "--") {
            i++;
            break;
        }

        switch (arg) {
            case "-h":
            case "--help":
                global.help = true;
                i++;
                continue;
            case "--version":
                global.version = true;
                i++;
                continue;
            case "--json":
                global.json = true;
                i++;
                continue;
            case "--no-color":
                global.noColor = true;
                i++;
                continue;
            case "-q":
            case "--quiet":
                global.quiet = true;
                i++;
                continue;
            case "-v":
            case "--verbose":
                global.verbose = true;
                i++;
                continue;
            case "--plain":
                i++;
                continue;
            default:
                throw new CliError("usage", `Unknown global flag: ${arg}`);
        }
    }

    return {
        global,
        command: argv[i],
        args: argv.slice(i + 1),
    };
}

function stdinIsTty(): boolean {
    try {
        return Deno.stdin.isTerminal();
    } catch {
        return true;
    }
}

function parseRunArgs(args: string[], inheritedJson: boolean): {
    prefix?: string;
    outputFile?: string;
    jsonMode: boolean;
} {
    let prefix: string | undefined;
    let outputFile: string | undefined;
    let jsonMode = inheritedJson;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case "--prefix": {
                const value = args[i + 1];
                if (!value || value.startsWith("-")) {
                    throw new CliError("usage", "--prefix requires a value");
                }
                prefix = value;
                i++;
                break;
            }
            case "--output": {
                const value = args[i + 1];
                if (!value || value.startsWith("-")) {
                    throw new CliError("usage", "--output requires a file path");
                }
                outputFile = value;
                i++;
                break;
            }
            case "--json":
                jsonMode = true;
                break;
            case "-h":
            case "--help":
                throw new CliError("usage", "Usage: rlm run [--prefix <string>] [--output <file>] [--json]");
            default:
                throw new CliError("usage", `Unknown run flag: ${arg}`);
        }
    }

    return { prefix, outputFile, jsonMode };
}

async function runCommand(args: string[], inheritedJson: boolean): Promise<number> {
    const parsed = parseRunArgs(args, inheritedJson);
    const context = await new Response(Deno.stdin.readable).text();
    const { runSubagentCommand } = await import("./subagents.ts");
    return await runSubagentCommand({
        context,
        prefix: parsed.prefix,
        outputFile: parsed.outputFile,
        jsonMode: parsed.jsonMode,
    });
}

async function smokeCommand(args: string[], inheritedJson: boolean): Promise<number> {
    if (args.some((arg) => arg === "-h" || arg === "--help")) {
        throw new CliError("usage", "Usage: rlm smoke [--json]");
    }

    for (const arg of args) {
        if (arg !== "--json") {
            throw new CliError("usage", `Unknown smoke flag: ${arg}`);
        }
    }

    const { runSmokeCommand } = await import("./smoke_proxy.ts");
    return await runSmokeCommand({ jsonMode: inheritedJson || args.includes("--json") });
}

async function logsCommand(args: string[]): Promise<number> {
    if (args.length === 0 || args[0] !== "view") {
        throw new CliError("usage", "Usage: rlm logs view <log-file> [--tree|--stats|--linear]");
    }

    const logFile = args[1];
    if (!logFile) {
        throw new CliError("usage", "Usage: rlm logs view <log-file> [--tree|--stats|--linear]");
    }

    const modeArg = args[2];
    if (args.length > 3) {
        throw new CliError("usage", "Usage: rlm logs view <log-file> [--tree|--stats|--linear]");
    }

    const { runLogsViewCommand } = await import("./view_logs.ts");
    return await runLogsViewCommand({
        filePath: logFile,
        mode: modeArg as "--tree" | "--stats" | "--linear" | undefined,
    });
}

function completionCommand(args: string[]): number {
    const shell = args[0];
    if (!shell || !["bash", "zsh", "fish"].includes(shell)) {
        throw new CliError("usage", "Usage: rlm completion <bash|zsh|fish>");
    }
    console.error(`completion for '${shell}' is not implemented yet`);
    return EXIT_CODES.GENERIC;
}

export async function runCli(argv: string[] = Deno.args): Promise<number> {
    const parsed = parseGlobalArgs(argv);

    if (parsed.global.noColor) {
        try {
            Deno.env.set("NO_COLOR", "1");
        } catch {
            // ignore when env mutation is not permitted
        }
    }

    if (parsed.global.version || parsed.command === "version") {
        console.log(VERSION);
        return EXIT_CODES.OK;
    }

    if (parsed.global.help || parsed.command === "help") {
        printHelp();
        return EXIT_CODES.OK;
    }

    if (!parsed.command) {
        if (stdinIsTty()) {
            printHelp();
            return EXIT_CODES.USAGE;
        }
        return await runCommand([], parsed.global.json);
    }

    switch (parsed.command) {
        case "run":
            return await runCommand(parsed.args, parsed.global.json);
        case "smoke":
            return await smokeCommand(parsed.args, parsed.global.json);
        case "logs":
            return await logsCommand(parsed.args);
        case "completion":
            return completionCommand(parsed.args);
        default:
            throw new CliError("usage", `Unknown command: ${parsed.command}`);
    }
}

if (import.meta.main) {
    try {
        const code = await runCli(Deno.args);
        Deno.exit(code);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(redactSecrets(message));
        Deno.exit(exitCodeForError(err));
    }
}
