/**
 * Entity & relationship extraction from text chunks using LLM.
 *
 * Given a chunk of text, extracts:
 *   - Entities: { name, type, description }
 *   - Relationships: { source, target, type, description }
 *
 * Post-processing normalizes names, enforces allowed types, removes
 * self-referential edges, and merges case/plural duplicates.
 */

import { chat, extractText } from "../helpers/api.js";
import log from "../helpers/logger.js";

// ── Allowed enums (anything outside gets mapped) ───────────────

const ENTITY_TYPES = new Set(["concept", "person", "technology", "organization", "technique", "other"]);

const RELATIONSHIP_TYPES = new Set([
  "relates_to", "uses", "part_of", "created_by",
  "influences", "contrasts_with", "example_of", "depends_on",
]);

// ── Canonical name normalization ───────────────────────────────

/** Normalize casing: Title Case, but preserve known acronyms */
const ACRONYMS = new Set(["LLM", "LLMs", "GPT", "API", "JSON", "XML", "YML", "CoT", "HTML", "URL", "ID"]);

const titleCase = (str) =>
  str.replace(/\b\w+/g, (word) =>
    ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );

/** Singularize simple English plurals for dedup key */
const singularize = (str) =>
  str.replace(/ies$/i, "y").replace(/(?<!s)s$/i, "");

/** Build a dedup key: lowercased + singularized */
const dedupeKey = (name) => singularize(name.trim().toLowerCase());

const EXTRACTION_INSTRUCTIONS = `You are an entity and relationship extractor. Given a text chunk, extract structured knowledge.

## OUTPUT FORMAT
Return ONLY valid JSON matching this schema — no markdown fences, no explanation:

{
  "entities": [
    { "name": "Exact Name", "type": "concept|person|technology|organization|technique|other", "description": "One-sentence description" }
  ],
  "relationships": [
    { "source": "Entity A name", "target": "Entity B name", "type": "relates_to|uses|part_of|created_by|influences|contrasts_with|example_of|depends_on", "description": "Brief description of the relationship" }
  ]
}

## RULES
- Extract concrete, meaningful entities — not vague terms like "the model" or "the example"
- Normalize entity names: use canonical/full form (e.g. "GPT-4" not "gpt4", "Chain of Thought" not "CoT")
- Use SINGULAR form for entity names (e.g. "Token" not "Tokens", "Large Language Model" not "Large Language Models")
- Each relationship MUST reference entities that appear in the entities array
- Source and target in a relationship MUST be DIFFERENT entities — no self-references
- ONLY use relationship types from the allowed list above — do not invent new ones
- Prefer specific relationship types over generic "relates_to"
- If the chunk has no meaningful entities, return {"entities":[],"relationships":[]}
- Keep descriptions concise — max 20 words each
- Extract 3-15 entities per chunk (skip trivial ones)
- Every relationship needs both source and target in the entities list`;

const EXTRACTION_MODEL = "gpt-5-mini";

// ── Post-processing ────────────────────────────────────────────

/**
 * Normalize a single extraction result:
 *   - Title-case entity names
 *   - Clamp entity types to allowed set
 *   - Clamp relationship types to allowed set
 *   - Remove self-referential edges
 *   - Remap relationship source/target to normalized names
 */
const normalizeExtraction = ({ entities, relationships }) => {
  // Normalize entities
  const nameMap = new Map(); // original name → normalized name
  const normalizedEntities = entities
    .filter((e) => e.name && e.type && e.name.length > 1)
    .map((e) => {
      const normalized = titleCase(e.name.trim());
      nameMap.set(e.name, normalized);
      return {
        name: normalized,
        type: ENTITY_TYPES.has(e.type) ? e.type : "other",
        description: e.description ?? "",
      };
    });

  const entityNames = new Set(normalizedEntities.map((e) => e.name));

  // Normalize relationships
  const normalizedRels = relationships
    .map((r) => ({
      source: nameMap.get(r.source) ?? titleCase(r.source?.trim() ?? ""),
      target: nameMap.get(r.target) ?? titleCase(r.target?.trim() ?? ""),
      type: RELATIONSHIP_TYPES.has(r.type) ? r.type : "relates_to",
      description: r.description ?? "",
    }))
    .filter((r) =>
      r.source !== r.target &&               // no self-references
      entityNames.has(r.source) &&            // valid source
      entityNames.has(r.target)               // valid target
    );

  return { entities: normalizedEntities, relationships: normalizedRels };
};

