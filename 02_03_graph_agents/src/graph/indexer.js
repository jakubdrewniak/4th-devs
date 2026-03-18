/**
 * Workspace indexer for Neo4j graph.
 *
 * Pipeline per file:
 *   1. Read file, compute hash, skip if unchanged
 *   2. Chunk text
 *   3. Generate embeddings for chunks
 *   4. Extract entities & relationships via LLM
 *   5. Generate embeddings for entities
 *   6. Write everything to Neo4j in a single transaction
 */

import { readdir, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";
import { chunkBySeparators } from "./chunking.js";
import { embed } from "./embeddings.js";
import { extractFromChunks } from "./extract.js";
import { writeTransaction, writeQuery, readQuery } from "./driver.js";
import log from "../helpers/logger.js";

const BATCH_SIZE = 20;
const SUPPORTED_EXT = new Set([".md", ".txt"]);

const hashContent = (content) =>
  createHash("sha256").update(content).digest("hex");

/**
 * Remove all graph data originating from a document.
 */
export const removeDocument = async (driver, source) => {
  await writeQuery(
    driver,
    `MATCH (d:Document {source: $source})
     OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
     OPTIONAL MATCH (c)-[:MENTIONS]->(e:Entity)
     DETACH DELETE c, d
     WITH e WHERE e IS NOT NULL
     AND NOT EXISTS { (e)<-[:MENTIONS]-(:Chunk) }
     DETACH DELETE e`,
    { source }
  );
};

/**
 * Batch embed an array of texts, respecting BATCH_SIZE.
 */
const batchEmbed = async (texts, label) => {
  const embeddings = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = await embed(batch);
    embeddings.push(...batchEmbeddings);
    process.stdout.write(`  ${label} embeddings: ${embeddings.length}/${texts.length}\r`);
  }
  if (texts.length > BATCH_SIZE) console.log();
  return embeddings;
};

/**
 * Core indexing pipeline: chunk → embed → extract → write to Neo4j.
 * Shared by indexFile (from disk) and indexText (from raw text).
 *
 * @param {object} driver - Neo4j driver
 * @param {string} content - Text to index
 * @param {string} source - Label for this content (filename or custom label)
 */
const indexContent = async (driver, content, source) => {
  if (!content.trim()) {
    log.warn(`Skipping empty content: ${source}`);
    return { chunks: 0, entities: 0, relationships: 0 };
  }

  const hash = hashContent(content);

  // Check if already indexed with same hash
  const existing = await readQuery(
    driver,
    "MATCH (d:Document {source: $source}) RETURN d.hash AS hash",
    { source }
  );

  if (existing.length && existing[0].get("hash") === hash) {
    log.info(`Skipping ${source} (unchanged)`);
    return { chunks: 0, entities: 0, relationships: 0, skipped: true };
  }

  if (existing.length) {
    log.info(`Re-indexing ${source} (changed)`);
    await removeDocument(driver, source);
  }

  // 1. Chunk
  const chunks = chunkBySeparators(content, { source });
  log.info(`${source}: ${chunks.length} chunks`);

  // 2. Embed chunks
  const chunkTexts = chunks.map((c) => c.content);
  const chunkEmbeddings = await batchEmbed(chunkTexts, "chunk");

  // 3. Extract entities & relationships
  log.start("Extracting entities...");
  const { entities, relationships, chunkEntities } = await extractFromChunks(chunks);

  // 4. Embed unique entities
  const uniqueEntities = deduplicateEntities(entities);
  let entityEmbeddings = [];
  if (uniqueEntities.length) {
    const entityTexts = uniqueEntities.map(
      (e) => `${e.name}: ${e.description ?? e.type}`
    );
    entityEmbeddings = await batchEmbed(entityTexts, "entity");
  }

  // 5. Write to Neo4j
  await writeTransaction(driver, async (tx) => {
    // Document node
    await tx.run(
      `CREATE (d:Document {source: $source, hash: $hash, indexedAt: datetime()})`,
      { source, hash }
    );

    // Chunk nodes + HAS_CHUNK edges
    for (let i = 0; i < chunks.length; i++) {
      await tx.run(
        `MATCH (d:Document {source: $source})
         CREATE (d)-[:HAS_CHUNK]->(c:Chunk {
           content: $content,
           chunkIndex: $index,
           section: $section,
           chars: $chars,
           source: $source,
           embedding: $embedding
         })`,
        {
          source,
          content: chunks[i].content,
          index: chunks[i].metadata.index,
          section: chunks[i].metadata.section ?? "",
          chars: chunks[i].metadata.chars,
          embedding: chunkEmbeddings[i],
        }
      );
    }

    // Entity nodes (MERGE to deduplicate across sources)
    for (let i = 0; i < uniqueEntities.length; i++) {
      const e = uniqueEntities[i];
      await tx.run(
        `MERGE (e:Entity {name: $name, type: $type})
         ON CREATE SET e.description = $description,
                       e.aliases_text = $name,
                       e.embedding = $embedding
         ON MATCH SET  e.description = CASE WHEN size(e.description) < size($description)
                                            THEN $description ELSE e.description END`,
        {
          name: e.name,
          type: e.type,
          description: e.description ?? "",
          embedding: entityEmbeddings[i] ?? [],
        }
      );
    }

    // MENTIONS edges: Chunk → Entity
    for (const [chunkIdx, entityNames] of chunkEntities.entries()) {
      for (const eName of entityNames) {
        await tx.run(
          `MATCH (c:Chunk {source: $source, chunkIndex: $chunkIdx})
           MATCH (e:Entity {name: $eName})
           MERGE (c)-[:MENTIONS]->(e)`,
          { source, chunkIdx, eName }
        );
      }
    }

    // RELATED_TO edges between entities
    for (const rel of relationships) {
      await tx.run(
        `MATCH (a:Entity {name: $source})
         MATCH (b:Entity {name: $target})
         MERGE (a)-[r:RELATED_TO {type: $type}]->(b)
         ON CREATE SET r.description = $description, r.evidenceSource = $evidenceSource`,
        {
          source: rel.source,
          target: rel.target,
          type: rel.type,
          description: rel.description ?? "",
          evidenceSource: source,
        }
      );
    }
  });

  const stats = { chunks: chunks.length, entities: uniqueEntities.length, relationships: relationships.length };
  log.success(`Indexed ${source}: ${stats.chunks} chunks, ${stats.entities} entities, ${stats.relationships} relationships`);
  return stats;
};

