#!/bin/bash

BASE="http://localhost:3000"
SESSION="demo-$(date +%s)"
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
DIM='\033[2m'
RESET='\033[0m'

send() {
  local label="$1"
  local msg="$2"
  echo ""
  echo -e "${BLUE}━━━ Message ${label} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${YELLOW}→ ${msg}${RESET}"
  echo ""

  response=$(curl -s -X POST "$BASE/api/chat" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\": \"$SESSION\", \"message\": \"$msg\"}")

  reply=$(echo "$response" | jq -r '.response // "no response"' 2>/dev/null || echo "$response")
  obs=$(echo "$response" | jq -r '.memory.observationTokens // 0' 2>/dev/null)
  gen=$(echo "$response" | jq -r '.memory.generation // 0' 2>/dev/null)
  has_obs=$(echo "$response" | jq -r '.memory.hasObservations // false' 2>/dev/null)
  est=$(echo "$response" | jq -r '.usage.totalEstimatedTokens // "?"' 2>/dev/null)
  act=$(echo "$response" | jq -r '.usage.totalActualTokens // "?"' 2>/dev/null)

  echo -e "${GREEN}← ${reply}${RESET}"
  echo ""
  echo -e "${DIM}   memory: observations=${has_obs} tokens=${obs} generation=${gen}${RESET}"
  echo -e "${DIM}   usage:  estimated=${est} actual=${act}${RESET}"

  sleep 1
}

echo ""
echo "========================================"
echo "  02_05 Agent — Continuity Demo"
echo "  session: $SESSION"
echo "========================================"

# Phase 1: Building context (observer should NOT trigger yet)
send "1/9" "Hi! My name is Adam. I'm a developer from Poland."
send "2/9" "I run a company called easy_ and we build AI-powered automation tools."
send "3/9" "My favorite programming language is TypeScript but I also enjoy Rust for performance-critical stuff."

# Phase 2: More context — observer should trigger around here
send "4/9" "I'm currently working on a presentation about agentic context engineering. The deadline is next Friday."
send "5/9" "Can you write a file notes/adam-profile.md with a summary of what you know about me?"

# Phase 3: Even more context — observer definitely active, reflector may trigger
send "6/9" "I forgot to mention — I prefer dark mode in all my apps and I drink flat white coffee."
send "7/9" "What's the status of my presentation? And what coffee do I like?"

# Phase 4: State change + final memory test
send "8/9" "Actually, I changed my mind about Rust. I'm more into Go these days for backend work."
send "9/9" "Summarize everything you know about me in a few bullet points."

# Show final memory state
echo ""
echo -e "${BLUE}━━━ Final Memory State ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
curl -s "$BASE/api/sessions/$SESSION/memory" | jq . 2>/dev/null || curl -s "$BASE/api/sessions/$SESSION/memory"
echo ""
