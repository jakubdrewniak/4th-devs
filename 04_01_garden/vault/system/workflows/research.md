---
name: research
description: Research a given topic using web search and save structured notes
triggers: research, look into, dig into, find out about, what's new with, latest news about
---

Trigger: when the user asks to research, look into, or learn about a topic.

## Steps

1. Search the web for the given topic
2. Identify 3-5 key findings from the search results
3. Write a markdown note with the following structure:
   - Title: the researched topic
   - Summary: 2-3 sentence overview
   - Key findings: bulleted list of main points with source URLs
   - Sources: list of all referenced URLs
4. Save the note to `vault/research/{{date}}-<slug>.md` where `<slug>` is a short, lowercase, hyphenated version of the topic
5. Confirm what was saved and where
