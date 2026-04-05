# Jak działa ta aplikacja?

**Krótko**: To system wieloagentowy — kilka wyspecjalizowanych "asystentów AI" (agentów) współpracuje ze sobą, czytając i zapisując pliki markdown w folderze `workspace/`.

---

## Budulce systemu

### 1. Baza wiedzy (`workspace/`)

Folder `workspace/` to taki "mózg" systemu — pliki markdown trzymające wiedzę:

```
workspace/
  me/          ← dane o właścicielu (prywatne, tylko człowiek)
  world/       ← miejsca, źródła, narzędzia
  craft/       ← projekty, wiedza, eksperymenty
  ops/         ← procesy uruchamiane przez agentów
  system/      ← definicje agentów + szablony notatek
```

### 2. Agenci (`workspace/system/agents/`)

Każdy agent to plik markdown z fronmattem YAML + treść = system prompt:

```markdown
---
title: "Alice"
model: gpt-5.4
tools: [files, sum]
---
Jesteś Alice, asystentem bazy wiedzy...
```

Agenci to:
- **Alice** — orchestrator (zarządza, deleguje zadania)
- **Ellie** — badaczka (szuka w sieci, pisze notatki)
- **Tony** — pisarz (składa HTML z danych Ellie)
- **Rose** — dostawca (wysyła maile)

### 3. Szablony (`workspace/system/templates/`)

Gdy agent ma stworzyć notatkę o osobie, wydarzeniu, projekcie — nie wymyśla struktury. Czyta gotowy szablon:

```markdown
# Template: Person
Target: World/People
Filename: <firstname-lastname>.md

Sekcje: Who / Context / Communication / Notes
```

---

## Flow: tworzenie notatki

Przykład: "Zapisz, że Jan Kowalski to mój kolega z pracy"

```
app.js                    src/agent.js (Alice)
   |                            |
   |── "Zapisz o Janie" ───────>|
                                |── czyta workspace/index.md
                                |── czyta system/templates/person.md
                                |── czyta World/People/ (szuka duplikatów)
                                |── tworzy world/people/jan-kowalski.md
                                |
                          ODPOWIEDŹ: "Gotowe, plik utworzony"
```

---

## Flow: proces daily-news (najciekawszy!)

Co rano Alice dostaje: "Uruchom proces daily-news"

```
Alice (orchestrator)
  │
  │── czyta ops/daily-news/_info.md  ← "mapa" procesu
  │
  ├── delegate → Ellie (Phase 1: Research)
  │     │  czyta: 01-research.md
  │     │  robi: web_search("AI news 2026-04-04")
  │     └─ zapisuje: ops/daily-news/2026-04-04/ai.md, dev.md, startups.md
  │
  ├── delegate → Tony (Phase 2: Assemble)
  │     │  czyta: 02-assemble.md + pliki Ellie
  │     └─ zapisuje: ops/daily-news/2026-04-04/digest.html
  │
  └── delegate → Rose (Phase 3: Deliver)
        │  czyta: 03-deliver.md + digest.html
        └─ wysyła email z gotowym digestem
```

Każda faza to osobny plik instrukcji (`01-research.md`, `02-assemble.md`, `03-deliver.md`),
który mówi agentowi dokładnie co zrobić krok po kroku.

---

## Mechanizm delegacji (`src/tools/delegate.js`)

To "superpower" Alicji — może zlecić zadanie innemu agentowi:

```js
// Alice wywołuje:
delegate({ agent: "ellie", task: "Read 01-research.md and do phase 1" })

// System ładuje Ellie z pliku ellie.md
// Uruchamia dla niej osobną pętlę agent.js
// Ellie robi swoje zadanie i zwraca wynik do Alice
```

Rekurencja jest ograniczona do `MAX_DEPTH = 2` — agent nie może delegować w nieskończoność.

---

## Pętla agenta (`src/agent.js`)

Każdy agent działa w tej samej pętli (max 10 kroków):

```
1. Wyślij wiadomość do LLM
2. LLM chce wywołać narzędzie? → wykonaj je, wróć do kroku 1
3. LLM dał odpowiedź tekstową? → zwróć ją i zakończ
```

---

## Kluczowa obserwacja

Całe "oprogramowanie" procesu daily-news to **4 pliki tekstowe** w `ops/daily-news/`. Żadnego kodu — tylko markdown. Chcesz dodać nowy proces? Piszesz nowy folder z `_info.md` i plikami faz.

---

**Pytanie do przemyślenia**: Dlaczego Alice najpierw czyta `_info.md` zamiast od razu delegować do Ellie? Co by się stało, gdyby pominęła ten krok? (Podpowiedź: pomyśl, skąd wie, które fazy istnieją i w jakiej kolejności je wykonać.)
