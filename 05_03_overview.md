# Lekcja 05_03 — Przegląd aplikacji

Lekcja zawiera trzy oddzielne projekty, każdy demonstruje inny wzorzec pracy z LLM.

---

## 1. `05_03_ax` — Klasyfikator emaili (Ax / DSPy)

### Co robi?
Klasyfikuje emaile z deweloperskiej skrzynki odbiorczej: nadaje etykiety (`urgent`, `spam`, `github`, `billing`…), priorytet (`low`/`medium`/`high`), flagę "wymaga odpowiedzi" i krótkie podsumowanie.

### Kluczowa idea: Signature zamiast ręcznego promptu
Zamiast pisać prompt od zera, definiujesz **signature** — deklarację wejść i wyjść. Biblioteka [Ax](https://github.com/ax-llm/ax) sama generuje z tego prompt.

```typescript
// "daj mi to → dostanę tamto"
emailFrom, emailSubject, emailBody
  → labels[], priority, needsReply, summary
```

Angular analogia: to jak `@Input()` i `@Output()` w komponencie — opisujesz kontrakt, nie implementację.

### Flow krok po kroku

```
1. Wczytaj emaile (emails.ts — 10 przykładowych emaili)
          │
          ▼
2. Załaduj few-shot examples
   - demos.json  ← jeśli plik istnieje (wygenerowany optymalizatorem)
   - examples.ts ← ręcznie dobrane przykłady (fallback)
          │
          ▼
3. Ax buduje prompt:
   [system prompt z signature]
   [few-shot pary: input → oczekiwany output]
   [nowy email do sklasyfikowania]
          │
          ▼
4. LLM zwraca ustrukturyzowany JSON
          │
          ▼
5. Wyświetl wyniki dla każdego emaila
```

### Przykład wejścia i wyjścia

**Email:**
```
From: notifications@github.com
Subject: [acme/api-gateway] PR #347: Fix race condition in connection pool
Body: @mkowalski requested your review...
```

**Wynik klasyfikacji:**
```json
{
  "labels": ["github", "needs-reply"],
  "priority": "medium",
  "needsReply": true,
  "summary": "Review requested for PR #347 fixing race condition in connection pool"
}
```

### BootstrapFewShot — automatyczna optymalizacja
`bun run optimize` uruchamia optymalizator:
1. Uruchamia klasyfikator na oznaczonych danych treningowych (`eval-data.ts`)
2. Punktuje wyniki metryką (pokrycie etykiet, priorytet, flaga odpowiedzi)
3. Zbiera udane tracer-y jako przykłady few-shot
4. Zapisuje najlepsze demo-pary do `demos.json`

> Efekt: "samo-poprawiający się prompt" — im więcej dobrych przykładów, tym lepsza klasyfikacja.

---

## 2. `05_03_coding` — Agent kodujący z MCP i pamięcią

### Co robi?
Interaktywny chat w terminalu z agentem, który może **pisać, czytać i edytować pliki** w lokalnym katalogu `workspace/`. Wbudowana komenda `/demo` każe mu zbudować grę Snake.

### Kluczowe elementy

| Element | Rola |
|---|---|
| **Agent loop** | Pętla: wyślij → dostań odpowiedź → wykonaj narzędzia → powtórz (max 30 tur) |
| **MCP (Model Context Protocol)** | Standardowy protokół, przez który agent dostaje narzędzia do plików |
| **Rolling memory** | Gdy rozmowa jest za długa → podsumuj starsze wiadomości, zachowaj najnowsze 10 |
| **OpenAI Responses API** | Nowe API OpenAI — obsługuje reasoning, narzędzia i wiadomości w jednym cyklu |

### Flow krok po kroku

```
Użytkownik pisze: "napisz grę Snake"
          │
          ▼
1. index.ts — odczyt wejścia z terminala
          │
          ▼
2. addUserMessage() → dodaj do session.messages
          │
          ▼
3. maybeCompactMemory() — sprawdź czy wiadomości > 18 lub > 18 000 znaków
   Jeśli tak: wyślij starsze do LLM → dostań podsumowanie → zastąp stare wiadomości
          │
          ▼
4. openai.responses.create() — wyślij do LLM:
   - system prompt
   - session summary (jeśli jest)
   - ostatnie wiadomości
   - lista narzędzi MCP (read_file, write_file, list_files, mkdir…)
          │
          ▼
5. LLM odpowiada tekstem LUB wywołuje narzędzie
   ├─ tekst → addAssistantMessage() → zwróć do użytkownika
   └─ function_call → runToolCall() via MCP → addToolResult() → wróć do kroku 4
          │
          ▼
6. Gdy brak function_calls → zwróć finalną odpowiedź
```

### Przykład działania

```
You: zbuduj prostą stronę HTML z licznikiem

[Turn 1]
Agent → wywołuje: list_files("workspace/")
Result: []

Agent → wywołuje: mkdir("workspace/counter")
Agent → wywołuje: write_file("workspace/counter/index.html", "<html>...")

[Turn 2] — brak function_calls
Agent: "Stworzyłem counter/index.html z przyciskami + i - ..."
```

### Architektura pamięci

```
session.messages = [ostatnie 10 wiadomości]
session.summary  = "Użytkownik chciał X. Stworzono pliki A, B. Błąd w C."

buildInstructions(SYSTEM_PROMPT, summary)
 → [system prompt]\n\nSession summary:\n[summary]
```

Gdy wiadomości przekroczą próg: model `gpt-4.1-mini` streszcza starsze → oszczędza tokeny.

---

## 3. `05_03_autoprompt` — Automatyczny optymalizator promptów

### Co robi?
Przyjmuje seed prompt + przypadki testowe z oczekiwanymi wynikami i **automatycznie go poprawia** przez iteracyjne eksperymenty. Wynik: lepszy prompt, który osiąga wyższy wynik na danych testowych.

### Kluczowa idea: hill-climbing dla promptów
Podobne do optymalizacji gradientowej, ale zamiast gradientów — LLM sugeruje zmiany, inny LLM ocenia czy są lepsze.

### Trzy modele z różnymi rolami

| Model | Rola |
|---|---|
| **execution** (`gpt-5.4-mini`) | Uruchamia prompt na przypadkach testowych, wyciąga JSON |
| **judge** (`gpt-5.4`) | Ocenia wynik: porównuje actual vs expected, daje score 0–1 |
| **improver** (`gpt-5.4`) | Analizuje błędy, proponuje zmianę promptu |

### Flow krok po kroku

```
seed prompt (prompt.initial.md)
          │
          ▼
BASELINE: uruchom prompt na przypadkach treningowych
          zmierz wynik → np. score = 0.62
          │
          ▼
ITERACJA (powtórz N razy):
          │
    ┌─────▼──────────────────────────────────────┐
    │  1. Wygeneruj K kandydatów równolegle      │
    │     każdy z inną strategią:                 │
    │     - balanced (ogólna poprawa)             │
    │     - coverage (dodaj brakujące reguły)     │
    │     - simplify (usuń nadmiarowe reguły)     │
    │     - boundary (zaostrz definicje)          │
    │     - salience (przeorganizuj kolejność)    │
    │                                             │
    │  2. Oceń każdego kandydata (execution+judge)│
    │                                             │
    │  3. Wybierz najlepszego                     │
    │     jeśli score > current_best → keep      │
    │     inaczej → discard                       │
    │                                             │
    │  4. Historia 5 ostatnich prób → feedback   │
    │     do następnej iteracji (nie powtarzaj    │
    │     strategii które nie działają)           │
    └─────────────────────────────────────────────┘
          │
          ▼
prompt.best.md — najlepszy znaleziony prompt
```

### Przykład projektu demo
Projekt `projects/demo/` ekstrahuje dane z notatek spotkań:

**Wejście** (transkrypt spotkania):
```
Meeting notes: Alice is PM, Bob assigned to fix the login bug by Friday.
Decision: use PostgreSQL for new feature.
```

**Oczekiwany output** (`expected_01.json`):
```json
{
  "tasks": [{ "task": "Fix login bug", "assignee": "Bob", "deadline": "Friday" }],
  "decisions": [{ "decision": "Use PostgreSQL", "date": "..." }],
  "people": [{ "name": "Alice", "role": "PM" }]
}
```

Optymalizator dostosowuje prompt tak, żeby ekstrakcja była jak najbliższa oczekiwanej.

### Ocenianie: exact vs semantic

```
"Fix login bug"    vs "fix the login bug"   → semantic match ✓ (to samo znaczenie)
"status": "open"   vs "status": "done"      → exact match ✗ (różne wartości)
```

---

## Zestawienie

| | `05_03_ax` | `05_03_coding` | `05_03_autoprompt` |
|---|---|---|---|
| **Paradygmat** | Signature-based (DSPy) | Agent loop | Prompt optimization |
| **LLM wywołania** | Pojedyncze, strukturalne | Wieloturowe z narzędziami | Wielopoziomowe (exec+judge+improver) |
| **Optymalizacja** | BootstrapFewShot (przykłady) | Rolling memory (tokeny) | Hill-climbing (prompt) |
| **Output** | Ustrukturyzowany JSON | Pliki w workspace | Lepszy prompt.md |
| **Kluczowe pojęcie** | Few-shot examples | Tool use + memory | LLM-as-judge |
