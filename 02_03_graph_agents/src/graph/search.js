/**
 * Hybrid search over Neo4j graph: full-text (BM25) + vector (cosine) + RRF fusion.
 *
 * Also provides graph traversal helpers used by agent tools.
 */

import { readQuery } from "./driver.js";
import { embed } from "./embeddings.js";
import log from "../helpers/logger.js";

const RRF_K = 60;

// ─────────────────────────────────────────────────────────────
// Full-text search (Lucene-backed, BM25-style scoring)
// ─────────────────────────────────────────────────────────────

export const searchFullText = async (driver, query, limit = 10) => {
  if (!query.trim()) return [];

  try {
    const records = await readQuery(
      driver,
      `CALL db.index.fulltext.queryNodes("chunk_content_ft", $query, {limit: $limit})
       YIELD node, score
       RETURN node.content AS content,
              node.section AS section,
              node.chunkIndex AS chunkIndex,
              node.source AS source,
              score`,
      { query, limit }
    );

    return records.map((r) => ({
      content: r.get("content"),
      section: r.get("section"),
      chunkIndex: typeof r.get("chunkIndex") === "object" ? r.get("chunkIndex").toNumber() : r.get("chunkIndex"),
      source: r.get("source"),
      ftsScore: r.get("score"),
    }));
  } catch {
    return [];
  }
};

// ─────────────────────────────────────────────────────────────
// Vector search (cosine similarity via Neo4j vector index)
// ─────────────────────────────────────────────────────────────

export const searchVector = async (driver, queryEmbedding, limit = 10) => {
  const records = await readQuery(
    driver,
    `CALL db.index.vector.queryNodes("chunk_embedding_vec", $limit, $embedding)
     YIELD node, score
     RETURN node.content AS content,
            node.section AS section,
            node.chunkIndex AS chunkIndex,
            node.source AS source,
            score`,
    { embedding: queryEmbedding, limit }
  );

  return records.map((r) => ({
    content: r.get("content"),
    section: r.get("section"),
    chunkIndex: typeof r.get("chunkIndex") === "object" ? r.get("chunkIndex").toNumber() : r.get("chunkIndex"),
    source: r.get("source"),
    vecScore: r.get("score"),
  }));
};

// ─────────────────────────────────────────────────────────────
// Hybrid search with RRF fusion
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} driver - Neo4j driver
 * @param {{ keywords: string, semantic: string }} query
 * @param {number} limit
 */
export const hybridSearch = async (driver, { keywords, semantic }, limit = 5) => {
  const ftsLimit = limit * 3;

  log.searchHeader(keywords, semantic);

  // FTS first — fast, always available
  const ftsResults = await searchFullText(driver, keywords, ftsLimit);
  log.searchFts(ftsResults.map((r) => ({ ...r, fts_score: r.ftsScore, chunk_index: r.chunkIndex })));

  // Vector search — may fail (API issues), degrade gracefully
  let vecResults = [];
  try {
    const [queryEmbedding] = await embed(semantic);
    vecResults = await searchVector(driver, queryEmbedding, ftsLimit);
  } catch (err) {
    log.warn(`Semantic search unavailable: ${err.message}`);
  }
  log.searchVec(vecResults.map((r) => ({ ...r, vec_distance: 1 - (r.vecScore ?? 0), chunk_index: r.chunkIndex })));

  // Build RRF scores — key by source+chunkIndex since we don't have row IDs
  const scores = new Map();

  const makeKey = (r) => `${r.source}::${r.chunkIndex}`;

  const upsert = (key, data) => {
    if (!scores.has(key)) scores.set(key, { ...data, rrf: 0 });
    return scores.get(key);
  };

  ftsResults.forEach((r, rank) => {
    const entry = upsert(makeKey(r), r);
    entry.rrf += 1 / (RRF_K + rank + 1);
    entry.fts_rank = rank + 1;
  });

  vecResults.forEach((r, rank) => {
    const entry = upsert(makeKey(r), r);
    entry.rrf += 1 / (RRF_K + rank + 1);
    entry.vec_rank = rank + 1;
  });

  const merged = [...scores.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, limit);

  log.searchRrf(merged.map((r) => ({
    ...r,
    source: r.source,
    section: r.section,
    chunk_index: r.chunkIndex,
  })));

  return merged.map(({ rrf, ftsScore, vecScore, fts_rank, vec_rank, ...rest }) => rest);
};

// ─────────────────────────────────────────────────────────────
// Entity enrichment for search results
// ─────────────────────────────────────────────────────────────

