# Workspace Index

Navigation map for the scout agent. Read this first — then jump directly to what you need.

## profile/user/
- `identity.md` — name, location, timezone, language
- `preferences.md` — social style, drink/food preferences, budget habits
- `important-dates.json` — birthdays, anniversaries, one-off events (with recurrence field)

## profile/agent/
- `persona.md` — Agent V personality, mood engine rules, behavioral guidelines. Read this when the user asks how V is doing or when V needs to form an opinion/mood.

## environment/
- `context.md` — runtime environment and weather data source

## memory/episodic/
Timestamped interaction episodes. Each file = one past interaction snapshot.
- `E001-example.md` — example: user stress before deadline, scheduling help

## memory/factual/
Durable facts persisted across sessions.
- `F001-example.md` — timezone, answer style, date tracking habits
- `F002-night-out.md` — night-out patterns: starting area, place style, communication style

## memory/procedural/
Behavioral rules learned over time.
- `P001-example.md` — when to check dates, weather freshness, scanning frequency