/**
 * Index a file from disk into the graph.
 */
export const indexFile = async (driver, filePath, fileName) => {
  const content = await readFile(filePath, "utf-8");
  return indexContent(driver, content, fileName);
};

/**
 * Index raw text into the graph (no file required).
 * The source label identifies this content in the graph for later retrieval or removal.
 *
 * @param {object} driver - Neo4j driver
 * @param {string} text - Raw text content to index
 * @param {string} source - Label for this content (e.g. "conversation:2024-02-11", "note:meeting")
 */
export const indexText = async (driver, text, source) => {
  return indexContent(driver, text, source);
};

/**
 * Deduplicate entities by (name, type) — keep the longest description.
 */
const deduplicateEntities = (entities) => {
  const map = new Map();
  for (const e of entities) {
    const key = `${e.name}::${e.type}`;
    const existing = map.get(key);
    if (!existing || (e.description?.length ?? 0) > (existing.description?.length ?? 0)) {
      map.set(key, e);
    }
  }
  return [...map.values()];
};

/**
 * Wipe all graph data (documents, chunks, entities, relationships).
 */
export const clearGraph = async (driver) => {
  const records = await writeQuery(
    driver,
    "MATCH (n) DETACH DELETE n RETURN count(n) AS deleted"
  );
  const deleted = records[0]?.get("deleted")?.toNumber?.() ?? 0;
  log.info(`Cleared ${deleted} nodes`);
};

/**
 * Audit graph quality — returns structured report on orphans, duplicates, stats.
 */
