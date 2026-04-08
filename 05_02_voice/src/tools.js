import { llm } from "@livekit/agents";
import { z } from "zod";

const toZod = (schema) => {
  if (!schema || typeof schema !== "object") return z.any();

  switch (schema.type) {
    case "string": {
      const base = schema.enum ? z.enum(schema.enum) : z.string();
      return schema.description ? base.describe(schema.description) : base;
    }
    case "number":
    case "integer": {
      const base = schema.type === "integer" ? z.number().int() : z.number();
      return schema.description ? base.describe(schema.description) : base;
    }
    case "boolean": {
      const base = z.boolean();
      return schema.description ? base.describe(schema.description) : base;
    }
    case "array": {
      const base = z.array(toZod(schema.items ?? {}));
      return schema.description ? base.describe(schema.description) : base;
    }
    case "object": {
      const shape = {};
      const required = new Set(schema.required ?? []);
      for (const [key, val] of Object.entries(schema.properties ?? {})) {
        const field = toZod(val);
        shape[key] = required.has(key) ? field : field.optional();
      }
      return z.object(shape);
    }
    default: {
      const variants = schema.anyOf ?? schema.oneOf;
      if (variants) {
        const mapped = variants.map(toZod);
        return mapped.length === 1 ? mapped[0] : z.union(mapped);
      }
      return z.any();
    }
  }
};

export const createTools = async (mcp) => {
  if (!mcp) return {};

  const mcpTools = await mcp.listTools();
  const tools = {};

  for (const tool of mcpTools) {
    tools[tool.prefixedName] = llm.tool({
      description: tool.description ?? "",
      parameters: toZod(tool.inputSchema),
      execute: async (args) => {
        const raw = await mcp.callTool(tool.prefixedName, args);
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      },
    });
  }

  return tools;
};
