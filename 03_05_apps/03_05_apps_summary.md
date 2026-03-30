# 03_05_apps — Menedżer list (todo/zakupy) z MCP i interfejsem przeglądarkowym

## Co robi ta aplikacja?

To narzędzie które łączy trzy rzeczy w jednym:
1. **Terminal (CLI)** — rozmawiasz z AI o swoich listach
2. **Przeglądarka (UI)** — edytujesz listy todo i zakupów przez graficzny interfejs
3. **Serwer MCP** — protokół który pozwala zewnętrznym agentom AI zarządzać listami

Kluczowy pomysł: **AI nie modyfikuje list bezpośrednio** — tylko otwiera przeglądarkę, a użytkownik sam robi zmiany w UI.

---

## Jak działa krok po kroku

### 1. Uruchomienie — dwa serwery

Aplikacja startuje równocześnie dwa serwery HTTP:

```
Serwer UI (np. http://localhost:3030)
→ Serwuje stronę HTML z listami todo i zakupów
→ REST API: GET /api/state, POST /api/save

Serwer MCP (np. http://localhost:3031/mcp)
→ Protokół MCP dla zewnętrznych agentów AI
→ Narzędzia: manage_lists, get_lists_state, save_lists_state
```

Pliki z danymi (np. `todo.md`, `shopping.md`) są tworzone automatycznie jeśli nie istnieją.

### 2. Format przechowywania list

Listy są trzymane w plikach Markdown:

**todo.md:**
```markdown
- [ ] Kupić mleko
- [x] Zapłacić rachunki
- [ ] Zarezerwować wizytę u lekarza
```

**shopping.md:**
```markdown
- [ ] Jabłka
- [ ] Chleb
- [x] Masło
```

### 3. Pętla rozmowy w terminalu

```
you > pokaż mi moje listy zakupów
```

### 4. Agent-router decyduje co zrobić

Model AI dostaje wiadomość i jedno narzędzie do wyboru:

**`open_list_manager`** — otwiera przeglądarkę z interfejsem do zarządzania listami

Ważna zasada zaprogramowana w instrukcji dla modelu:
> "open_list_manager ONLY opens a browser UI — it does NOT add, remove, or modify any items."

**Przykład: użytkownik pisze "chcę zobaczyć zakupy":**

Model odpowiada wywołaniem narzędzia:
```json
{
  "tool": "open_list_manager",
  "focus": "shopping"
}
```

Aplikacja odpowiada:
```
agent > Otwieram menedżer list (zakupy). Masz 3 pozycje na liście zakupów.
```

I automatycznie otwiera przeglądarkę pod adresem `http://localhost:3030`.

**Przykład: użytkownik pisze "cześć":**

Model rozpoznaje że to zwykła rozmowa i nie wywołuje narzędzia:
```
agent > Cześć! Mogę otworzyć menedżer list jeśli chcesz przeglądać lub edytować swoje listy todo i zakupów.
```

### 5. Interfejs w przeglądarce

Strona HTML pokazuje obie listy. Użytkownik może:
- zaznaczać pozycje jako zrobione
- dodawać nowe pozycje
- usuwać pozycje
- przełączać się między listą todo a zakupami

Po każdej zmianie przeglądarka wysyła `POST /api/save` z nowym stanem list, które są zapisywane z powrotem do plików Markdown.

### 6. Serwer MCP — dla zewnętrznych agentów

Oprócz CLI, aplikacja wystawia serwer MCP. Oznacza to, że inny agent AI (np. Claude Desktop, Cursor) może:

- wywołać `manage_lists` → otwiera UI
- wywołać `get_lists_state` → pobiera aktualny stan list jako JSON
- wywołać `save_lists_state` → zapisuje nowy stan list

**Przykład odpowiedzi `get_lists_state`:**
```json
{
  "todo": [
    { "text": "Kupić mleko", "done": false },
    { "text": "Zapłacić rachunki", "done": true }
  ],
  "shopping": [
    { "text": "Jabłka", "done": false },
    { "text": "Chleb", "done": false }
  ]
}
```

---

## Przepływ danych — pełny diagram

```
Terminal (CLI)
    ↓ wpisuje: "chcę edytować zakupy"
Agent AI (router)
    ↓ decyduje: open_list_manager(focus="shopping")
Aplikacja
    ↓ otwiera przeglądarkę na http://localhost:3030
Przeglądarka UI
    ↓ GET /api/state → pobiera listy z plików .md
    ↓ użytkownik edytuje
    ↓ POST /api/save → zapisuje z powrotem do .md
Pliki Markdown (todo.md, shopping.md)
```

```
Zewnętrzny agent AI (np. Claude Desktop)
    ↓ wywołuje narzędzie MCP: get_lists_state
Serwer MCP (port 3031)
    ↓ czyta pliki .md
    → zwraca JSON ze stanem list
```

---

## Kluczowe koncepcje

| Koncepcja | Co oznacza |
|-----------|-----------|
| **MCP (Model Context Protocol)** | Standardowy protokół pozwalający agentom AI wywoływać narzędzia na zewnętrznych serwerach |
| **MCP App** | Rozszerzenie MCP które pozwala zarejestrować UI (HTML) powiązany z narzędziem |
| **Rozdzielenie odpowiedzialności** | AI mówi co zrobić, przeglądarka pozwala użytkownikowi to zrobić |
| **Markdown jako baza danych** | Listy są prostymi plikami `.md` — czytelne bez żadnej aplikacji |
| **resourceUri** | Specjalny adres `ui://lists/manager.html` identyfikujący UI w protokole MCP |

---

## Dlaczego AI nie modyfikuje list bezpośrednio?

To celowy wybór architektoniczny. AI może się mylić (np. usunąć coś czego nie chciałeś). Zamiast dawać mu możliwość bezpośredniej edycji, pokazuje Ci interfejs gdzie **Ty** jesteś tym który zatwierdza każdą zmianę. To wzorzec "human in the loop" — człowiek w pętli decyzyjnej.

---

## Analogia do Angulara

Serwer MCP to jak Angular Service wystawiony przez dependency injection — inne komponenty (agenci) mogą go wstrzyknąć i użyć. Serwer UI to jak standalone component z własnym routing. Pliki Markdown to jak localStorage — prosty, trwały magazyn bez bazy danych.
