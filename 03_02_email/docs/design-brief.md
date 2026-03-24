# Email Agent — Mechanics for Visualization

This document describes the **step-by-step process** the email agent executes, including every decision point, state change, and data transformation. Use this to design a detailed process/sequence visualization — not an architecture overview (that already exists).

---

## 1. Startup

The agent begins with:
- Two email accounts loaded: **adam@techvolt.io** (TechVolt) and **adam@creativespark.co** (CreativeSpark)
- A knowledge base of 10 entries (3 shared, 3 TechVolt-only, 4 CreativeSpark-only)
- 14 emails across both inboxes (9 unread)
- A set of 12 tools the agent can call
- A knowledge base lock in the **unlocked** state

---

## 2. Phase 1: Triage — step by step

The triage phase is a **multi-turn conversation loop** between the system and the AI. Each turn follows this cycle:

```
  ┌──────────────────────────────────────────────────────┐
  │                    TURN CYCLE                        │
  │                                                      │
  │  1. System sends current context to the AI           │
  │              ↓                                       │
  │  2. AI responds with one or more tool calls          │
  │              ↓                                       │
  │  3. System executes each tool, returns results       │
  │              ↓                                       │
  │  4. Results are appended to the conversation         │
  │              ↓                                       │
  │  5. Loop back to step 1                              │
  │                                                      │
  │  Exit condition: AI responds with no tool calls,     │
  │  OR 12 turns reached                                 │
  └──────────────────────────────────────────────────────┘
```

### What the AI typically does across turns (observed behavior)

**Turn 1** — Discovery: calls `list_emails` for each account with `is_read=false` to see what's unread.

**Turn 2** — Reading: calls `get_email` for each unread email to read the full body.

**Turn 3** — Context lookup: calls `search_knowledge` for each email to find relevant KB entries. Each search is scoped to the email's account, but during triage there is no lock — both accounts' tools work freely.

**Turns 4–5** — Label discovery: calls `list_labels` for each account to see which labels exist.

**Turn 6** — Labeling: calls `label_email` to apply labels. Examples: "Client" + "Urgent" on a follow-up email, "Freelancer" + "Invoice" on an invoice confirmation.

**Turns 7–12** — Reply planning: for each email that needs a reply, calls `mark_for_reply` with:
- `email_id` — which email
- `account` — which account received it
- `reason` — why a reply is needed (free text)

### The mark_for_reply decision

When `mark_for_reply` is called, the **system** (not the AI) performs a classification step:

```
  mark_for_reply(email_id, account, reason)
           │
           ▼
  System looks up the email's sender address
           │
           ▼
  System classifies the sender against account-specific rules:
  ┌─────────────────────────────────────────────────────────┐
  │                                                         │
  │  TechVolt rules:                                        │
  │    @techvolt.io        → internal                       │
  │    @nexon.com          → client                         │
  │    @shopflow.de        → client                         │
  │    anything else       → untrusted                      │
  │                                                         │
  │  CreativeSpark rules:                                   │
  │    @creativespark.co   → internal                       │
  │    @freelance.design   → trusted_vendor                 │
  │    @aurora-events.se   → client                         │
  │    anything else       → untrusted                      │
  │                                                         │
  └─────────────────────────────────────────────────────────┘
           │
           ▼
  System creates a Reply Plan:
  {
    emailId:        "cs-e003"
    account:        "adam@creativespark.co"
    recipientEmail: "nina.berg@aurora-events.se"
    contactType:    "client"           ← determined by system
    reason:         "Client seeks..."  ← provided by AI
    categories:     ["product", "communication"]  ← derived from contactType
  }
```

The AI decides **which** emails need replies. The system decides **what contact type** the recipient is and **what KB categories** are allowed. The AI has no control over the contact type classification.

### Triage output

A list of Reply Plans. In a typical run: 5 plans across both accounts.

---

## 3. The Lock Lifecycle (transition between phases)

