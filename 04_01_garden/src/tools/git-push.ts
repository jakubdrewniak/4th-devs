import { $ } from "bun";
import type { Tool } from "../types";
import { VAULT_DIR } from "../sandbox/client";

export const gitPushTool: Tool = {
  definition: {
    type: "function",
    name: "git_push",
    description:
      "Sync vault files from sandbox back to local repo, commit, and push to GitHub. " +
      "This triggers CI to build and deploy to GitHub Pages.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Git commit message" },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },

  handler: async (args, context) => {
    try {
      const { message } = args as { message: string };
      await context.sandbox.get();

      await context.sandbox.syncVaultBackNow();

      const projectRoot = VAULT_DIR.replace(/\/vault$/, "");

      await $`git -C ${projectRoot} add vault/`.quiet();

      const status = await $`git -C ${projectRoot} status --porcelain vault/`
        .text();

      if (!status.trim()) {
        return { ok: true, output: "No changes to push." };
      }

      await $`git -C ${projectRoot} commit -m ${message} -- vault/`.quiet();
      await $`git -C ${projectRoot} push`.quiet();

      return { ok: true, output: `Pushed: ${message}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, output: `Error: ${message}` };
    }
  },
};
