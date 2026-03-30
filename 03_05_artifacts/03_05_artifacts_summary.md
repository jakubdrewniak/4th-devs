# 03_05_artifacts — Generator interaktywnych artefaktów HTML

## Co robi ta aplikacja?

To narzędzie w terminalu, które na podstawie opisu słownego generuje **kompletne, działające mini-aplikacje webowe** (artefakty HTML) i wyświetla je na żywo w przeglądarce. Możesz też edytować wygenerowany artefakt przez wyszukiwanie i zamienianie fragmentów kodu.

---

## Jak działa krok po kroku

### 1. Uruchomienie — serwer podglądu

Aplikacja startuje dwa serwery:

```
Serwer podglądu (np. http://localhost:3030)
→ Wyświetla wygenerowany HTML w przeglądarce
→ Odświeża się automatycznie gdy artefakt się zmienia
```

Przeglądarka otwiera się automatycznie (jeśli tak ustawiono w konfiguracji).

### 2. Wstępne ładowanie "paczek możliwości"

Przed pierwszym pytaniem aplikacja ładuje "capability packs" — zestawy bibliotek JS, które można wstrzyknąć do artefaktu:
- np. paczka `tailwind` — dodaje Tailwind CSS
- np. paczka `chart` — dodaje bibliotekę wykresów

### 3. Pętla rozmowy

```
you > zbuduj interaktywny kalkulator BMI z kolorowym wynikiem
```

### 4. Agent-router decyduje co zrobić

Model AI dostaje wiadomość i dwa narzędzia do wyboru:

- **`create_artifact`** — gdy użytkownik chce coś zbudować/stworzyć
- **`edit_artifact`** — gdy użytkownik chce zmienić istniejący artefakt
- **brak narzędzia** — gdy to zwykła rozmowa (np. "cześć")

**Przykład decyzji routera dla "zbuduj kalkulator BMI":**
```json
{
  "tool": "create_artifact",
  "prompt": "Interaktywny kalkulator BMI z kolorowym wynikiem",
  "packs": []
}
```

### 5. Generowanie artefaktu

Agent wysyła zapytanie do modelu z instrukcją:

```
Generuj interaktywne artefakty przeglądarkowe.
Zwróć JSON w formacie: {"title":"string","html":"string"}
Zasady:
- HTML musi być samodzielny (bez zewnętrznych skryptów)
- JavaScript inline i mały
- ciało renderuje się natychmiast
```

**Model odpowiada:**
```json
{
  "title": "Kalkulator BMI",
  "html": "<main>...<input id='weight'>...<script>/* logika BMI */</script></main>"
}
```

### 6. Składanie dokumentu HTML

Surowy HTML jest owijany w pełny dokument z:
- nagłówkami bezpieczeństwa (Content Security Policy)
- stylami scrollbara
- tagiem `<script>` z wczytanymi paczkami (jeśli wybrano)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="..." />
    <title>Kalkulator BMI</title>
    <!-- opcjonalnie paczki np. Tailwind -->
    <style>/* style scrollbara */</style>
  </head>
  <body>
    <!-- wygenerowany HTML -->
    <main>
      <input id="weight" placeholder="Waga (kg)">
      <input id="height" placeholder="Wzrost (cm)">
      <button onclick="calc()">Oblicz</button>
      <div id="result"></div>
      <script>
        function calc() {
          const w = parseFloat(document.getElementById('weight').value);
          const h = parseFloat(document.getElementById('height').value) / 100;
          const bmi = w / (h * h);
          document.getElementById('result').style.color = bmi < 25 ? 'green' : 'red';
          document.getElementById('result').textContent = bmi.toFixed(1);
        }
      </script>
    </main>
  </body>
</html>
```

### 7. Wyświetlenie w przeglądarce

Serwer podglądu dostaje nowy HTML i wysyła event do przeglądarki (Server-Sent Events). Przeglądarka odświeża podgląd bez przeładowania strony.

### 8. Edycja artefaktu przez search/replace

```
you > zmień kolor wyniku dobrego na niebieski zamiast zielonego
```

Router decyduje: `edit_artifact`. Model generuje operacje wyszukiwania i zamiany:

```json
{
  "instructions": "Zmiana koloru dla dobrego BMI",
  "replacements": [
    {
      "search": "'green'",
      "replace": "'blue'"
    }
  ]
}
```

Edytor stosuje operacje sekwencyjnie na istniejącym HTML. Jeśli żaden wzorzec nie pasuje — informuje użytkownika.

---

## Kluczowe koncepcje

| Koncepcja | Co oznacza |
|-----------|-----------|
| **Artefakt** | Samodzielna mini-aplikacja HTML — działa bez internetu, bez zewnętrznych zależności |
| **Capability packs** | Zestawy bibliotek (Tailwind, wykresy) wstrzykiwane do artefaktu |
| **Router** | Model AI decyduje czy tworzyć, edytować, czy tylko odpowiedzieć |
| **Search/replace edycja** | Zamiast regenerowania całego artefaktu, zmienia się tylko konkretne fragmenty kodu |
| **Live preview** | Przeglądarka odświeża się automatycznie po każdej zmianie |
| **CSP** | Content Security Policy — polityka bezpieczeństwa blokująca zewnętrzne zasoby |

---

## Analogia do Angulara

To jak Angular CLI `ng generate component` ale zamiast szablonu — generujesz gotowy, działający komponent przez rozmowę. Edycja search/replace to jak patch w git — precyzyjna zmiana bez przepisywania całości.
