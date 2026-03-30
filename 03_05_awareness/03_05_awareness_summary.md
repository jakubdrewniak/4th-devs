# 03_05_awareness — Asystent z pamięcią i świadomością kontekstu

## Co robi ta aplikacja?

To konwersacyjny asystent AI uruchamiany w terminalu. Różni się od zwykłego chatbota tym, że **pamięta kim jesteś** i potrafi sięgać po zapamiętaną o Tobie wiedzę zanim odpowie.

---

## Jak działa krok po kroku

### 1. Uruchomienie — sprawdzenie workspace'u

Aplikacja startuje i sprawdza, czy folder `workspace/` zawiera wymagane pliki z wiedzą o użytkowniku:

```
workspace/
  profile/
    user/
      identity.md          ← kim jesteś (imię, miasto zamieszkania itp.)
      preferences.md       ← Twoje preferencje i upodobania
      important-dates.json ← ważne daty (urodziny, rocznice)
    agent/
      persona.md           ← jak asystent powinien się zachowywać
  memory/
    episodic/              ← wspomnienia z konkretnych wydarzeń
    factual/               ← zapamiętane fakty
    procedural/            ← zapamiętane procedury/nawyki
  system/
    chat/history.jsonl     ← historia rozmów
```

Jeśli brakuje któregokolwiek z wymaganych plików, aplikacja zgłasza błąd zamiast startować.

### 2. Wczytanie historii rozmów

Przed pierwszą odpowiedzią aplikacja wczytuje ostatnie N wiadomości z historii (domyślnie 16 ostatnich wymian). Dzięki temu asystent "pamięta" poprzednie rozmowy.

### 3. Pętla rozmowy w terminalu

```
you > Hej, jak mam dziś ubrać się do pracy?
```

Każda wiadomość od użytkownika jest owijana w **metadane czasowe**:

```
<metadata>
now_iso: 2026-03-27T09:15:00.000Z
weekday: Friday
local_time: 09:15:00
timezone: Europe/Warsaw
recallable: persona, user_identity, user_preferences, ...
nudge: think before you respond; recall when the topic shifts
</metadata>

Hej, jak mam dziś ubrać się do pracy?
```

### 4. Agent ma dwa narzędzia: `think` i `recall`

**Narzędzie `think`** — asystent zadaje sobie pytania wewnętrznie zanim odpowie:
```json
{
  "questions": [
    "Gdzie mieszka użytkownik i jaka jest tam dziś pogoda?",
    "Czy znam jego preferencje co do stylu ubioru?"
  ]
}
```

**Narzędzie `recall`** — asystent wywołuje podagenta "scout", który przeszukuje pliki w workspace:
```json
{
  "goal": "Gdzie mieszka użytkownik i jakie ma preferencje ubioru?"
}
```

### 5. Scout — podagent przeszukujący pamięć

Scout to osobny model AI, który dostaje listę narzędzi MCP (dostęp do plików w workspace) i szuka odpowiedzi na pytanie głównego agenta. Może wykonać do 8 kroków szukania.

**Przykład działania scout'a:**
1. Odczytuje `workspace/system/index.md` (indeks wszystkich plików)
2. Otwiera `workspace/profile/user/identity.md` → znajdzie "Location: Warsaw"
3. Otwiera `workspace/profile/user/preferences.md` → znajdzie "Preferuje casual"
4. Pobiera pogodę dla Warszawy z `open-meteo.com` → "Mainly clear, 8°C"
5. Zwraca podsumowanie do głównego agenta

### 6. Asystent odpowiada

Po zebraniu kontekstu, asystent formułuje odpowiedź:

```
agent > W Warszawie dziś rano jest 8°C i słonecznie.
        Biorąc pod uwagę Twoje preferencje casual —
        polecam warstwowanie: koszulka, bluza i kurtka przejściowa.
```

### 7. Zapis historii

Wymiana trafia do `workspace/system/chat/history.jsonl` jako linia JSON:
```json
{"at":"2026-03-27T09:15:12Z","sessionId":"awareness-abc123","role":"user","content":"Hej, jak..."}
{"at":"2026-03-27T09:15:18Z","sessionId":"awareness-abc123","role":"assistant","content":"W Warszawie..."}
```

---

## Kluczowe koncepcje

| Koncepcja | Co oznacza |
|-----------|-----------|
| **Awareness** | Asystent "wie" o użytkowniku zanim zapyta — nie trzeba mu za każdym razem tłumaczyć kim jesteś |
| **Scout** | Osobny podagent AI który przeszukuje pliki — nie ładuje wszystkiego na raz, tylko to co potrzebne |
| **MCP** | Protokół pozwalający agentowi wywoływać narzędzia (tu: czytanie plików) |
| **Metadane czasowe** | Każda wiadomość zawiera aktualny czas — asystent wie że jest piątek rano |
| **Pogoda on-demand** | Jeśli pytanie dotyczy pogody, scout pobiera ją z otwartego API na żywo |

---

## Analogia do Angulara

Scout to jak lazy-loaded moduł — ładuje tylko tę część wiedzy, która jest aktualnie potrzebna do odpowiedzi. Główny agent to router, który decyduje kiedy i co załadować.
