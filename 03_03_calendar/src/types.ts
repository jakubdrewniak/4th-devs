export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  company?: string;
  role?: string;
  relationship: 'colleague' | 'client' | 'friend' | 'investor' | 'freelancer';
  preferences?: string[];
  notes?: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Place {
  id: string;
  name: string;
  type: 'office' | 'restaurant' | 'cafe' | 'coworking' | 'home' | 'mall';
  address: string;
  coordinates: Coordinates;
  openingHours?: Record<string, string>;
  tags: string[];
  phone?: string;
  website?: string;
  description: string;
}

export type TravelMode = 'walking' | 'driving' | 'transit';

export interface TravelOption {
  durationMin: number;
  distanceKm: number;
  description?: string;
}

export interface Route {
  from: string;
  to: string;
  walking: TravelOption;
  driving: TravelOption;
  transit?: TravelOption & { line: string; stops: number };
}

export type WeatherCondition = 'sunny' | 'cloudy' | 'rainy' | 'partly_cloudy' | 'clear';

export interface WeatherSlot {
  date: string;
  hour: number;
  tempC: number;
  condition: WeatherCondition;
  windKmh: number;
  precipMm: number;
  description: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  locationId?: string;
  locationName?: string;
  address?: string;
  guests: CalendarGuest[];
  description?: string;
  isVirtual: boolean;
  meetingLink?: string;
}

export interface CalendarGuest {
  name: string;
  email: string;
  status: 'pending' | 'accepted' | 'declined';
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchEntry {
  keywords: string[];
  results: WebSearchResult[];
}

export interface EnvironmentState {
  currentTime: string;
  userLocation: {
    placeId: string;
    name: string;
    coordinates: Coordinates;
  };
}

export interface AddScenarioStep {
  id: string;
  at: string;
  locationId: string;
  message: string;
}

export interface NotificationWebhook {
  id: string;
  at: string;
  locationId: string;
  payload: {
    type: 'event.upcoming';
    eventTitle: string;
    startsAt: string;
    minutesUntilStart: number;
  };
}

export interface NotificationRecord {
  id: string;
  createdAt: string;
  channel: 'push' | 'sms' | 'email';
  title: string;
  message: string;
  eventId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}