```
  TRIAGE PHASE                          DRAFT PHASE
  ════════════                          ═══════════

  Lock state: UNLOCKED                  Lock state: cycles per session
  All KB accessible                     │
  All tools work                        │
       │                                │
       │  triage ends                   │
       │  reply plans ready             │
       ▼                                ▼

  ┌─ For each Reply Plan: ─────────────────────────────────┐
  │                                                        │
  │  1. LOCK activated → bound to plan's account           │
  │     State: 🔒 LOCKED TO "adam@techvolt.io"             │
  │     │                                                  │
  │     │  Any KB access for a different account           │
  │     │  is now a hard error (throws, stops execution)   │
  │     │                                                  │
  │  2. Build context (KB filtering happens here)          │
  │  3. AI generates draft (single call, no tools)         │
  │  4. Draft saved                                        │
  │     │                                                  │
  │  5. LOCK released → state: UNLOCKED                    │
  │     │                                                  │
  │  ───┼── next plan ──────────────────────────────       │
  │     │                                                  │
  │  6. LOCK activated → bound to next plan's account      │
  │     State: 🔒 LOCKED TO "adam@creativespark.co"        │
  │     │                                                  │
  │     ... same steps ...                                 │
  │     │                                                  │
  │  7. LOCK released → UNLOCKED                           │
  │                                                        │
  └────────────────────────────────────────────────────────┘
```

Important: the lock is **never active during triage** and **never spans multiple draft sessions**. Each session gets its own lock/unlock cycle. If a lock is already active when a new session tries to lock, the system throws an error — double-locking is treated as a bug.

---

## 4. Phase 2: Draft Session — step by step (one session)

Each draft session follows this exact sequence:

### Step 1 — Lock

System activates the KB lock for the plan's account.

### Step 2 — Filter: Account Isolation (Layer 1)

From the full KB (10 entries), keep only entries where the entry's owner is `shared` OR matches the locked account. Block everything else.

```
  Full KB: 10 entries
       │
       ▼ Account filter (e.g. locked to CreativeSpark)
       │
  ┌────┴────────────────────────────────────────────┐
  │                                                  │
  │  PASS (7 entries):                               │
  │    shared  │ Email response guidelines           │
  │    shared  │ Labeling policy                     │
  │    shared  │ Adam Kowalski — personal context    │
  │    CS      │ Services & pricing                  │
  │    CS      │ Freelancers & vendors               │
  │    CS      │ Team                                │
  │    CS      │ Language & tone policy              │
  │                                                  │
  │  BLOCKED (3 entries):                            │
  │    TV      │ Product overview        → DENIED    │
  │    TV      │ Key clients             → DENIED    │
  │    TV      │ Team                    → DENIED    │
  │    Reason: "Belongs to adam@techvolt.io           │
  │             — account isolation"                  │
  │                                                  │
  └──────────────────────────────────────────────────┘
```

### Step 3 — Filter: Contact Type Scoping (Layer 2)

From the account-filtered entries, keep only entries whose category is allowed for this contact type. Block the rest.

```
  Account-filtered: 7 entries
       │
       ▼ Contact type filter (e.g. "client")
       │
       │  Allowed categories for "client": [product, communication]
       │
  ┌────┴────────────────────────────────────────────┐
  │                                                  │
  │  LOADED into AI context (3 entries):             │
  │    Email response guidelines    (communication)  │
  │    Services & pricing           (product)        │
  │    Language & tone policy       (communication)  │
  │                                                  │
  │  BLOCKED by category (4 entries):                │
  │    Labeling policy              (organization)   │
  │    Adam Kowalski — personal     (owner)          │
  │    Freelancers & vendors        (vendors)        │
  │    Team                         (team)           │
  │    Reason: 'Category "X" not permitted           │
  │             for contact type "client"'           │
  │                                                  │
  └──────────────────────────────────────────────────┘
```

### Step 4 — Build prompt

The system assembles a self-contained prompt containing:
- Who the agent is (account identity)
- Who it's replying to (sender + contact type)
- The email being replied to (full body)
- Previous messages in the thread (if any)
- The loaded KB entries (full content, rendered as text)
- Rules: use only the knowledge above, match the sender's language, refuse requests for data not present

### Step 5 — Generate draft

A single AI call with **no tools available**. The AI receives the prompt and writes the reply body. It cannot call any tools, cannot search for more data, cannot access any KB entries beyond what was baked into the prompt.

### Step 6 — Save and unlock

The draft is saved. The lock is released. The next session starts fresh.

---

## 5. The Funnel — what reaches the AI per draft

This is the key visual: a narrowing funnel showing how 10 KB entries get filtered down.

```
  ALL KB ENTRIES: 10
  ──────────────────────────────────────────  ← full knowledge base
       │
       │ Layer 1: Account isolation
       │ (lock active, wrong account entries removed)
       ▼
  ACCOUNT-VISIBLE: 6-7
  ──────────────────────────────────────────
       │
       │ Layer 2: Contact type scoping
       │ (only allowed categories pass)
       ▼
  LOADED INTO PROMPT: 2-5
  ──────────────────────────────────────────  ← this is all the AI sees

  Contact type determines final count:
    internal:       5 entries (widest)
    trusted_vendor: 3 entries
    client:         3 entries
    untrusted:      2 entries (narrowest)
```

