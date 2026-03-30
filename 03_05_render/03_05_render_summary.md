# 03_05_render — Generator dashboardów opartych na specyfikacji komponentów

## Co robi ta aplikacja?

To narzędzie w terminalu, które generuje **dashboardy i raporty** złożone z gotowych komponentów (wykresy, tabele, metryki, karty). W odróżnieniu od `03_05_artifacts` które generuje dowolny HTML, tutaj model AI nie pisze kodu — zamiast tego opisuje układ w formacie JSON (specyfikacja), a aplikacja sama renderuje to do HTML.

---

## Jak działa krok po kroku

### 1. Uruchomienie — serwer podglądu

Podobnie jak w `artifacts`, startuje serwer HTTP z podglądem w przeglądarce, który odświeża się po każdej zmianie.

### 2. Pętla rozmowy

```
you > stwórz dashboard sprzedaży z KPI, wykresem trendu i tabelą kanałów
```

### 3. Agent-router decyduje co zrobić

Router ma dwa narzędzia:
- **`create_render`** — gdy trzeba wygenerować nowy dokument
- **`edit_render`** — gdy użytkownik chce zmodyfikować obecny dokument
- **brak narzędzia** — zwykła rozmowa

### 4. Generowanie specyfikacji

Model AI dostaje instrukcję: **nie pisz HTML ani JS, opisz układ w JSON**.

Format specyfikacji:
```json
{
  "title": "Dashboard sprzedaży Q1",
  "summary": "Przegląd wyników sprzedaży za Q1 2026",
  "spec": {
    "root": "root-stack",
    "elements": {
      "root-stack": {
        "type": "Stack",
        "props": { "direction": "vertical", "gap": "md" },
        "children": ["kpi-grid", "trend-card", "channels-card"]
      },
      "kpi-grid": {
        "type": "Grid",
        "props": { "columns": 3, "gap": "md" },
        "children": ["metric-leads", "metric-revenue", "metric-win"]
      },
      "metric-leads": {
        "type": "Metric",
        "props": {
          "label": { "$state": "/kpis/0/label" },
          "value": { "$state": "/kpis/0/value" },
          "trend": { "$state": "/kpis/0/trend" }
        },
        "children": []
      },
      "trend-card": {
        "type": "Card",
        "props": { "title": "Trend przychodów" },
        "children": ["line-chart"]
      },
      "line-chart": {
        "type": "LineChart",
        "props": {
          "data": { "$state": "/trendData" },
          "xKey": "month",
          "yKey": "revenue"
        },
        "children": []
      }
    }
  },
  "state": {
    "kpis": [
      { "label": "Leady", "value": "128", "trend": "up" },
      { "label": "Przychód", "value": "$1.24M", "trend": "down" },
      { "label": "Win rate", "value": "31.8%", "trend": "neutral" }
    ],
    "trendData": [
      { "month": "Sty", "revenue": 182000 },
      { "month": "Lut", "revenue": 176000 },
      { "month": "Mar", "revenue": 191000 }
    ]
  }
}
```

### 5. Walidacja specyfikacji

Zanim aplikacja wyrenderuje HTML, sprawdza:
- czy liczba elementów nie przekracza limitu
- czy wszystkie typy komponentów są na liście dozwolonych (np. `Stack`, `Card`, `Metric`, `LineChart`)
- czy referencje między elementami (`children`) są spójne (nie ma cykli ani brakujących ID)

Jeśli model użyje nieistniejącego komponentu np. `PieChart` (którego nie ma w katalogu) — walidacja odrzuca dokument.

### 6. Renderowanie spec → HTML

Każdy element w specyfikacji jest renderowany do HTML. Dane z `state` są wstrzykiwane do elementów przez "JSON Pointer":

```
{ "$state": "/kpis/0/value" }  →  pobiera state["kpis"][0]["value"]  →  "128"
```

**Dostępne komponenty:**

| Komponent | Co generuje |
|-----------|-------------|
| `Stack` | Układ flex (pionowy lub poziomy) |
| `Grid` | Siatka CSS (1–4 kolumny) |
| `Card` | Karta z tytułem i opisem |
| `Metric` | Pojedyncza metryka z wartością i trendem (▲/▼/•) |
| `LineChart` | Wykres liniowy jako SVG |
| `BarChart` | Wykres słupkowy |
| `Table` | Tabela z nagłówkami |
| `Heading` | Nagłówek h1–h4 |
| `Text` | Akapit tekstu |
| `Badge` | Kolorowa etykieta (success/warning/danger) |
| `Alert` | Blok alertu z kolorem tła |
| `Callout` | Blok z ważną informacją |
| `Accordion` | Rozwijana sekcja |
| `Input`, `Select`, `Switch`, `Button` | Elementy formularza (statyczne, wyłączone) |

**Przykład renderowania Metric:**
```html
<article class="jr-metric">
  <div class="jr-metric-label">Leady</div>
  <div class="jr-metric-value">128</div>
  <div class="jr-metric-detail">▲ +12% tydzień do tygodnia</div>
</article>
```

### 7. Wyświetlenie w przeglądarce

Gotowy HTML trafia do serwera podglądu, przeglądarka odświeża widok bez przeładowania.

### 8. Edycja istniejącego dokumentu

```
you > zmień tytuł dashboardu na "Wyniki Q2" i dodaj kolumnę "Cel" do tabeli
```

Router rozpoznaje: `edit_render`. Aplikacja wysyła do modelu **aktualną specyfikację JSON** razem z instrukcją co zmienić. Model generuje nową, zaktualizowaną specyfikację, która przechodzi przez tę samą walidację i renderowanie.

---

## Kluczowe różnice vs 03_05_artifacts

| | `03_05_artifacts` | `03_05_render` |
|---|---|---|
| **Output modelu** | Surowy HTML + JS | JSON ze specyfikacją |
| **Kontrola** | Model pisze dowolny kod | Model wybiera z listy komponentów |
| **Edycja** | Search/replace w HTML | Regeneracja całej specyfikacji |
| **Interaktywność** | Pełna (JS działa) | Statyczna (formularze wyłączone) |
| **Cel** | Mini-aplikacje, kalkulatory, gry | Dashboardy, raporty, przeglądy danych |

---

## Kluczowe koncepcje

| Koncepcja | Co oznacza |
|-----------|-----------|
| **Spec (specyfikacja)** | JSON opisujący drzewo komponentów — jak Virtual DOM ale statyczny |
| **State** | Oddzielny obiekt z danymi — komponenty nie przechowują danych bezpośrednio |
| **JSON Pointer** | `{ "$state": "/kpis/0/value" }` — sposób odwołania do konkretnej wartości w state |
| **Component guardrails** | Model może używać tylko dozwolonych komponentów — brak dowolnego kodu |
| **Paczki komponentów** | Zestaw komponentów dostępnych w danym dashboardzie |

---

## Analogia do Angulara

Specyfikacja JSON to jak `template` w Angular — opisuje strukturę widoku. State to jak `@Input` lub `signal`. Renderer to jak Angular runtime który zamienia template + dane w DOM. Model AI gra rolę dewelopera który pisze template, ale może używać tylko komponentów z design systemu.
