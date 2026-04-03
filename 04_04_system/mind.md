# Mind

This document maps the structure of a digital garden that doubles as the shared memory layer for the agent system. It defines spaces where the user writes and curates content, where agents autonomously research, process, and store findings, and where the system maintains live operational state. The goal is a single, coherent knowledge architecture that serves both human thinking and machine collaboration.

## Structure

- **Me** — who I am, how I operate
  - Identity — values, direction, self-knowledge
  - Preferences — tastes, communication style, aesthetics, how I like things done
  - Wellbeing — health, routines, training, meditation
  - Thinking — mental models, decision frameworks, cognitive tools
  - Process — my system for growth, direction, and deciding what matters. Agents use this to evaluate if activities are relevant.
- **World** — people, places, things I interact with
  - People — relationships, collaborators, contacts
  - Places — favorite spots, cities, routes, locations that matter
  - Tools — tools, apps, platforms I use and rely on
  - Events — meetings, decisions, conversations, time-bound occurrences. Linked to People, Places, and Projects.
  - Sources — channels, podcasts, blogs, newsletters I follow
- **Craft** — what I do, learn, and create (all one loop)
  - Ideas — raw sparks, unformed thoughts, inbox for thinking
  - Projects — Alice, eduweb, Easytools, overment and their living context
  - Knowledge — everything learned, organized by theme not medium (AI, programming, automation, design). Books, videos, articles, research all land here side by side.
  - Lab — prototypes, POCs, things tried and learned from
  - Shared — articles, newsletters, workshops (the expression side of learning)
- **Ops** — how things should be done (folders with instruction files and staging subfolders, like `Ops/Newsletter/research-and-sourcing.md`)
  - Tasks — Linear organization, prioritization rules, triage, sprint conventions
  - Calendar — scheduling conventions, availability, daily briefing template
  - Email — labeling, triage patterns, tone, response rules
  - Newsletter — format, audience, curation sources, publishing flow, edition staging
  - Research — trusted sources, depth preferences, extraction process
  - Design — brand guide, visual standards, asset conventions, generated asset storage
  - Development — code standards, review process, release flow, CI/CD conventions
  - Support — how to handle user issues, response templates, escalation rules
  - Feedback — how to collect, categorize, and act on user feedback
  - Analytics — what to track, reporting cadence, key metrics per project
  - Marketing — channels, messaging, launch playbooks, social media conventions
  - Personal — training routines, meditation, daily habits, wellness practices run with agent support
  - Music — playlist curation preferences, mood mapping
  - Navigation — route preferences, charging habits
  - Publishing — how articles/workshops go from idea to release
  - Config — infrastructure, deployment, sync setups
- **System** — the machine layer
  - Status — live state (location, device, weather, battery, vehicle)
  - Agents — per-agent workspace, decision logs, coordination

## Frontmatter

### Publishing (Astro)
- `title` — required. Page title.
- `description` — recommended for publishable notes. Short summary for meta and previews.
- `publish` — publishing lifecycle, independent from content status:
  - `draft` — not ready for the website (default)
  - `review` — content ready, needs a final look before going live
  - `live` — published on the website
  - `updated` — live but changed since last publish, needs re-deploy

### Access control
- `access.read` — who can read: `all` (default), `adam`, or list of agent names `[ellie, alice]`
- `access.write` — who can write: `adam` (default), `all`, or list of agent names `[tony]`
- When omitted, falls back to **section defaults** (see below). Only set explicitly to override.

