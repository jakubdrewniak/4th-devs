import type { WeatherSlot } from '../types.js';

export const forecast: WeatherSlot[] = [
  // ─── Wednesday Feb 25 — sunny, cool ──────────────────────────────────

  { date: '2026-02-25', hour: 6,  tempC: 2,  condition: 'clear',         windKmh: 5,  precipMm: 0, description: 'Clear and cold' },
  { date: '2026-02-25', hour: 9,  tempC: 5,  condition: 'sunny',         windKmh: 8,  precipMm: 0, description: 'Sunny, light breeze' },
  { date: '2026-02-25', hour: 12, tempC: 8,  condition: 'sunny',         windKmh: 10, precipMm: 0, description: 'Sunny and pleasant' },
  { date: '2026-02-25', hour: 15, tempC: 7,  condition: 'sunny',         windKmh: 8,  precipMm: 0, description: 'Sunny, cooling down' },
  { date: '2026-02-25', hour: 18, tempC: 4,  condition: 'clear',         windKmh: 5,  precipMm: 0, description: 'Clear evening' },
  { date: '2026-02-25', hour: 21, tempC: 2,  condition: 'clear',         windKmh: 3,  precipMm: 0, description: 'Cold, clear night' },

  // ─── Thursday Feb 26 — rain from late morning ────────────────────────

  { date: '2026-02-26', hour: 6,  tempC: 1,  condition: 'cloudy',        windKmh: 12, precipMm: 0,   description: 'Overcast and cold' },
  { date: '2026-02-26', hour: 9,  tempC: 3,  condition: 'cloudy',        windKmh: 15, precipMm: 0,   description: 'Grey skies, windy' },
  { date: '2026-02-26', hour: 12, tempC: 4,  condition: 'rainy',         windKmh: 20, precipMm: 2.5, description: 'Steady rain, gusty wind' },
  { date: '2026-02-26', hour: 15, tempC: 5,  condition: 'rainy',         windKmh: 18, precipMm: 1.8, description: 'Light rain continues' },
  { date: '2026-02-26', hour: 18, tempC: 3,  condition: 'rainy',         windKmh: 15, precipMm: 1.2, description: 'Rain tapering off, cold' },
  { date: '2026-02-26', hour: 21, tempC: 2,  condition: 'cloudy',        windKmh: 10, precipMm: 0,   description: 'Dry but overcast' },

  // ─── Friday Feb 27 — clear, warmer ──────────────────────────────────

  { date: '2026-02-27', hour: 6,  tempC: 5,  condition: 'clear',         windKmh: 5,  precipMm: 0, description: 'Fresh and clear' },
  { date: '2026-02-27', hour: 9,  tempC: 8,  condition: 'sunny',         windKmh: 8,  precipMm: 0, description: 'Bright morning sun' },
  { date: '2026-02-27', hour: 12, tempC: 11, condition: 'sunny',         windKmh: 10, precipMm: 0, description: 'Warm for February' },
  { date: '2026-02-27', hour: 15, tempC: 12, condition: 'sunny',         windKmh: 8,  precipMm: 0, description: 'Pleasant afternoon' },
  { date: '2026-02-27', hour: 18, tempC: 10, condition: 'clear',         windKmh: 5,  precipMm: 0, description: 'Clear, mild evening' },
  { date: '2026-02-27', hour: 21, tempC: 7,  condition: 'clear',         windKmh: 3,  precipMm: 0, description: 'Cool, starry night' },

  // ─── Saturday Feb 28 — cloudy ────────────────────────────────────────

  { date: '2026-02-28', hour: 9,  tempC: 4,  condition: 'cloudy',        windKmh: 10, precipMm: 0, description: 'Overcast morning' },
  { date: '2026-02-28', hour: 12, tempC: 6,  condition: 'cloudy',        windKmh: 12, precipMm: 0, description: 'Grey but dry' },
  { date: '2026-02-28', hour: 18, tempC: 5,  condition: 'partly_cloudy', windKmh: 8,  precipMm: 0, description: 'Some breaks in clouds' },

  // ─── Sunday Mar 1 — partly cloudy ───────────────────────────────────

  { date: '2026-03-01', hour: 9,  tempC: 5,  condition: 'partly_cloudy', windKmh: 8,  precipMm: 0, description: 'Mixed skies' },
  { date: '2026-03-01', hour: 12, tempC: 8,  condition: 'partly_cloudy', windKmh: 10, precipMm: 0, description: 'Sun and clouds' },
  { date: '2026-03-01', hour: 18, tempC: 6,  condition: 'cloudy',        windKmh: 8,  precipMm: 0, description: 'Clouding over' },

  // ─── Monday Mar 2 — cloudy, then clearing ───────────────────────────

  { date: '2026-03-02', hour: 6,  tempC: 4,  condition: 'cloudy',        windKmh: 12, precipMm: 0, description: 'Grey start' },
  { date: '2026-03-02', hour: 9,  tempC: 6,  condition: 'cloudy',        windKmh: 15, precipMm: 0, description: 'Overcast and breezy' },
  { date: '2026-03-02', hour: 12, tempC: 8,  condition: 'partly_cloudy', windKmh: 12, precipMm: 0, description: 'Clouds breaking up' },
  { date: '2026-03-02', hour: 15, tempC: 9,  condition: 'sunny',         windKmh: 10, precipMm: 0, description: 'Afternoon sun' },
  { date: '2026-03-02', hour: 18, tempC: 6,  condition: 'clear',         windKmh: 8,  precipMm: 0, description: 'Clear evening' },
];

export const getWeatherAt = (date: string, hour: number): WeatherSlot | undefined => {
  const exact = forecast.find((s) => s.date === date && s.hour === hour);
  if (exact) return exact;

  const sameDay = forecast.filter((s) => s.date === date);
  if (sameDay.length === 0) return undefined;

  return sameDay.reduce((closest, slot) =>
    Math.abs(slot.hour - hour) < Math.abs(closest.hour - hour) ? slot : closest,
  );
};
