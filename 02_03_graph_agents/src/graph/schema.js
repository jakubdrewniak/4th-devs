/**
 * Graph schema: constraints, indexes, and label/relationship constants.
 *
 * Node labels:  Document, Chunk, Entity
 * Relationships: HAS_CHUNK, MENTIONS, RELATED_TO
 *
 * Indexes:
 *   - Full-text index on Chunk.content  (keyword / BM25-style search)
 *   - Full-text index on Entity.name    (entity name lookup)
 *   - Vector index on Chunk.embedding   (semantic search)
 *   - Vector index on Entity.embedding  (entity semantic search)
 */

import { writeQuery } from "./driver.js";
import log from "../helpers/logger.js";

const EMBEDDING_DIM = 1536; // openai/text-embedding-3-small

const SETUP_STATEMENTS = [
  // ── Uniqueness constraints ──────────────────────────────────
  `CREATE CONSTRAINT doc_source IF NOT EXISTS
   FOR (d:Document) REQUIRE d.source IS UNIQUE`,

  `CREATE CONSTRAINT entity_name_type IF NOT EXISTS
   FOR (e:Entity) REQUIRE (e.name, e.type) IS UNIQUE`,

  // ── Full-text indexes ───────────────────────────────────────
  `CREATE FULLTEXT INDEX chunk_content_ft IF NOT EXISTS
   FOR (c:Chunk) ON EACH [c.content]`,

  `CREATE FULLTEXT INDEX entity_name_ft IF NOT EXISTS
   FOR (e:Entity) ON EACH [e.name, e.aliases_text]`,

  // ── Vector indexes ──────────────────────────────────────────
  `CREATE VECTOR INDEX chunk_embedding_vec IF NOT EXISTS
   FOR (c:Chunk) ON (c.embedding)
   OPTIONS {indexConfig: {
     \`vector.dimensions\`: ${EMBEDDING_DIM},
     \`vector.similarity_function\`: 'cosine'
   }}`,

  `CREATE VECTOR INDEX entity_embedding_vec IF NOT EXISTS
   FOR (e:Entity) ON (e.embedding)
   OPTIONS {indexConfig: {
     \`vector.dimensions\`: ${EMBEDDING_DIM},
     \`vector.similarity_function\`: 'cosine'
   }}`,
];

/**
 * Ensure all constraints and indexes exist.
 * Runs each statement independently — IF NOT EXISTS makes them idempotent.
 */
export const ensureSchema = async (driver) => {
  for (const stmt of SETUP_STATEMENTS) {
    try {
      await writeQuery(driver, stmt);
    } catch (err) {
      // Some Neo4j editions don't support all index types; log and continue
      if (err.message.includes("equivalent index already exists")) continue;
      log.warn(`Schema statement skipped: ${err.message.split("\n")[0]}`);
    }
  }
  log.success("Graph schema ready");
};

export const Labels = { Document: "Document", Chunk: "Chunk", Entity: "Entity" };
export const Rels = { HAS_CHUNK: "HAS_CHUNK", MENTIONS: "MENTIONS", RELATED_TO: "RELATED_TO" };
export { EMBEDDING_DIM };
