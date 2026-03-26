# 03_03_language — English Coaching Agent

## Co to jest?

Interaktywny asystent w terminalu, który analizuje nagrania audio po angielsku i daje spersonalizowany feedback (tekst + audio TTS). Używa Gemini API do ASR, analizy językowej i syntezy mowy.

## Architektura

```
index.ts          — punkt wejścia, pętla readline (terminal)
  └── agent.ts    — pętla agentowa (turn loop z LLM)
        ├── prompt.ts   — system prompt dla Gemini
        ├── hooks.ts    — strażnik stanu sesji
        ├── tools.ts    — narzędzia: listen, feedback, speak, fs_read, fs_write
        └── gemini.ts   — warstwa HTTP do Gemini API
```

## Pętla agentowa (agent.ts)

Agent rozmawia z Gemini w wielu turach (max `MAX_TURNS`). Każda tura to:
1. Wysłanie wiadomości/wyników narzędzi do Gemini
2. Odczytanie odpowiedzi (tekst lub wywołania narzędzi)
3. Wykonanie narzędzi → wyniki wracają jako input do kolejnej tury

Kontekst rozmowy utrzymywany przez `previous_interaction_id` — API Gemini pamięta historię po stronie serwera.

## Narzędzia (tools.ts)

| Narzędzie | Opis |
|-----------|------|
| `listen`   | Wysyła plik audio do Gemini → JSON z transkryptem, błędami gramatyki/wymowy, mocnymi stronami |
| `feedback` | Generuje spersonalizowany feedback (tekst + TTS audio) na podstawie `listen` i profilu użytkownika |
| `speak`    | Czyste TTS — zamienia tekst na plik `.wav` przez Gemini |
| `fs_read`  | Czyta plik z workspace (np. `profile.json`) |
| `fs_write` | Zapisuje plik do workspace (sesje, profil) |

## Hooks (hooks.ts)

Pilnują deterministycznego przepływu sesji. Śledzą 3 fazy:

```
listen_done → feedback_done → session_saved
```

- **`beforeToolCall`** — zapamiętuje kontekst przed wywołaniem narzędzia (np. ścieżkę audio)
- **`afterToolResult`** — aktualizuje stan po każdym wyniku (flagi faz, wyniki listen/feedback)
- **`beforeFinish`** — blokuje zakończenie agenta, jeśli brakuje kroków — wstrzykuje wiadomość wymuszającą dokończenie

## Pełny przepływ dla jednego nagrania

```
Użytkownik: "Please give me feedback on input/day.wav"
  Turn 1: fs_read profile.json
  Turn 2: listen input/day.wav       → Gemini ASR + analiza językowa
  Turn 3: feedback(listen, profile)  → tekst + TTS audio (.wav)
  Turn 4: fs_write sessions/xxx.json → zapis sesji
  Turn 5: fs_write profile.json      → aktualizacja weakAreas
  Turn 6: odpowiedź tekstowa z feedbackiem dla użytkownika
```

## Taksonomia błędów (trait_id)

- `grammar.articles`, `grammar.verb_tense`, `grammar.preposition`, `grammar.word_form`
- `fluency.fillers`, `fluency.pace`, `fluency.hesitation`
- `pronunciation.stress`, `pronunciation.vowels`, `pronunciation.consonants`, `pronunciation.intonation`, `pronunciation.rhythm`

## Persystencja

```
workspace/
  profile.json              — profil ucznia (rola, cele, weakAreas)
  sessions/<date>-<id>.json — pełny zapis każdej sesji
  output/feedback.wav       — audio feedback do odsłuchania
  input/*.wav               — nagrania wejściowe
```

Feedback staje się coraz bardziej spersonalizowany — agent czyta poprzednie sesje i profil przy każdej nowej analizie.
