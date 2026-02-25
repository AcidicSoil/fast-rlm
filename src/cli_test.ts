import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.11";
import { runCli } from "./cli.ts";
import { CliError, EXIT_CODES, exitCodeForError } from "./cli_common.ts";

Deno.test("runCli handles help and version commands", async () => {
    assertEquals(await runCli(["help"]), EXIT_CODES.OK);
    assertEquals(await runCli(["--help"]), EXIT_CODES.OK);
    assertEquals(await runCli(["version"]), EXIT_CODES.OK);
    assertEquals(await runCli(["--version"]), EXIT_CODES.OK);
});

Deno.test("runCli completion returns generic exit code for known shell", async () => {
    assertEquals(await runCli(["completion", "bash"]), EXIT_CODES.GENERIC);
});

Deno.test("runCli rejects unknown command as usage error", async () => {
    await assertRejects(
        () => runCli(["not-a-command"]),
        CliError,
        "Unknown command",
    );
});

Deno.test("runCli rejects invalid logs mode as usage error", async () => {
    await assertRejects(
        () => runCli(["logs", "view", "fake.jsonl", "--invalid"]),
        CliError,
        "Unknown logs view mode",
    );
});

Deno.test("runCli rejects logs usage without file", async () => {
    await assertRejects(
        () => runCli(["logs", "view"]),
        CliError,
        "Usage: rlm logs view",
    );
});

Deno.test("exitCodeForError maps usage CliError to EXIT_CODES.USAGE", () => {
    const err = new CliError("usage", "bad args");
    assertEquals(exitCodeForError(err), EXIT_CODES.USAGE);
});
