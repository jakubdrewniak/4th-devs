/**
 * Agent tools for graph-based RAG.
 *
 * Retrieval:
 *   - search:          hybrid chunk retrieval + entity discovery
 *   - explore:         expand one entity's neighborhood in the graph
 *   - connect:         find shortest paths between two entities
 *   - cypher:          read-only Cypher for complex structural queries
 *
 * Curation:
 *   - learn:           index content into the graph (from file or raw text)
 *   - forget:          remove content and its data from the graph
 *   - merge_entities:  merge duplicate entities into one canonical node
 *   - audit:           diagnose graph quality (orphans, duplicates, stats)
 */

import { hybridSearch, getEntitiesForChunks, getNeighbors, findPaths, safeReadCypher } from "../graph/search.js";
import { indexFile, indexText, removeDocument, auditGraph, mergeEntities } from "../graph/indexer.js";

import { readdir } from "fs/promises";
import { join } from "path";
import log from "../helpers/logger.js";

// ─────────────────────────────────────────────────────────────
// Tool definitions (sent to the LLM)
// ─────────────────────────────────────────────────────────────

const TOOLS = [
  // ── Retrieval ────────────────────────────────────────────────
  {
    type: "function",
    name: "search",
    description:
      "Search the knowledge base using hybrid retrieval (full-text BM25 + semantic vector). " +
      "Returns matching document chunks AND the graph entities mentioned in those chunks. " +
      "Use this as your first tool for any question — it gives you both text evidence and entity handles " +
      "you can pass to 'explore' or 'connect' for deeper graph traversal.",
    parameters: {
      type: "object",
      properties: {
        keywords: {
          type: "string",
          description:
            "Keywords for full-text matching — names, terms, and phrases that should appear literally in the text. " +
            "Example: 'GPT-4 autoregression token prediction'",
        },
        semantic: {
          type: "string",
          description:
            "Natural language query for semantic matching — describe the concept or question in plain English. " +
            "Example: 'How do language models generate text one token at a time?'",
        },
        limit: {
          type: "number",
          description: "Maximum chunks to return (default: 5, max: 20)",
        },
      },
      required: ["keywords", "semantic"],
    },
    strict: false,
  },
  {
    type: "function",
    name: "explore",
    description:
      "Explore the knowledge graph around a specific entity. Returns the entity's metadata and all " +
      "directly connected entities with relationship types, descriptions, and evidence sources. " +
      "Use AFTER search to follow connections: pass an entity name from search results to see what it relates to. " +
      "The entity name is case-insensitive.",
    parameters: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description:
            "Entity name to explore — use a name from search results' 'entities' array. " +
            "Example: 'Prompt Engineering'",
        },
        limit: {
          type: "number",
          description: "Maximum neighbors to return (default: 20, max: 50)",
        },
      },
      required: ["entity"],
    },
    strict: false,
  },
  {
    type: "function",
    name: "connect",
    description:
      "Find how two entities are connected through the knowledge graph. Returns the shortest path(s): " +
      "the chain of entities and relationships linking them, with evidence sources for each edge. " +
      "Use when the user asks how two concepts relate, or to discover indirect connections. " +
      "Entity names are case-insensitive.",
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Starting entity name. Example: 'GPT-4'",
        },
        to: {
          type: "string",
          description: "Target entity name. Example: 'Chain Of Thought'",
        },
        maxDepth: {
          type: "number",
          description: "Maximum relationship hops (default: 4, max: 6). Increase only if default yields no path.",
        },
      },
      required: ["from", "to"],
    },
    strict: false,
  },
  {
    type: "function",
    name: "cypher",
    description:
      "Execute a read-only Cypher query against the knowledge graph. Use ONLY when the other tools " +
      "cannot express what you need (e.g. aggregations, filtering by type, counting relationships). " +
      "Schema: " +
      "(:Document {source, hash})-[:HAS_CHUNK]->(:Chunk {content, section, source, chunkIndex})" +
      "-[:MENTIONS]->(:Entity {name, type, description}), " +
      "(:Entity)-[:RELATED_TO {type, description, evidenceSource}]->(:Entity). " +
      "Entity types: concept, person, technology, organization, technique, other. " +
      "Relationship types: relates_to, uses, part_of, created_by, influences, contrasts_with, example_of, depends_on. " +
      "ONLY read queries — no CREATE, MERGE, DELETE, SET, DROP.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Cypher query string. Use $paramName for parameters. " +
            "Example: 'MATCH (e:Entity {type: $type}) RETURN e.name, e.description LIMIT 10'",
        },
        params: {
          type: "object",
          description: "Parameters to substitute into the query. Example: {type: 'technique'}",
        },
      },
      required: ["query"],
    },
    strict: false,
  },

  // ── Curation ─────────────────────────────────────────────────
  {
    type: "function",
    name: "learn",
    description:
      "Index content into the knowledge graph. Runs the full pipeline: " +
      "chunk → embed → extract entities & relationships → write to graph. " +
      "Two modes: pass 'filename' to index a file from workspace/, or pass 'text' + 'source' to index raw text. " +
      "Use when the user asks you to learn, index, memorize, or remember something.",
    parameters: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description:
            "Filename inside workspace/ directory. Use this to index a file. " +
            "Example: 'article.md'",
        },
        text: {
          type: "string",
          description:
            "Raw text content to index directly (no file needed). " +
            "Use this when the user shares information in conversation.",
        },
        source: {
          type: "string",
          description:
            "Label for raw text content (required when using 'text', ignored when using 'filename'). " +
            "Example: 'note:meeting-2024-02-11', 'user:api-architecture'",
        },
      },
    },
    strict: false,
  },
  {
    type: "function",
    name: "forget",
    description:
      "Remove content and all its chunks, entity mentions, and orphaned entities from the graph. " +
      "Pass the source identifier: a filename (e.g. 'article.md') or a source label used during learn.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Source identifier to remove — a filename or source label. Example: 'article.md' or 'note:meeting'",
        },
      },
      required: ["source"],
    },
    strict: false,
  },
  {
    type: "function",
    name: "merge_entities",
    description:
      "Merge a duplicate entity into a canonical one. Moves all relationships and chunk mentions " +
      "from source entity to target entity, then deletes the source. " +
      "Use after 'audit' reveals duplicates. Example: merge 'LLM' into 'Large Language Model'.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Entity name to merge away (will be deleted after rewiring edges)",
        },
        target: {
          type: "string",
          description: "Canonical entity name to keep (receives all edges from source)",
        },
      },
      required: ["source", "target"],
    },
    strict: false,
  },
  {
    type: "function",
    name: "audit",
    description:
      "Diagnose knowledge graph quality. Returns: node counts by label, orphan entities (no RELATED_TO edges), " +
      "potential duplicate entities (name substring matches), relationship type distribution, " +
      "and entity type distribution. Use to assess graph health before using merge_entities.",
    parameters: {
      type: "object",
      properties: {},
    },
    strict: false,
  },
];

