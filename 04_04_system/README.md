# 04_04_system

Multi-agent system where a markdown knowledge base drives agent behavior. Workflows, templates, rules, and agent identities are all vault notes — not code.

## Run

```bash
npm run lesson19:system                  # Interactive: ask Alice anything about the knowledge base
npm run lesson19:daily-news              # Workflow: run the daily-news pipeline (research → assemble → deliver)
npm run lesson19:examples                # Run all 7 example queries (idea, knowledge, person, experiment, source, shared, service)
npm run lesson19:examples -- 3           # Run only query #3 (person)
```

## Architecture

A turn-based agent loop (max 10 steps, max depth 2) with delegation. Agent profiles are loaded from `workspace/system/agents/*.md` — each declares its model, tools, and system prompt in frontmatter.

```
Alice (orchestrator)
├─ reads workflow from workspace/ops/daily-news/
├─ delegates phase 1 → Ellie (research)
├─ delegates phase 2 → Tony (assemble)
└─ delegates phase 3 → Rose (deliver)
```

## Knowledge base structure

```
workspace/
├── me/          ← human-only: identity, preferences
├── world/       ← shared: people, tools, sources
├── craft/       ← shared: knowledge, projects, lab
├── ops/         ← agent-driven: workflows, research output
└── system/      ← human-owned: agent profiles, templates, rules
```

## Daily news workflow

A three-phase pipeline defined entirely in markdown (`ops/daily-news/`):

1. **01-research.md** → Ellie searches for news per topic, writes per-topic `.md` notes
2. **02-assemble.md** → Tony merges topic notes into an HTML digest
3. **03-deliver.md** → Rose verifies the digest and sends it via email

Topics and sources are configured in `_info.md` — add a line, change the digest. No code changes needed.

## Tools

| Tool | Source | Description |
|------|--------|-------------|
| `sum` | local | Add two numbers |
| `send_email` | local | Send email (simulated — writes HTML to output folder) |
| `files__*` | MCP | Filesystem operations scoped to `workspace/` |
| `web__*` | MCP | Web search via Firecrawl |
| `delegate` | built-in | Hand off a task to another agent by name |

## Key lessons from iteration

- Prescriptive phase files (exact steps + "Do NOT" lists) beat goal-oriented ones
- Agent profiles need both identity and constraints — role alone isn't enough
- Agents must be told to trust exact paths from delegation and not explore
- Workflow mode vs note-creation mode must be separated in the orchestrator prompt
- MCP quirks (glob filters, path prefixes) require explicit workarounds in playbooks
- The knowledge base steers but doesn't guarantee — the tighter the playbook, the more predictable the behavior
