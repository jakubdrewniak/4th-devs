# 03_03_browser — Podsumowanie

Browser automation agent sterujący przeglądarką Chrome przez Playwright, z pętlą agentową opartą na OpenAI Responses API.

## Architektura

```
[Użytkownik] → [Agent Loop] ↔ [Model AI]
                    ↓
             [Tool Executor]
              ↓           ↓
      [Browser Tools]  [MCP File Tools]
       (Playwright)    (system plików)
```

## Tryby działania (`src/index.ts`)

- **`login`** — otwiera widoczną przeglądarkę, czeka aż użytkownik się zaloguje, zapisuje ciasteczka sesji do `data/session.json`
- **`chat`** — wczytuje sesję, startuje przeglądarkę headless, uruchamia pętlę rozmowy

## Zarządzanie przeglądarką (`src/browser.ts`)

Playwright + Chromium z ukryciem automatyzacji (`--disable-blink-features=AutomationControlled`) i realistycznym user-agentem. `BrowserContext` przechowuje ciasteczka sesji między turami.

## Pętla agenta (`src/agent/runner.ts`)

Klasyczny agentic loop — max `MAX_TURNS` iteracji:

1. Wysyłam wiadomość do AI
2. AI zwraca wywołania narzędzi → wykonuję je
3. Wyniki wracają do AI jako kolejny input
4. Gdy AI nie zwraca narzędzi — zwracam odpowiedź użytkownikowi

Optymalizacja kontekstu: zamiast wysyłać całą historię rozmowy, przekazywany jest tylko `previousResponseId` — model AI sam zarządza kontekstem.

## Narzędzia przeglądarki (`src/tools/browser-tools.ts`)

| Narzędzie | Opis |
|---|---|
| `navigate` | Otwiera URL, zapisuje tekst i DOM do plików |
| `evaluate` | Uruchamia JS w kontekście strony — **preferowane** do ekstrakcji |
| `click` | Klika po selektorze CSS lub widocznym tekście |
| `type_text` | Wpisuje tekst do pola, opcjonalnie Enter |
| `take_screenshot` | Zrzut ekranu jako obraz dla AI — fallback gdy selektory zawodzą |

`evaluate` jest najefektywniejsze — zwraca tylko to, o co zapytamy, bez ładowania całej strony do kontekstu AI.

## MCP File Tools (`src/mcp.ts`)

Lokalny serwer MCP daje agentowi dostęp do systemu plików:
- `fs_read` / `fs_write` / `fs_search`
- Agent zapisuje odkryte selektory CSS do `instructions/{site}-discoveries.md`
- Przy kolejnych pytaniach czyta je najpierw — **pamięć długoterminowa** między sesjami

## System feedbacku i interwencji (`src/feedback/`)

Samonaprawianie się agenta:
- Śledzi historię wywołań narzędzi (sukces/błąd)
- Po 2+ kolejnych błędach → wstrzykuje podpowiedź: `"Zrób screenshot, sprawdź stan strony"`
- Po odzyskaniu sprawności → sugeruje zapisanie działających selektorów do pliku discoveries
- Na koniec sesji dołącza wskazówkę o zapisaniu wiedzy jeśli były błędy

## System promptu (`src/prompt.ts`)

Dynamicznie budowany prompt systemowy zawiera:
- listę dostępnych narzędzi z opisami
- workflow: sprawdź instrukcje → użyj `evaluate` → buduj selektory z `.struct.txt` → zapisz odkrycia
- listę istniejących plików instrukcji dla znanych stron

## Przykładowy flow

```
User: "List all books by Jim Collins"

Turn 1: navigate("https://goodreads.com/search?q=Jim+Collins")
Turn 2: evaluate("Array.from(document.querySelectorAll('.bookTitle')).map(el=>el.textContent.trim())")
Turn 3: fs_write("instructions/goodreads-discoveries.md", "...")
Answer: "Oto książki Jima Collinsa: Good to Great, Built to Last..."
```

## Kluczowe koncepcje

- **Agentic loop** — AI samo decyduje kiedy i jakich narzędzi użyć
- **`previousResponseId`** — oszczędność tokenów przez delegowanie pamięci kontekstu do modelu
- **MCP** (Model Context Protocol) — standaryzowany protokół do integracji zewnętrznych serwisów z AI
- **Feedback loop** — agent uczy się z błędów w trakcie sesji i między sesjami (pliki discoveries)
