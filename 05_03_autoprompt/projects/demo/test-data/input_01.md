# Kickoff — Monday, March 16

Alright so me and Alice sat down today to plan out this self-improving agent project. The idea is simple — an AI agent that processes tasks using markdown skill files, and then gets better at those tasks based on user feedback.

We're calling it SkillAgent for now. Bob is handling all the engineering, Alice is owning the product side — skill design, prompt writing, eval criteria.

Architecture-wise we agreed on: an agent loop that reads a skill file, calls the LLM with the skill as instructions, and writes structured output. Skills are markdown files with a schema section and rules. We'll use gpt-4.1 through the OpenAI Responses API.

For the workspace, Bob will set up MCP file server integration so the agent can read and write files. Alice said she'll write the skill format specification first so Bob knows what to parse.

Tasks we identified:
- Bob: build the core agent loop with tool calling
- Bob: set up MCP file server connection
- Alice: write the skill format spec (what a skill.md looks like)
- Alice: create the first test skill for data extraction
- Bob: wire up the LLM tool so the agent can make inner LLM calls

We also need to figure out the feedback loop — how does the agent learn from corrections? But that's phase two. For now let's get the basic agent working first.

Target is to have a running MVP by end of next week. Alice wants to demo it to the team on Friday March 27.
