# Gmail AI Agent — Podsumowanie

## Co to jest?

Chatbot terminalowy, który rozumie polecenia w naturalnym języku i wykonuje operacje na Gmailu przez Gmail API. Przykład użycia:

```
"Znajdź moje nieprzeczytane maile od Anny"
"Odpowiedz na wątek z fakturą: Dziękuję, otrzymałem"
```

## Architektura — 4 warstwy

```
[Użytkownik (terminal)]
        ↓
[Agent Loop — "mózg" aplikacji]
        ↓
[Tools — 5 narzędzi Gmail]
        ↓
[Gmail API (Google)]
```

## Kluczowe pliki

| Plik | Rola |
|---|---|
| `src/index.ts` | Punkt wejścia, pętla readline w terminalu |
| `src/agent/runtime.ts` | Pętla agenta (max 8 tur) |
| `src/agent/tool-call.ts` | Walidacja i wykonanie narzędzi |
| `src/tools/` | 5 narzędzi Gmail |
| `src/hints/index.ts` | System strukturyzowanych odpowiedzi |
| `src/gmail/client.ts` | Integracja z Gmail API + whitelist bezpieczeństwa |
| `src/gmail/mock-client.ts` | Mock do evalów |

## Pętla agenta (runtime.ts)

Klasyczna pętla ReAct (Reason + Act):

```
Turn 1: wiadomość użytkownika → model wywołuje narzędzie
Turn 2: wynik narzędzia → model wywołuje kolejne narzędzie lub odpowiada
...
Turn N: brak wywołań narzędzi → zwróć finalText do użytkownika
```

Domyślnie max **8 tur** — zabezpieczenie przed nieskończoną pętlą.

## 5 narzędzi Gmail

| Narzędzie | Opis |
|---|---|
| `gmail_search` | Szuka maili (składnia Gmail: `from:anna is:unread`) |
| `gmail_read` | Czyta treść maila lub wątku po ID |
| `gmail_send` | Wysyła nowy mail / odpowiedź / forward |
| `gmail_modify` | Oznacza przeczytane, archiwizuje, przenosi do kosza, zarządza etykietami |
| `gmail_attachment` | Pobiera załącznik i zwraca zawartość w base64 |

Każde narzędzie ma schemat Zod — walidacja odbywa się przed wykonaniem.

## System Hints (hints/index.ts)

Każda odpowiedź narzędzia ma ustrukturyzowany format:

```ts
{
  data: { ... },        // właściwe dane (maile, wyniki, itd.)
  hint: {
    status: 'success' | 'empty' | 'error',
    reasonCode: 'OK' | 'NO_RESULTS' | 'AUTH_REQUIRED' | ...,
    summary: "opis co się stało",
    nextActions: [      // propozycje kolejnych kroków dla modelu
      { tool: 'gmail_read', why: "...", args: { id: "..." }, confidence: 0.9 }
    ],
    recovery: { retryable: true, backoffMs: 3000, maxAttempts: 3 }
  }
}
```

Dzięki temu model wie nie tylko *co dostał*, ale też *co zrobić dalej* i *jak obsłużyć błąd*.

## Walidacja tool call (tool-call.ts)

3-etapowy pipeline przed wykonaniem każdego narzędzia:

```
1. Parsowanie JSON argumentów  → błąd → hint z INVALID_ARGUMENT
2. Walidacja schematu Zod      → błąd → hint z opisem problemu
3. Wykonanie handlera          → błąd → hint z klasyfikacją błędu
```

Błąd na każdym etapie wraca do modelu jako hint — model może spróbować poprawić argumenty.

## Bezpieczeństwo wysyłania (gmail/client.ts)

Whitelist odbiorców — jeśli adresat NIE jest na liście, mail jest automatycznie zapisywany jako draft zamiast wysyłany:

```ts
const blockedRecipients = allRecipients.filter(r => !whitelistSet.has(r));
const enforcedDraft = blockedRecipients.length > 0;
```

Właściciel konta zawsze jest na whitelist (może pisać do siebie).

## Session — pamięć rozmowy

```ts
const session = createSession(); // history: []
```

`session.history` to tablica wszystkich wiadomości (użytkownik + model + wyniki narzędzi). Dzięki temu model "pamięta" cały kontekst rozmowy, a nie tylko ostatnią wiadomość.

## Evals (Promptfoo)

Testy automatyczne w `evals/promptfoo/`:
- **tools** — czy każde narzędzie działa poprawnie (mock Gmail)
- **scenarios/actions** — czy agent wykonuje wieloetapowe zadania
- **scenarios/safety** — czy nie wysyła maili do nieautoryzowanych adresatów
- **scenarios/readonly** — czy nie modyfikuje skrzynki gdy nie powinien

Uruchomienie:
```bash
cd 03_04_gmail
bun run eval:tools
bun run eval:scenarios
bun run eval:all
```

## Przepływ dla przykładowego polecenia

```
Ty: "Znajdź nieprzeczytane maile od Anny"

Turn 1:
  Model → gmail_search({ query: "from:anna is:unread", limit: 20 })
  Wynik → { data: [3 maile], hint: { status: "success", nextActions: [...] } }

Turn 2:
  Model → "Znalazłem 3 nieprzeczytane maile od Anny:
            1. Spotkanie w piątek (12:30)
            2. Faktura #123 (wczoraj)
            ..."
```