// ── Extraction ─────────────────────────────────────────────────

/**
 * Extract entities and relationships from a single text chunk.
 */
export const extractFromChunk = async (text, context = {}) => {
  const contextHint = [
    context.source && `Source file: ${context.source}`,
    context.section && `Section: ${context.section}`,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = contextHint
    ? `${contextHint}\n\n---\n\n${text}`
    : text;

  try {
    const response = await chat({
      model: EXTRACTION_MODEL,
      input: [{ role: "user", content: prompt }],
      instructions: EXTRACTION_INSTRUCTIONS,
      tools: [],
      reasoning: null,
      maxOutputTokens: 4096,
    });

    const raw = extractText(response);
    if (!raw) return { entities: [], relationships: [] };

    const cleaned = raw.replace(/^```json?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(cleaned);

    return normalizeExtraction({
      entities: parsed.entities ?? [],
      relationships: parsed.relationships ?? [],
    });
  } catch (err) {
    log.warn(`Extraction failed: ${err.message}`);
    return { entities: [], relationships: [] };
  }
};

// ── Batch extraction with global deduplication ─────────────────

/**
 * Deduplicate entities globally across all chunks.
 * Merges by lowercased+singularized key, keeps longest description,
 * and remaps all references (chunkEntities, relationships) to canonical name.
 */
const deduplicateGlobal = (allEntities, allRelationships, chunkEntities) => {
  // Build canonical map: dedupeKey → { name (longest form), type, description }
  const canonMap = new Map();

  for (const e of allEntities) {
    const key = dedupeKey(e.name);
    const existing = canonMap.get(key);

    if (!existing) {
      canonMap.set(key, { ...e });
    } else {
      // Keep longer description
      if ((e.description?.length ?? 0) > (existing.description?.length ?? 0)) {
        existing.description = e.description;
      }
      // Keep longer name form (e.g. "Large Language Model" over "LLM")
      if (e.name.length > existing.name.length) {
        existing.name = e.name;
      }
    }
  }

  // Build rename map: any original name → canonical name
  const renameMap = new Map();
  for (const e of allEntities) {
    const key = dedupeKey(e.name);
    renameMap.set(e.name, canonMap.get(key).name);
  }

  const entities = [...canonMap.values()];
  const entityNames = new Set(entities.map((e) => e.name));

  // Remap relationships
  const seenRels = new Set();
  const relationships = allRelationships
    .map((r) => ({
      ...r,
      source: renameMap.get(r.source) ?? r.source,
      target: renameMap.get(r.target) ?? r.target,
    }))
    .filter((r) => {
      if (r.source === r.target) return false;
      if (!entityNames.has(r.source) || !entityNames.has(r.target)) return false;
      // Dedupe identical edges
      const edgeKey = `${r.source}→${r.type}→${r.target}`;
      if (seenRels.has(edgeKey)) return false;
      seenRels.add(edgeKey);
      return true;
    });

  // Remap chunkEntities
  for (const [idx, names] of chunkEntities.entries()) {
    chunkEntities.set(
      idx,
      [...new Set(names.map((n) => renameMap.get(n) ?? n))].filter((n) => entityNames.has(n))
    );
  }

  return { entities, relationships, chunkEntities };
};

/**
 * Batch extraction for multiple chunks.
 * Runs sequentially to respect rate limits, then deduplicates globally.
 */
export const extractFromChunks = async (chunks) => {
  const allEntities = [];
  const allRelationships = [];
  const chunkEntities = new Map();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    process.stdout.write(`  extracting: ${i + 1}/${chunks.length}\r`);

    const { entities, relationships } = await extractFromChunk(chunk.content, {
      section: chunk.metadata.section,
      source: chunk.metadata.source,
    });

    chunkEntities.set(i, entities.map((e) => e.name));
    allEntities.push(...entities);
    allRelationships.push(...relationships);
  }

  if (chunks.length > 1) console.log();

  // Global dedup pass
  const deduped = deduplicateGlobal(allEntities, allRelationships, chunkEntities);

  log.info(
    `Extracted ${allEntities.length} raw → ${deduped.entities.length} unique entities, ` +
    `${allRelationships.length} raw → ${deduped.relationships.length} unique relationships`
  );

  return deduped;
};
