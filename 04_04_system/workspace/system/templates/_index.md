# Templates

When the user asks to add, create, or capture a note, follow this process:

1. Read the user's request and determine which template fits best.
2. Pick the matching template from this folder.
3. Fill in everything you can infer from the request and conversation context.
4. For fields you cannot infer, ask the user — but only for essential ones. Use defaults from `mind.md` for the rest.
5. Write the note to the correct folder based on the template's target section.

## Available templates

| Template       | File                | Target section       | When to use                                          |
|----------------|---------------------|----------------------|------------------------------------------------------|
| Idea           | `idea.md`           | `Craft/Ideas`        | Quick thought, spark, unformed concept               |
| Knowledge      | `knowledge.md`      | `Craft/Knowledge/*`  | Learning note, research finding, technical concept   |
| Project        | `project.md`        | `Craft/Projects`     | Long-living entity: company, product, initiative     |
| Experiment     | `experiment.md`     | `Craft/Lab`          | Code prototype, POC, tool validation                 |
| Person         | `person.md`         | `World/People`       | Relationship: family, coworker, collaborator         |
| Source         | `source.md`         | `World/Sources`      | Information channel: podcast, blog, newsletter       |
| Event          | `event.md`          | `World/Events`       | Meeting, decision, conversation, time-bound record   |
| Service        | `service.md`        | `World/Tools`        | Tool, app, platform                                  |
| Shared         | `shared.md`         | `Craft/Shared`       | Published content: article, newsletter, workshop     |

## Rules

- Always apply frontmatter defaults from `mind.md`. Only set fields explicitly when overriding.
- Write as if the reader has zero prior context — no implicit references.
- Link to existing notes when mentioning people, projects, tools, or concepts that have their own note.
- Reuse existing tags. Check sibling notes before inventing new ones.
- Set `status: seed` for new notes unless the content is clearly mature.
- Never set `attention` unless there is a concrete handoff reason.
