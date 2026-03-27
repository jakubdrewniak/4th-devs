import type { WeatherSnapshot } from '../types.js'

interface GeocodeResponse {
  results?: Array<{
    name?: string
    country?: string
    latitude?: number
    longitude?: number
  }>
}

interface ForecastResponse {
  current?: {
    temperature_2m?: number
    weather_code?: number
  }
}

const WEATHER_CODE_MAP: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  95: 'Thunderstorm',
}

export const extractLocation = (identityMarkdown: string): string | null => {
  const match = identityMarkdown.match(/Location:\s*(.+)$/im)
  if (!match?.[1]) return null
  const value = match[1].trim()
  return value.length > 0 ? value : null
}

export const fetchWeather = async (location: string): Promise<WeatherSnapshot | null> => {
  try {
    const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`
    const geocode = await fetch(geocodeUrl).then((res) => res.json() as Promise<GeocodeResponse>)
    const target = geocode.results?.[0]
    if (
      !target ||
      typeof target.latitude !== 'number' ||
      typeof target.longitude !== 'number'
    ) {
      return null
    }

    const forecastUrl =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${target.latitude}` +
      `&longitude=${target.longitude}` +
      `&current=temperature_2m,weather_code` +
      `&timezone=auto`
    const forecast = await fetch(forecastUrl).then((res) => res.json() as Promise<ForecastResponse>)
    const current = forecast.current
    if (!current) return null

    const summary = typeof current.weather_code === 'number'
      ? (WEATHER_CODE_MAP[current.weather_code] ?? `Weather code ${current.weather_code}`)
      : 'Unknown weather'

    const resolvedLocation = [target.name, target.country].filter(Boolean).join(', ') || location

    return {
      location: resolvedLocation,
      summary,
      temperatureC: typeof current.temperature_2m === 'number' ? current.temperature_2m : null,
      observedAt: new Date().toISOString(),
      source: 'open-meteo',
    }
  } catch {
    return null
  }
}
