import type { Tool } from "../types";
import { WORKDIR } from "../sandbox/client";

const DEFAULT_TIMEOUT_SECONDS = 30;
const VAULT_WORKDIR = `${WORKDIR}/vault`;

export const terminalTool: Tool = {
  definition: {
    type: "function",
    name: "terminal",
    description:
      "Execute a shell command in the Daytona sandbox and return stdout/stderr text. " +
      "Commands always run from the vault root.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute in the sandbox.",
        },
        timeout_seconds: {
          type: "integer",
          description: `Optional timeout in seconds (default: ${DEFAULT_TIMEOUT_SECONDS}).`,
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },

  handler: async (args, context) => {
    try {
      const command = typeof args.command === "string" ? args.command : "";
      if (!command.trim()) {
        throw new Error('"command" cannot be empty.');
      }

      const timeoutSeconds = typeof args.timeout_seconds === "number"
        ? args.timeout_seconds
        : DEFAULT_TIMEOUT_SECONDS;

      const sandbox = await context.sandbox.get();
      const result = await sandbox.process.executeCommand(
        command,
        VAULT_WORKDIR,
        undefined,
        timeoutSeconds,
      );

      const output = result.result?.trim() || "(no output)";
      if (result.exitCode !== 0) {
        return { ok: false, output: `[exit ${result.exitCode}]\n${output}` };
      }
      return { ok: true, output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, output: `Error: ${message}` };
    }
  },
};
