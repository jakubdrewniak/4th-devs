const lines = [
  "",
  "  Cyfrowy Ogród",
  "",
  "  Ten przykład łączy trzy elementy:",
  "  1. publiczną bazę wiedzy w Markdownie w `vault/**`",
  "  2. agenta, który może tworzyć, edytować i wzbogacać notatki",
  "  3. generator statycznej strony w `grove/`, który zamienia vault na HTML",
  "",
  "  Proponowane pierwsze kroki:",
  "  - Poproś agenta o dodanie 3-4 ulubionych książek do shelf.",
  "  - Utwórz krótką notatkę w lab o czymś, czego się uczysz.",
  "  - Zapisz notatki researchowe w `vault/research/<temat>/`.",
  "",
  "  Po aktualizacji vault przez agenta:",
  "  - Zbuduj grove poleceniem `bun run build`.",
  "  - Podejrzyj wygenerowaną stronę przez `bun run preview`.",
  "",
  "  Ważne:",
  "  - Traktuj ten przykład jako public-by-design.",
  "  - `vault/system/**` zawiera instrukcje agenta i skille.",
  "  - Wpisz `exit`, aby zamknąć CLI.",
  "",
];

export function printWelcome(): void {
  console.log(lines.join("\n"));
}
