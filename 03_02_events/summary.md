# 03_02_events — Podsumowanie

## Co to jest?

Autonomiczny system multi-agentowy. Zespół AI-agentów współpracuje nad złożonym zadaniem (np. napisaniem raportu). Jedyne co musisz zrobić ręcznie to napisać `goal.md` — resztą zajmuje się system.

---

## goal.md — kontrakt

Plik `workspace/goal.md` to zlecenie dla systemu:

```yaml
---
objective: "Napisz porównanie Claude Opus 4.6 vs GPT-5.3-Codex"
must_have:
  - Raport w Markdown pod report/final-report.md
  - Wersja HTML pod deliverables/report.html
forbidden:
  - Hype language, marketingowe sformułowania
step_budget_rounds: 7   # max rund
max_total_tasks: 6      # max zadań
---
```

LLM czyta `goal.md` i generuje plan — listę tasków potrzebnych do realizacji celu. Plan jest walidowany (`must_have` vs `forbidden`), a jeśli nie przejdzie — naprawiany (max 2 próby).

---

## Agenci

Każdy agent to plik `.md` w `workspace/agents/`:

```yaml
---
name: researcher
model: gpt-5.2
tools: [web__scrape, web__search, files__fs_write, request_human]
capabilities: [research, web-scrape]
---
System prompt: "Jesteś lead researcher..."
```

W tym projekcie: `researcher`, `planner`, `writer`, `editor`, `designer`.

---

## Taski — pliki na dysku

Każdy task to plik `.md` w `workspace/tasks/`:

```yaml
---
id: t1-evidence-collection
owner: researcher
status: done           # open | in-progress | blocked | waiting-human | done
depends_on: []
output_path: research/evidence.json
---
Treść = instrukcja dla agenta (prompt)
```

`status` w frontmatterze to jedyne źródło prawdy. Nie ma kolejki ani event busa — synchronizacja odbywa się przez pliki na dysku.

---

## Pętla heartbeat — jedna runda

```
KAŻDA RUNDA:
  1. reconcileDependencyStates()
     → czyta WSZYSTKIE taski z dysku
     → jeśli depends_on = [t1] i t1.status = "done" → odblokuj task

  2. dla każdego agenta:
     → claimNextTask() — weź 1 task (status=open, brak pending deps)
     → runAgent()      — LLM wykonuje task (max 16 turns)
     → markTaskCompleted/Blocked/WaitingHuman — zapisz wynik do pliku

  3. emit heartbeat.finished
  4. flushRound() → zapisz zdarzenia do round-NNN.md
  5. sleep(delayMs)
```

**1 runda = każdy agent dostaje maksymalnie 1 task.**

---

## Zależności między taskami

```
t1 (researcher) ──────────────────────────────► done
                  t2 (planner)   depends_on: [t1] ► done
                                  t3 (writer)  depends_on: [t1,t2] ► done
                                                t4 (editor)  depends_on: [t3] ► done
                                                              t5 (designer) depends_on: [t4] ► done
```

Gdyby taski były niezależne → wszyscy agenci pracują w tej samej rundzie.
Z zależnościami → każdy task czeka na poprzedni → potrzeba wielu rund.

---

## Zdarzenia (HeartbeatEvent)

Każda akcja emituje zdarzenie zapisywane do `events.jsonl` i `round-NNN.md`:

| Typ zdarzenia | Kiedy |
|---|---|
| `heartbeat.started/finished` | początek/koniec rundy |
| `task.claimed` | agent wziął task |
| `task.completed/blocked` | wynik wykonania |
| `task.waiting-human` | agent potrzebuje decyzji człowieka |
| `tool.call` | agent wywołał narzędzie (scrape, search...) |
| `memory.observed/reflected` | system pamięci agenta |
| `project.completed` | wszystkie taski done |

---

## Obsługa człowieka

Jeśli agent nie może podjąć decyzji → wywołuje `request_human`:
- task dostaje status `waiting-human`
- system **nie blokuje** pozostałych agentów
- w kolejnej rundzie: odpowiedź jest dopisywana do frontmattera (`human_answer`), task wraca do `open`

---

## Odporność na crash

Stan systemu = pliki na dysku. Jeśli proces padnie w połowie rundy → restart od nowa czyta pliki i kontynuuje od aktualnego stanu.