export const auditGraph = async (driver) => {
  const [counts, orphans, duplicates, relTypes, entityTypes] = await Promise.all([
    readQuery(driver, `
      MATCH (n) WITH labels(n)[0] AS label, count(n) AS count
      RETURN label, count ORDER BY count DESC
    `),
    readQuery(driver, `
      MATCH (e:Entity) WHERE NOT (e)-[:RELATED_TO]-()
      RETURN e.name AS name, e.type AS type
    `),
    readQuery(driver, `
      MATCH (a:Entity), (b:Entity)
      WHERE id(a) < id(b) AND a.type = b.type
        AND (a.name CONTAINS b.name OR b.name CONTAINS a.name)
        AND a.name <> b.name
      RETURN a.name AS a, b.name AS b, a.type AS type
      LIMIT 20
    `),
    readQuery(driver, `
      MATCH ()-[r:RELATED_TO]->()
      RETURN r.type AS type, count(r) AS count ORDER BY count DESC
    `),
    readQuery(driver, `
      MATCH (e:Entity)
      RETURN e.type AS type, count(e) AS count ORDER BY count DESC
    `),
  ]);

  const toNum = (v) => (typeof v === "object" && v?.toNumber ? v.toNumber() : v);

  return {
    nodeCounts: counts.map((r) => ({ label: r.get("label"), count: toNum(r.get("count")) })),
    orphanEntities: orphans.map((r) => ({ name: r.get("name"), type: r.get("type") })),
    potentialDuplicates: duplicates.map((r) => ({ a: r.get("a"), b: r.get("b"), type: r.get("type") })),
    relationshipTypes: relTypes.map((r) => ({ type: r.get("type"), count: toNum(r.get("count")) })),
    entityTypes: entityTypes.map((r) => ({ type: r.get("type"), count: toNum(r.get("count")) })),
  };
};

/**
 * Merge two entities: rewire all edges from source to target, delete source.
 *
 * @param {object} driver
 * @param {string} sourceName - Entity to merge away (will be deleted)
 * @param {string} targetName - Canonical entity to keep
 */
export const mergeEntities = async (driver, sourceName, targetName) => {
  const result = await writeTransaction(driver, async (tx) => {
    // Verify both exist
    const check = await tx.run(
      `MATCH (s:Entity) WHERE toLower(s.name) = toLower($source)
       MATCH (t:Entity) WHERE toLower(t.name) = toLower($target)
       RETURN s.name AS sName, t.name AS tName`,
      { source: sourceName, target: targetName }
    );
    if (!check.records.length) return null;

    // Rewire MENTIONS: Chunk → source  becomes  Chunk → target
    await tx.run(
      `MATCH (c:Chunk)-[old:MENTIONS]->(s:Entity)
       WHERE toLower(s.name) = toLower($source)
       MATCH (t:Entity) WHERE toLower(t.name) = toLower($target)
       MERGE (c)-[:MENTIONS]->(t)
       DELETE old`,
      { source: sourceName, target: targetName }
    );

    // Rewire outgoing RELATED_TO
    await tx.run(
      `MATCH (s:Entity)-[old:RELATED_TO]->(other:Entity)
       WHERE toLower(s.name) = toLower($source)
       MATCH (t:Entity) WHERE toLower(t.name) = toLower($target)
       MERGE (t)-[r:RELATED_TO {type: old.type}]->(other)
       ON CREATE SET r.description = old.description, r.evidenceSource = old.evidenceSource
       DELETE old`,
      { source: sourceName, target: targetName }
    );

    // Rewire incoming RELATED_TO
    await tx.run(
      `MATCH (other:Entity)-[old:RELATED_TO]->(s:Entity)
       WHERE toLower(s.name) = toLower($source)
       MATCH (t:Entity) WHERE toLower(t.name) = toLower($target)
       MERGE (other)-[r:RELATED_TO {type: old.type}]->(t)
       ON CREATE SET r.description = old.description, r.evidenceSource = old.evidenceSource
       DELETE old`,
      { source: sourceName, target: targetName }
    );

    // Delete source entity
    await tx.run(
      `MATCH (s:Entity) WHERE toLower(s.name) = toLower($source) DETACH DELETE s`,
      { source: sourceName }
    );

    return { merged: check.records[0].get("sName"), into: check.records[0].get("tName") };
  });

  return result;
};

/**
 * Index all supported files in the workspace directory.
 */
export const indexWorkspace = async (driver, workspacePath) => {
  await mkdir(workspacePath, { recursive: true });

  const files = (await readdir(workspacePath)).filter((f) => {
    const ext = f.slice(f.lastIndexOf("."));
    return SUPPORTED_EXT.has(ext);
  });

  if (!files.length) {
    log.warn(`No .md/.txt files found in ${workspacePath}`);
    return;
  }

  log.info(`Found ${files.length} file(s) in ${workspacePath}`);

  for (const file of files) {
    await indexFile(driver, join(workspacePath, file), file);
  }

  // Prune documents that no longer exist on disk
  const indexed = await readQuery(driver, "MATCH (d:Document) RETURN d.source AS source");
  const onDisk = new Set(files);

  for (const record of indexed) {
    const source = record.get("source");
    if (!onDisk.has(source)) {
      log.info(`Removing stale index: ${source}`);
      await removeDocument(driver, source);
    }
  }
};
