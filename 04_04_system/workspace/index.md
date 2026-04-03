---
title: "Knowledge Base"
description: "Root index of the personal knowledge base"
status: evergreen
publish: false
access.read: all
access.write: [human]
---

# Knowledge Base

Personal knowledge base organized into five areas. Agents read this file for orientation when creating or organizing notes.

## Structure

- **[[me/index]]** — identity, preferences. Human-authored, agents read for context.
- **[[world/index]]** — people, places, tools, sources, events. Shared between human and agents.
- **[[craft/index]]** — ideas, projects, knowledge, lab, shared content. The workspace for learning and creating.
- **[[ops/index]]** — workflows and operational output. Primary agent workspace. Active workflow: [[ops/daily-news/_info]].
- **[[system/index]]** — agent profiles, templates, rules. Human-owned, agent-readable.

## Agents

Four agents operate in this vault, defined in [[system/agents/]]:

- **Alice** — orchestrator. Manages the vault, creates notes, delegates to specialists.
- **Ellie** — research. Searches the web, writes structured findings.
- **Tony** — writer. Assembles raw research into formatted output.
- **Rose** — delivery. Verifies content and sends via email.

## Ownership

| Folder    | Owner          | Purpose                                    |
|-----------|----------------|--------------------------------------------|
| `me/`     | human          | Identity, preferences, personal process    |
| `world/`  | human + agent  | People, places, tools, sources             |
| `craft/`  | human + agent  | Knowledge, projects, experiments, sharing  |
| `ops/`    | agent          | Research, processes, operational output     |
| `system/` | human          | Agent config, templates, rules             |

## Placement rules

- Each note belongs to exactly one folder.
- Index files (`index.md`) serve as maps for their section — they link to children but contain no standalone content.
- Subfolder depth should not exceed 3 levels from workspace root.
- When unsure where a note belongs, place it in `craft/knowledge/` and tag it for review.

## Conventions

Linking rules are documented in [[system/rules/linking]].
Note templates live in [[system/templates/_index]].
