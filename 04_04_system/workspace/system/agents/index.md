---
title: "Agents"
description: "Agent definitions, capabilities, and coordination rules"
status: seed
publish: false
tags: [system, agents]
access.read: [agent]
access.write: [human]
---

# Agents

<!-- Define each agent with: name, role, allowed areas, tools, and constraints. -->

## Conventions

- Agents must respect `access.write` frontmatter in every note.
- Agents must not modify `me/` notes unless the human explicitly requests it.
- Agents must follow templates from `system/templates/` when creating new notes.
- Agents must follow rules from `system/rules/` at all times.
