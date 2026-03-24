# Heartbeat Loop

Each round executes the same sequence:

1. Emit `heartbeat.started`.
2. Reconcile dependency blocks/unblocks.
3. Resolve waiting-human tasks (auto or interactive).
4. For each agent in the configured workflow order:
   - Claim one open task.
   - Run agent with observational memory.
   - Persist task status transition.
   - Emit task + memory events.
5. Emit `heartbeat.idle` if no tasks were claimable.
6. Mark project done when all tasks are completed.
7. Emit `heartbeat.finished`.
8. Persist round snapshot (`workspace/project/system/events/round-###.md`).

After all rounds, each agent session flushes memory so remaining tail messages are observed/reflected and stored under `workspace/project/system/memory/<agent_session>/`.
