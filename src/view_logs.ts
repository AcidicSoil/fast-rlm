/**
 * Simple log viewer for Pino JSONL logs
 *
 * Usage:
 *   deno run --allow-read src/view_logs.ts logs/run_*.jsonl
 *   deno run --allow-read src/view_logs.ts logs/run_*.jsonl --tree
 *   deno run --allow-read src/view_logs.ts logs/run_*.jsonl --stats
 */

import chalk from "npm:chalk@5";
import { CliError, EXIT_CODES, exitCodeForError } from "./cli_common.ts";

interface LogEntry {
    level: number;
    time: number;
    run_id: string;
    parent_run_id?: string;
    depth: number;
    step?: number;
    event_type: string;
    msg?: string;
    [key: string]: any;
}

interface RunNode {
    run_id: string;
    parent_run_id?: string;
    depth: number;
    events: LogEntry[];
    children: RunNode[];
}

export interface LogsViewCommandOptions {
    filePath: string;
    mode?: "--tree" | "--stats" | "--linear";
}

function sanitizeForTerminal(text: string): string {
    return text.replace(/[\u001b\u009b][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~])/g, "");
}

function assertLogEntry(entry: unknown, lineNumber: number): LogEntry {
    if (!entry || typeof entry !== "object") {
        throw new Error(`Invalid log entry at line ${lineNumber}: expected object`);
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.run_id !== "string" || candidate.run_id.length === 0) {
        throw new Error(`Invalid log entry at line ${lineNumber}: missing run_id`);
    }
    if (typeof candidate.event_type !== "string" || candidate.event_type.length === 0) {
        throw new Error(`Invalid log entry at line ${lineNumber}: missing event_type`);
    }
    if (typeof candidate.time !== "number") {
        throw new Error(`Invalid log entry at line ${lineNumber}: missing numeric time`);
    }
    return candidate as LogEntry;
}

async function parseLogFile(filePath: string): Promise<LogEntry[]> {
    const content = await Deno.readTextFile(filePath);
    const lines = content.split("\n");
    const entries: LogEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            throw new Error(`Malformed JSONL at line ${i + 1}`);
        }
        entries.push(assertLogEntry(parsed, i + 1));
    }
    return entries;
}

function buildRunTree(entries: LogEntry[]): Map<string, RunNode> {
    const nodes = new Map<string, RunNode>();

    // Create nodes
    for (const entry of entries) {
        if (!nodes.has(entry.run_id)) {
            nodes.set(entry.run_id, {
                run_id: entry.run_id,
                parent_run_id: entry.parent_run_id,
                depth: entry.depth,
                events: [],
                children: [],
            });
        }
        nodes.get(entry.run_id)!.events.push(entry);
    }

    // Link children
    for (const node of nodes.values()) {
        if (node.parent_run_id) {
            const parent = nodes.get(node.parent_run_id);
            if (parent) {
                parent.children.push(node);
            }
        }
    }

    return nodes;
}

function printTree(node: RunNode, prefix = "", isLast = true) {
    const connector = isLast ? "└─ " : "├─ ";
    const runStart = node.events.find((e) => e.event_type === "run_start");
    const finalResult = node.events.find((e) => e.event_type === "final_result");

    const query = runStart?.query
        ? chalk.green(`"${runStart.query.slice(0, 60)}..."`)
        : "";

    console.log(
        prefix +
            connector +
            chalk.cyan(node.run_id) +
            ` ${chalk.yellow(`depth=${node.depth}`)} ` +
            query
    );

    // Print events summary
    const eventCounts: Record<string, number> = {};
    for (const event of node.events) {
        eventCounts[event.event_type] = (eventCounts[event.event_type] || 0) + 1;
    }

    const newPrefix = prefix + (isLast ? "    " : "│   ");
    const summary = Object.entries(eventCounts)
        .map(([type, count]) => `${type}=${count}`)
        .join(", ");
    console.log(newPrefix + chalk.dim(summary));

    // Calculate total usage from all steps
    const totalUsage = node.events.reduce((acc, event) => {
        if (event.usage) {
            return {
                total_tokens: acc.total_tokens + (event.usage.total_tokens || 0),
                cost: acc.cost + (event.usage.cost || 0),
            };
        }
        return acc;
    }, { total_tokens: 0, cost: 0 });

    if (totalUsage.total_tokens > 0) {
        console.log(
            newPrefix +
                chalk.magenta(
                    `Total: ${totalUsage.total_tokens.toLocaleString()} tokens, $${totalUsage.cost.toFixed(6)}`
                )
        );
    }

    // Print children
    node.children.forEach((child, i) => {
        printTree(child, newPrefix, i === node.children.length - 1);
    });
}

