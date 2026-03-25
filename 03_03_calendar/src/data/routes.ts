import type { Route } from '../types.js';

export const routes: Route[] = [
  // ─── From Home (Stare Miasto) ────────────────────────────────────────

  {
    from: 'p-home',
    to: 'p-office',
    walking: { durationMin: 35, distanceKm: 2.9 },
    driving: { durationMin: 12, distanceKm: 3.8 },
    transit: { durationMin: 20, distanceKm: 3.5, line: 'Tram #3', stops: 6, description: 'Tram #3 from Poczta Główna toward Podgórze' },
  },
  {
    from: 'p-home',
    to: 'p-botanica',
    walking: { durationMin: 10, distanceKm: 0.8 },
    driving: { durationMin: 5, distanceKm: 1.2 },
  },
  {
    from: 'p-home',
    to: 'p-sakura',
    walking: { durationMin: 18, distanceKm: 1.5 },
    driving: { durationMin: 8, distanceKm: 2.1 },
    transit: { durationMin: 12, distanceKm: 1.8, line: 'Tram #1', stops: 3, description: 'Tram #1 from Poczta Główna toward Kazimierz' },
  },
  {
    from: 'p-home',
    to: 'p-cowork',
    walking: { durationMin: 20, distanceKm: 1.6 },
    driving: { durationMin: 8, distanceKm: 2.2 },
    transit: { durationMin: 14, distanceKm: 2.0, line: 'Tram #1', stops: 4, description: 'Tram #1 from Poczta Główna toward Kazimierz' },
  },
  {
    from: 'p-home',
    to: 'p-trattoria',
    walking: { durationMin: 33, distanceKm: 2.7 },
    driving: { durationMin: 11, distanceKm: 3.5 },
    transit: { durationMin: 18, distanceKm: 3.2, line: 'Tram #3', stops: 5, description: 'Tram #3 from Poczta Główna toward Limanowskiego' },
  },
  {
    from: 'p-home',
    to: 'p-galeria',
    walking: { durationMin: 12, distanceKm: 1.0 },
    driving: { durationMin: 5, distanceKm: 1.5 },
  },

  // ─── From Office (Podgórze) ──────────────────────────────────────────

  {
    from: 'p-office',
    to: 'p-trattoria',
    walking: { durationMin: 6, distanceKm: 0.5 },
    driving: { durationMin: 3, distanceKm: 0.7 },
  },
  {
    from: 'p-office',
    to: 'p-cowork',
    walking: { durationMin: 15, distanceKm: 1.2 },
    driving: { durationMin: 7, distanceKm: 1.8 },
    transit: { durationMin: 10, distanceKm: 1.5, line: 'Tram #24', stops: 3, description: 'Tram #24 from Podgórze toward Kazimierz' },
  },
  {
    from: 'p-office',
    to: 'p-sakura',
    walking: { durationMin: 12, distanceKm: 1.0 },
    driving: { durationMin: 5, distanceKm: 1.4 },
  },
  {
    from: 'p-office',
    to: 'p-botanica',
    walking: { durationMin: 42, distanceKm: 3.5 },
    driving: { durationMin: 15, distanceKm: 4.2 },
    transit: { durationMin: 25, distanceKm: 4.0, line: 'Tram #3', stops: 8, description: 'Tram #3 from Podgórze toward Poczta Główna, then walk' },
  },
  {
    from: 'p-office',
    to: 'p-home',
    walking: { durationMin: 35, distanceKm: 2.9 },
    driving: { durationMin: 12, distanceKm: 3.8 },
    transit: { durationMin: 20, distanceKm: 3.5, line: 'Tram #3', stops: 6, description: 'Tram #3 from Podgórze toward Poczta Główna' },
  },

  // ─── Between venues ──────────────────────────────────────────────────

  {
    from: 'p-trattoria',
    to: 'p-cowork',
    walking: { durationMin: 10, distanceKm: 0.8 },
    driving: { durationMin: 5, distanceKm: 1.1 },
  },
  {
    from: 'p-trattoria',
    to: 'p-sakura',
    walking: { durationMin: 8, distanceKm: 0.6 },
    driving: { durationMin: 4, distanceKm: 0.9 },
  },
  {
    from: 'p-botanica',
    to: 'p-home',
    walking: { durationMin: 10, distanceKm: 0.8 },
    driving: { durationMin: 5, distanceKm: 1.2 },
  },
  {
    from: 'p-cowork',
    to: 'p-home',
    walking: { durationMin: 20, distanceKm: 1.6 },
    driving: { durationMin: 8, distanceKm: 2.2 },
    transit: { durationMin: 14, distanceKm: 2.0, line: 'Tram #1', stops: 4, description: 'Tram #1 from Kazimierz toward Poczta Główna' },
  },
  {
    from: 'p-sakura',
    to: 'p-home',
    walking: { durationMin: 18, distanceKm: 1.5 },
    driving: { durationMin: 8, distanceKm: 2.1 },
    transit: { durationMin: 12, distanceKm: 1.8, line: 'Tram #1', stops: 3, description: 'Tram #1 from Kazimierz toward Poczta Główna' },
  },
];

export const findRoute = (
  from: string,
  to: string,
): Route | undefined => {
  const direct = routes.find((route) => route.from === from && route.to === to);
  if (direct) return direct;

  const reverse = routes.find((route) => route.from === to && route.to === from);
  if (!reverse) return undefined;

  return {
    from,
    to,
    walking: reverse.walking,
    driving: reverse.driving,
    transit: reverse.transit,
  };
};
