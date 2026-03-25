import type { EnvironmentState } from '../types.js';
import { places } from './places.js';
import { getWeatherAt } from './weather.js';

const resolvePlace = (placeId: string) => {
  const place = places.find((p) => p.id === placeId);
  if (!place) throw new Error(`Unknown place: ${placeId}`);
  return place;
};

const state: EnvironmentState = {
  currentTime: '2026-02-25T09:00:00+01:00',
  userLocation: {
    placeId: 'p-home',
    name: "Adam's Apartment",
    coordinates: { lat: 50.0637, lng: 19.9390 },
  },
};

export const getEnvironment = (): Readonly<EnvironmentState> => ({ ...state });

export const setTime = (iso: string): void => {
  state.currentTime = iso;
};

export const setUserLocation = (placeId: string): void => {
  const place = resolvePlace(placeId);
  state.userLocation = {
    placeId: place.id,
    name: place.name,
    coordinates: { ...place.coordinates },
  };
};

export const buildMetadata = (): string => {
  const dt = new Date(state.currentTime);
  const date = state.currentTime.slice(0, 10);
  const hour = dt.getHours();
  const weather = getWeatherAt(date, hour);

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[dt.getDay()];

  const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });

  const lines = [
    `<metadata>`,
    `Current time: ${dayName}, ${date} ${timeStr} CET`,
    `Location ID: ${state.userLocation.placeId}`,
    `Location: ${state.userLocation.name} (${resolvePlace(state.userLocation.placeId).address})`,
  ];

  if (weather) {
    lines.push(
      `Weather: ${weather.description} — ${weather.tempC}°C, wind ${weather.windKmh} km/h` +
        (weather.precipMm > 0 ? `, precipitation ${weather.precipMm} mm` : ''),
    );
  }

  lines.push(`</metadata>`);
  return lines.join('\n');
};
