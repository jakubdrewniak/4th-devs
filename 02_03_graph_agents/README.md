# 02_03_graph_agents

Graph RAG agent backed by a Neo4j knowledge graph with hybrid search and entity exploration.

## Run

```bash
npm run lesson8:graph_agents
```

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set one Responses API key: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
3. Run **Neo4j 5.11+** (needed for vector index support):

```bash
docker run -d --name neo4j -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/password neo4j:5
```

4. Add Neo4j credentials to the local `.env`:

```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=password
```

## What it does

1. Indexes `.md`/`.txt` files from `workspace/` — chunks text, extracts entities and relationships via LLM, embeds everything, writes to Neo4j
2. **search** — hybrid full-text + vector retrieval with entity mentions
3. **explore** — traverse an entity's neighborhood in the graph
4. **connect** — find shortest paths between two entities
5. **cypher** — read-only Cypher queries for structural questions
6. **learn / forget** — add or remove documents at runtime
7. **audit / merge_entities** — graph quality maintenance

## Notes

Documents are indexed automatically on startup. Use `reindex` to re-scan (`--force` to wipe and rebuild), `clear` to reset conversation, and `exit` to quit.