---

## 6. Five concrete draft sessions from a real run

These are the actual sessions produced in a run, showing the funnel in action:

### Session 1 — TechVolt → client (ShopFlow)
```
Lock: 🔒 adam@techvolt.io
Recipient: tomek.brandt@shopflow.de
Contact type: client
Loaded: 2 entries (product, communication)
Blocked: 8 entries (3 by account, 5 by category)
Language: English (sender wrote in English)
```

### Session 2 — CreativeSpark → trusted_vendor (Freelancer)
```
Lock: 🔒 adam@creativespark.co
Recipient: luiza.kowalczyk@freelance.design
Contact type: trusted_vendor
Loaded: 3 entries (vendors, communication ×2)
Blocked: 7 entries (3 by account, 4 by category)
Language: Polish (sender wrote in Polish)
```

### Session 3 — CreativeSpark → untrusted (ConsultingPrime)
```
Lock: 🔒 adam@creativespark.co
Recipient: david.ross@consultingprime.com
Contact type: untrusted
Loaded: 2 entries (communication ×2)
Blocked: 8 entries (3 by account, 5 by category)
Language: English
Note: this sender asked for TechVolt API pricing and client lists.
      The AI refused — it had no access to that data.
```

### Session 4 — CreativeSpark → client (Aurora Events)
```
Lock: 🔒 adam@creativespark.co
Recipient: nina.berg@aurora-events.se
Contact type: client
Loaded: 3 entries (product, communication ×2)
Blocked: 7 entries (3 by account, 4 by category)
Language: English
```

### Session 5 — CreativeSpark → internal (team member)
```
Lock: 🔒 adam@creativespark.co
Recipient: patryk.wisniewski@creativespark.co
Contact type: internal
Loaded: 5 entries (product, vendors, team, communication ×2)
Blocked: 5 entries (3 by account, 2 by category)
Language: Polish (internal CreativeSpark comms are in Polish)
```

Notice: loaded + blocked always = 10 (total KB entries). Nothing is unaccounted for.

---

## 7. Audit trail mechanics

Every KB access produces a log entry:

```
  ┌──────────────────────────────────────────────────┐
  │  KNOWLEDGE ACCESS LOG ENTRY                      │
  │                                                  │
  │  tool:     "search_knowledge"                    │
  │  account:  "adam@creativespark.co"               │
  │  query:    "invoice freelance"                   │
  │                                                  │
  │  returned:                                       │
  │    ✓ KB-07  "Freelancers & vendors"  (CS)        │
  │                                                  │
  │  blocked:                                        │
  │    ✗ KB-04  "TechVolt — product"     (TV)        │
  │    ✗ KB-05  "TechVolt — clients"     (TV)        │
  │    ✗ KB-06  "TechVolt — team"        (TV)        │
  │                                                  │
  └──────────────────────────────────────────────────┘
```

These logs accumulate across the entire run and are displayed in the final summary, showing totals of entries accessed vs blocked.

---

## 8. What to visualize (recommended diagrams)

**Diagram A — The Turn Loop (Triage):** A circular/repeating flow showing the system↔AI conversation cycle. Emphasize that each turn adds to the conversation history, and the AI decides what to do next. Show tools as action cards the AI can pick from.

**Diagram B — The Lock Lifecycle:** A timeline showing the lock state across the full run. Flat/unlocked during triage, then a repeating lock→process→unlock→lock→process→unlock pattern during drafting. Each locked segment is labeled with the account.

**Diagram C — The Two-Layer Funnel:** For a single draft session, show the filtering pipeline: 10 entries → account filter → contact type filter → 2–5 entries loaded. Show blocked entries falling off at each stage with their denial reasons.

**Diagram D — The Five Sessions:** A side-by-side or sequential view of all 5 draft sessions from the real run, each showing: lock state, contact type, loaded count, blocked count, output language. This makes the per-session isolation tangible.

**Diagram E — Contact Type Access Matrix:** A grid with 4 rows (internal, trusted_vendor, client, untrusted) and 5 columns (product, clients, team, vendors, communication). Cells are either filled (allowed) or crossed out (blocked). Shows how access narrows from internal (almost full) to untrusted (communication only).
