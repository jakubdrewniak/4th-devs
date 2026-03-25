import { places } from '../data/places.js';
import type { Place, ToolDefinition } from '../types.js';

const scorePlace = (place: Place, query: string): number => {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const haystack = [
    place.name,
    place.address,
    place.description,
    place.type,
    ...place.tags,
  ]
    .join(' ')
    .toLowerCase();

  if (haystack.includes(q)) return 100;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 10 : score), 0);
};

export const placeTools: ToolDefinition[] = [
  {
    name: 'search_places',
    description: 'Search places by name, tags, area, and description.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query, e.g. "Italian near office"' },
        type: {
          type: 'string',
          enum: ['office', 'restaurant', 'cafe', 'coworking', 'home', 'mall'],
          description: 'Optional place type filter',
        },
        limit: { type: 'number', description: 'Maximum number of places to return (default 5)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (typeof args.query !== 'string' || args.query.trim().length === 0) {
        return { error: 'query is required and must be a non-empty string' };
      }

      const query = args.query;
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : 5;
      const typeFilter = typeof args.type === 'string' ? args.type : undefined;

      const ranked = places
        .filter((place) => (typeFilter ? place.type === typeFilter : true))
        .map((place) => ({ place, score: scorePlace(place, query) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ place }) => place);

      return { total: ranked.length, places: ranked };
    },
  },
  {
    name: 'get_place',
    description: 'Get full place details by place ID.',
    parameters: {
      type: 'object',
      properties: {
        place_id: { type: 'string', description: 'Place ID, e.g. p-trattoria' },
      },
      required: ['place_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (typeof args.place_id !== 'string') {
        return { error: 'place_id is required and must be a string' };
      }

      const place = places.find((item) => item.id === args.place_id);
      if (!place) return { error: `Place not found: ${args.place_id}` };
      return place;
    },
  },
];