function printStats(entries: LogEntry[], nodes: Map<string, RunNode>) {
    console.log(chalk.bold("\n── Statistics ──\n"));

    const roots = Array.from(nodes.values()).filter((n) => !n.parent_run_id);

    console.log(`Total log entries: ${entries.length}`);
    console.log(`Total runs: ${nodes.size}`);
    console.log(`Root runs: ${roots.length}`);

    const maxDepth = Math.max(...Array.from(nodes.values()).map((n) => n.depth));
    console.log(`Max depth: ${maxDepth}`);

    // Total usage - sum from all events with usage data
    let totalTokens = 0;
    let totalCost = 0;

    for (const node of nodes.values()) {
        for (const event of node.events) {
            if (event.usage) {
                totalTokens += event.usage.total_tokens || 0;
                totalCost += event.usage.cost || 0;
            }
        }
    }

    console.log(chalk.magenta(`Total tokens: ${totalTokens.toLocaleString()}`));
    console.log(chalk.green(`Total cost: $${totalCost.toFixed(6)}`));
}

function printLinear(entries: LogEntry[]) {
    console.log(chalk.bold("\n── Log Entries ──\n"));

    for (const entry of entries) {
        const time = new Date(entry.time).toLocaleTimeString();
        const step = entry.step ? ` step=${entry.step}` : "";

        console.log(
            chalk.dim(`[${time}]`) +
                ` ${chalk.bold(entry.event_type)}${step}` +
                ` ${chalk.cyan(`run_id=${entry.run_id.slice(0, 16)}...`)}`
        );

        if (entry.event_type === "code_generated" && entry.code) {
            console.log(chalk.blue("  Code:"));
            console.log(
                sanitizeForTerminal(entry.code)
                    .split("\n")
                    .slice(0, 5)
                    .map((l: string) => "    " + l)
                    .join("\n")
            );
            if (entry.usage) {
                console.log(
                    chalk.cyan(
                        `  ${entry.usage.total_tokens} tokens, $${entry.usage.cost.toFixed(6)}`
                    )
                );
            }
        } else if (entry.event_type === "execution_result" && entry.output) {
            const color = entry.hasError ? chalk.red : chalk.green;
            console.log(color(`  Output: ${sanitizeForTerminal(entry.output).slice(0, 100)}`));
        } else if (entry.event_type === "final_result") {
            // Final result event - no usage displayed here, see per-step usage above
        }

        console.log();
    }
}

export async function runLogsViewCommand(options: LogsViewCommandOptions): Promise<number> {
    if (!options.filePath) {
        throw new CliError("usage", "Usage: rlm logs view <log-file.jsonl> [--tree|--stats|--linear]");
    }

    const mode = options.mode ?? "--tree";
    if (mode !== "--tree" && mode !== "--stats" && mode !== "--linear") {
        throw new CliError("usage", `Unknown logs view mode '${mode}'. Expected --tree, --stats, or --linear.`);
    }

    let entries: LogEntry[];
    try {
        entries = await parseLogFile(options.filePath);
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            throw new CliError("usage", `Log file not found: ${options.filePath}`, { cause: err });
        }
        throw new CliError("runtime", err instanceof Error ? err.message : String(err), { cause: err });
    }

    const nodes = buildRunTree(entries);

    if (mode === "--stats") {
        printStats(entries, nodes);
        return EXIT_CODES.OK;
    }

    if (mode === "--tree") {
        console.log(chalk.bold.cyan("\n── Run Tree ──\n"));
        const roots = Array.from(nodes.values()).filter((n) => !n.parent_run_id);
        roots.forEach((root, i) => {
            printTree(root, "", i === roots.length - 1);
        });
        console.log();
        printStats(entries, nodes);
        return EXIT_CODES.OK;
    }

    printLinear(entries);
    return EXIT_CODES.OK;
}

if (import.meta.main) {
    const args = Deno.args;

    try {
        const filePath = args[0];
        const modeArg = args[1];
        const code = await runLogsViewCommand({
            filePath,
            mode: modeArg as LogsViewCommandOptions["mode"] | undefined,
        });
        Deno.exit(code);
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        Deno.exit(exitCodeForError(err));
    }
}