/**
 * Given a list of chunk identifiers (source + chunkIndex),
 * return the entities mentioned in those chunks.
 */
export const getEntitiesForChunks = async (driver, chunks) => {
  if (!chunks.length) return { chunkEntities: new Map(), allEntities: [] };

  const records = await readQuery(
    driver,
    `UNWIND $chunks AS c
     MATCH (ch:Chunk {source: c.source, chunkIndex: c.chunkIndex})-[:MENTIONS]->(e:Entity)
     RETURN c.source AS source, c.chunkIndex AS chunkIndex,
            collect(DISTINCT {name: e.name, type: e.type}) AS entities`,
    { chunks: chunks.map((c) => ({ source: c.source, chunkIndex: c.chunkIndex })) }
  );

  const chunkEntities = new Map();
  const allEntityMap = new Map();

  for (const r of records) {
    const key = `${r.get("source")}::${typeof r.get("chunkIndex") === "object" ? r.get("chunkIndex").toNumber() : r.get("chunkIndex")}`;
    const entities = r.get("entities");
    chunkEntities.set(key, entities);
    for (const e of entities) {
      allEntityMap.set(e.name, e);
    }
  }

  return { chunkEntities, allEntities: [...allEntityMap.values()] };
};

// ─────────────────────────────────────────────────────────────
// Graph traversal helpers (used by agent tools)
// ─────────────────────────────────────────────────────────────

/**
 * Get an entity and its direct neighbors (entities connected via RELATED_TO).
 * Includes the evidence source (document) for each relationship.
 */
export const getNeighbors = async (driver, entityName, limit = 20) => {
  const records = await readQuery(
    driver,
    `MATCH (e:Entity)
     WHERE toLower(e.name) = toLower($name)
     OPTIONAL MATCH (e)-[r:RELATED_TO]-(other:Entity)
     RETURN e.name AS name, e.type AS type, e.description AS description,
            collect(DISTINCT {
              entity: other.name,
              entityType: other.type,
              relType: r.type,
              relDescription: r.description,
              evidenceSource: r.evidenceSource,
              direction: CASE WHEN startNode(r) = e THEN 'outgoing' ELSE 'incoming' END
            })[0..$limit] AS neighbors`,
    { name: entityName, limit }
  );

  if (!records.length) return null;

  const r = records[0];
  return {
    name: r.get("name"),
    type: r.get("type"),
    description: r.get("description"),
    neighbors: r.get("neighbors").filter((n) => n.entity !== null),
  };
};

/**
 * Find shortest path(s) between two entities.
 * Returns nodes with types and edges with types, descriptions, and evidence.
 */
export const findPaths = async (driver, fromEntity, toEntity, maxDepth = 4) => {
  const records = await readQuery(
    driver,
    `MATCH (a:Entity), (b:Entity)
     WHERE toLower(a.name) = toLower($from) AND toLower(b.name) = toLower($to)
     MATCH path = shortestPath((a)-[:RELATED_TO*1..${maxDepth}]-(b))
     RETURN [n IN nodes(path) | {name: n.name, type: n.type}] AS nodes,
            [r IN relationships(path) | {type: r.type, description: r.description, evidenceSource: r.evidenceSource}] AS edges
     LIMIT 3`,
    { from: fromEntity, to: toEntity }
  );

  return records.map((r) => ({
    nodes: r.get("nodes"),
    edges: r.get("edges"),
  }));
};

/**
 * Execute a read-only Cypher query with safety limits.
 */
export const safeReadCypher = async (driver, cypher, params = {}, limit = 25) => {
  // Basic safety: reject writes
  const upper = cypher.toUpperCase();
  const writeKeywords = ["CREATE", "MERGE", "DELETE", "SET ", "REMOVE", "DROP", "CALL {"];
  const hasWrite = writeKeywords.some((kw) => upper.includes(kw));
  if (hasWrite) throw new Error("Write operations are not allowed in read-only Cypher tool");

  // Append LIMIT if not present
  const needsLimit = !upper.includes("LIMIT");
  const safeCypher = needsLimit ? `${cypher}\nLIMIT ${limit}` : cypher;

  const records = await readQuery(driver, safeCypher, params);

  return records.map((r) => {
    const obj = {};
    for (const key of r.keys) {
      const val = r.get(key);
      obj[key] = typeof val === "object" && val?.toNumber ? val.toNumber() : val;
    }
    return obj;
  });
};
