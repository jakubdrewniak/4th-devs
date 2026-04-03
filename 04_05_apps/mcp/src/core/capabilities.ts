import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";

export const buildCapabilities = (): ServerCapabilities => ({
  logging: {},
  resources: {
    listChanged: true,
  },
  tools: {
    listChanged: true,
  },
});
