# 03_02_email — Summary

## What this app is

A demonstration of **AI agent design patterns** for safe, multi-account email handling.
It shows how to give an LLM access to company knowledge without exposing everything at once.

## Core problem solved

> How do you let an AI agent use internal knowledge to write replies, without leaking data between accounts or giving it more context than needed?

## Two-phase architecture

```
Phase 1 — Triage (src/phases/triage.ts)
  Agent reads all emails, assigns labels, identifies which need replies.
  Produces a list of ReplyPlans — no drafts written yet.

Phase 2 — Draft Sessions (src/phases/draft.ts)
  Each ReplyPlan gets an isolated LLM session.
  KB access is locked to one account and filtered by contact type.
```

Separation matters: triage reads across all accounts; drafts operate in strict isolation.

## Knowledge base isolation — two layers

```
1. Account isolation (access-lock.ts)
   Hard mutex: while drafting for techvolt, creativespark data throws an error.
   This is enforced in code, not by asking the LLM to behave.

2. Contact type scoping (scoping.ts + contacts.ts)
   internal      → product, clients, team, vendors, communication
   trusted_vendor → vendors, communication
   client         → product, communication
   untrusted      → communication only
```

## Key insight

"Please don't use that data" (prompt-level) vs "you cannot access that data" (code-level).
This app demonstrates the latter — least-privilege enforced at the infrastructure level.

## Angular analogy

- `access-lock` = HttpInterceptor (blocks at infrastructure level)
- `scoping` = Route Guard (filters what's visible based on role)
- Role is determined not by the user, but by **who the agent is replying to**