// ─────────────────────────────────────────────────────────────
// Tool handlers
// ─────────────────────────────────────────────────────────────

const WORKSPACE_DIR = "workspace";

/**
 * @param {import("neo4j-driver").Driver} driver
 */
export const createTools = (driver) => {
  const handlers = {
    search: async ({ keywords, semantic, limit = 5 }) => {
      const chunks = await hybridSearch(driver, { keywords, semantic }, Math.min(limit, 20));

      // Enrich: find entities mentioned in returned chunks
      const { chunkEntities, allEntities } = await getEntitiesForChunks(driver, chunks);

      return {
        chunks: chunks.map((c) => {
          const key = `${c.source}::${c.chunkIndex}`;
          return {
            source: c.source,
            section: c.section,
            content: c.content,
            entities: (chunkEntities.get(key) ?? []).map((e) => e.name),
          };
        }),
        entities: allEntities,
      };
    },

    explore: async ({ entity, limit = 20 }) => {
      const result = await getNeighbors(driver, entity, Math.min(limit, 50));
      if (!result) return { error: `Entity "${entity}" not found in graph. Check spelling or use search first.` };
      return result;
    },

    connect: async ({ from, to, maxDepth = 4 }) => {
      const paths = await findPaths(driver, from, to, Math.min(maxDepth, 6));
      if (!paths.length) return { error: `No path found between "${from}" and "${to}" within ${maxDepth} hops.` };
      return { paths };
    },

    cypher: async ({ query, params = {} }) => {
      return await safeReadCypher(driver, query, params);
    },

    learn: async ({ filename, text, source }) => {
      // Mode 1: index a file from workspace
      if (filename) {
        const files = await readdir(WORKSPACE_DIR);
        if (!files.includes(filename)) {
          return { error: `File "${filename}" not found in workspace/. Available: ${files.join(", ")}` };
        }
        const stats = await indexFile(driver, join(WORKSPACE_DIR, filename), filename);
        if (stats.skipped) return { success: true, message: `"${filename}" already indexed (unchanged)` };
        return {
          success: true,
          message: `Indexed "${filename}": ${stats.chunks} chunks, ${stats.entities} entities, ${stats.relationships} relationships`,
        };
      }

      // Mode 2: index raw text
      if (text) {
        if (!source?.trim()) return { error: "Source label is required when indexing raw text" };
        if (!text.trim()) return { error: "Text content is empty" };
        const stats = await indexText(driver, text, source);
        if (stats.skipped) return { success: true, message: `"${source}" already indexed (unchanged)` };
        return {
          success: true,
          message: `Indexed "${source}": ${stats.chunks} chunks, ${stats.entities} entities, ${stats.relationships} relationships`,
        };
      }

      return { error: "Provide either 'filename' to index a file, or 'text' + 'source' to index raw text" };
    },

    forget: async ({ source }) => {
      await removeDocument(driver, source);
      return { success: true, message: `Removed "${source}" and its data from the graph` };
    },

    merge_entities: async ({ source, target }) => {
      const result = await mergeEntities(driver, source, target);
      if (!result) return { error: `One or both entities not found: "${source}", "${target}"` };
      return { success: true, message: `Merged "${result.merged}" into "${result.into}"` };
    },

    audit: async () => {
      return await auditGraph(driver);
    },
  };

  return {
    definitions: TOOLS,

    handle: async (name, args) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown tool: ${name}`);

      log.tool(name, args);

      try {
        const result = await handler(args);
        const output = JSON.stringify(result);
        log.toolResult(name, true, output);
        return output;
      } catch (error) {
        const output = JSON.stringify({ error: error.message });
        log.toolResult(name, false, error.message);
        return output;
      }
    },
  };
};
