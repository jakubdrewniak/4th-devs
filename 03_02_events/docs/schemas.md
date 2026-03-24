# File Schemas

## Task File (`workspace/project/tasks/*.md`)

```markdown
---
id: write-events-section
title: Write events and heartbeat section
project: long-horizon-report
owner: writer # planner | researcher | designer | writer | editor
status: open # open | in-progress | blocked | waiting-human | done
priority: medium # critical | high | medium | low
depends_on:
  - decide-report-tone
  - research-event-heartbeat
output_path: report/sections/02-events-and-heartbeat.md
created_by: system
attempt: 0
max_attempts: 3
next_attempt_at:
claimed_by:
claimed_at:
run_id:
blocked_reason:
blocked_by: []
wait_id:
wait_question:
human_answer:
completion_note:
created_at: 2026-02-16T00:00:00.000Z
updated_at: 2026-02-16T00:00:00.000Z
completed_at:
---
## Objective
...
```

## Event Log (`workspace/project/system/events/events.jsonl`)

Each line is one JSON event:

```json
{
  "type": "task.completed",
  "round": 3,
  "at": "2026-02-16T12:00:00.000Z",
  "message": "Section written.",
  "agent": "writer",
  "taskId": "write-events-section",
  "data": {
    "turns": 2,
    "estimated_tokens": 1800,
    "actual_tokens": 1690
  }
}
```

## Wait File (`workspace/project/system/waits/<wait-id>.md`)

```markdown
---
id: wait-ab12cd34
task_id: decide-report-tone
status: resolved # pending | resolved
updated_at: 2026-02-16T12:01:00.000Z
answered_at: 2026-02-16T12:02:00.000Z
---
## Question
Which report style should we use?

## Answer
Option A: practical implementation playbook.
```

## Evidence Card (`workspace/project/notes/evidence/R###.md`)

```markdown
---
id: R001
title: "Observational Memory in Production Agents"
url: "https://example.com/observational-memory"
publisher: "Example Labs"
published_at: "2025-11-10"
reliability: high # high | medium | low
---
## Claim
Observer/reflector loops reduce long-thread context bloat.

## Quote
> "..."

## Why it matters
Connects directly to memory compaction decisions in this project.
```