**Section defaults** (no frontmatter needed when these apply):
- **Me/** — read: all, write: adam. Only Adam defines identity, preferences, process.
- **World/** — read: all, write: adam. Adam curates people, places, sources. Agents can suggest via attention.
- **Craft/Ideas** — read: all, write: adam. Personal inbox.
- **Craft/Projects** — read: all, write: [adam, alice]. Alice coordinates project context.
- **Craft/Knowledge** — read: all, write: [adam, ellie, tony]. Ellie and Tony produce research and technical notes.
- **Craft/Lab** — read: all, write: [adam, tony]. Tony builds prototypes.
- **Craft/Shared** — read: all, write: [adam, rose]. Rose manages published output.
- **Ops/** — read: all, write: all. Every agent can update its own playbook and staging area.
- **System/** — read: all, write: all. Agents write status and coordination data freely.

### Content status
- `status` — how mature the content is: `seed` → `growing` → `evergreen` → `archived`
  - `seed` — just planted, raw or incomplete
  - `growing` — actively being developed
  - `evergreen` — mature, stable, reliable
  - `archived` — no longer relevant but preserved
- Status and publish are independent axes — a note can be `evergreen` content but `draft` publishing.

### Attention
- `attention` — signals that someone needs to act on this note. Omit when no action is needed.
  - `who` — `adam`, or agent name(s): `ellie`, `[rose, adam]`
  - `reason` — short explanation: `"needs deeper research"`, `"ready for review"`, `"tone check before sending"`
- Agents set attention when they finish their part and need handoff. The recipient clears it when done.

### Tags
- Tags live in frontmatter as `tags: [ai, automation]`, not inline `#hashtags`.
- Tags describe **what** the note is about, not **where** it lives. The folder already handles location.
- Keep tags flat — no hierarchies like `ai/llm`. Use separate tags: `[ai, llm]`.
- Agents must reuse existing tags before creating new ones. Check sibling notes in the same folder for conventions.

### Wikilinks
- Use **vault-root absolute paths**: `[[Craft/Knowledge/AI/transformers]]` not `[[../../transformers]]`.
- Links describe **relationships between ideas**, not categorization (that's what folders and tags do).
- Every Knowledge note should link to at least one other note — no orphans.
- Agents creating notes must check for existing related notes and link to them.
- Prefer `[[path/to/note|display text]]` when the filename isn't human-readable.

### Defaults
- `publish: draft`
- `status: seed`
- `attention` — omitted (no action needed)
- `access` — inherited from section defaults above
- `tags: []`

Only `title` is required. A quick capture can be just:

```yaml
---
title: "Some thought"
---
```

### Examples

**Minimal note (Craft/Ideas) — all defaults apply:**
```yaml
---
title: "What if agents could vote on priorities?"
---
```
Inherits: publish: draft, status: seed, access: read all / write adam, no attention, no tags.

**Research note (Craft/Knowledge/AI) — agent-generated:**
```yaml
---
title: "Transformer Architecture"
description: "Core concepts of the transformer model and its role in modern AI"
status: growing
attention:
  who: adam
  reason: "initial research done, review before expanding"
tags: [ai, architecture, deep-learning]
---

Related: [[Craft/Knowledge/AI/attention-mechanism]], [[World/Sources/andrej-karpathy]]
```
Inherits: publish: draft, access: read all / write [adam, ellie, tony]. No need to set those.

**Published article (Craft/Shared) — live on website:**
```yaml
---
title: "Why Context Engineering Matters"
description: "How structured context beats raw prompting in agent systems"
publish: live
status: evergreen
tags: [ai, agents, context-engineering]
---
```
Inherits: access: read all / write [adam, rose]. No attention — it's done.

**Ops playbook (Ops/Newsletter) — all agents can read and update:**
```yaml
---
title: "Newsletter Research & Sourcing"
---
```
Inherits: publish: draft (never published to website), access: read all / write all. Ops notes rarely need more than a title.

## Agent Scenarios

**1. Ellie researches a new AI tool**
- `Ops/Research` — how deep to go, what extraction format to use
- `World/Sources` — which channels/blogs to check first
- `Craft/Knowledge/AI` — where to write findings
- `Craft/Projects` — check if any active project needs this tool
- Staging: `Ops/Research/` subfolder for in-progress work before it moves to Knowledge

**2. Rose sends a newsletter**
- `Ops/Newsletter` — format, audience, curation rules, publishing flow
- `Ops/Newsletter/editions/` — staging folder for current edition (like `research-and-sourcing.md` pattern)
- `Me/Preferences` — voice and tone to match
- `Craft/Shared` — past editions for consistency
- `World/Sources` — where curated links come from
- `Craft/Knowledge` — recent research to reference

**3. Claire triages morning email**
- `Ops/Email` — labeling rules, triage patterns, response priorities
- `World/People` — who matters, relationship context for prioritization
- `Me/Process` — filter by what's relevant to current focus
- `Craft/Projects` — match emails to active projects
- Routing: actionable items go to Linear via `Ops/Tasks` conventions

**4. Tony builds a data processing script**
- `Ops/Development` — code standards, conventions
- `Craft/Lab` — where the prototype lives
- `Craft/Projects` — project context if it's for a specific project
- `Ops/Config` — infrastructure details if deployment is involved

**5. Nicky generates a banner for a workshop**
- `Ops/Design` — brand guide, colors, typography, asset conventions
- `Ops/Design/assets/` — where generated images and banners are stored
- `Craft/Projects` — workshop context, target audience
- `Craft/Shared` — where the workshop materials live

**6. Michael plans a weekend route**
- `World/Places` — favorite spots, known destinations
- `Ops/Navigation` — route preferences, charging habits
- `System/Status` — current vehicle state, battery level
- `Me/Preferences` — driving preferences, scenic vs fast
- Planned routes saved to `World/Places` as new entries

**7. Jenny curates a focus playlist**
- `Ops/Music` — mood mapping, genre preferences, playlist rules
- `Me/Preferences` — taste, current mood patterns
- `Me/Wellbeing` — if playlist is tied to routines (workout, meditation)
- Playlist history tracked in `Ops/Music/history/`

**8. Claire creates Linear tasks from a project plan**
- `Ops/Tasks` — naming conventions, priority rules, sprint structure
- `Craft/Projects` — project scope and breakdown
- `World/People` — who to assign tasks to
- `Me/Process` — alignment check with current priorities

**9. Ellie watches a YouTube video and extracts notes**
- `World/Sources` — channel context, credibility
- `Ops/Research` — extraction format, depth
- `Craft/Knowledge` — notes land by theme (e.g., Knowledge/AI), regardless of whether source was a book, video, or article

**10. Rose handles a support email**
- `Ops/Support` — response templates, escalation rules, SLA
- `Ops/Email` — tone and formatting rules
- `World/People` — customer context if known
- `Craft/Projects` — product context for the issue
- `Ops/Feedback` — log the issue as a feedback data point

**11. Alice sends a morning briefing notification**
- `Ops/Calendar/daily-briefing.md` — template and rules for what to include
- `System/Status` — location, weather, battery, device
- `Me/Process` — what matters today
- `Ops/Tasks` — pending/overdue items
- `Craft/Projects` — active project status

**12. Ellie monitors competitor activity**
- `Ops/Analytics` — what to track, which competitors
- `World/Sources` — where to look
- `World/Tools` — competitor products (Tools covers any external entity, not just tools I use)
- `Craft/Knowledge` — where to write analysis
- `Craft/Projects` — which project this intelligence serves

**13. Tony automates a publishing workflow**
- `Ops/Publishing` — the current pipeline definition
- `Ops/Config` — infrastructure and deployment details
- `Ops/Development` — code standards for the automation
- `Craft/Shared` — what gets published and where

**14. Claire schedules a meeting**
- `Ops/Calendar` — availability rules, buffer preferences
- `World/People` — attendee context, timezone, relationship
- `Me/Preferences` — meeting length preferences, time-of-day preferences
- `Craft/Projects` — if meeting is project-related

**15. Alice captures a voice note idea**
- `Craft/Ideas` — the raw thought lands here
- `Me/Process` — check if it relates to current direction
- `Craft/Projects` — tag if it relates to a project
- Ideas are processed by Adam manually
