# Standup — Wednesday, March 18

Quick sync with Alice and Bob.

Bob says the core agent loop is working — it reads a skill file, calls the model, and returns structured JSON. Still needs error handling but the happy path works. He's moving on to MCP integration next.

Alice finished the skill format spec. It has three sections: SCHEMA (JSON schema for the output), RULES (bullet list of constraints), and EXAMPLES (input/output pairs). She's starting on the data extraction skill now.

We decided to add a CONTEXT section to skill files where you can inject dynamic data (like prior state). Alice will update the spec.

Bob mentioned he's blocked on the LLM tool — the Responses API doesn't support nested tool calls the way he expected. He'll look into workarounds tomorrow.

MVP deadline is still Friday March 27. We're on track if Bob unblocks the LLM tool issue by Friday.
