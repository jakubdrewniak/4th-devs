import { findRoute } from '../data/routes.js';
import { places } from '../data/places.js';
import type { ToolDefinition } from '../types.js';

export const mapTools: ToolDefinition[] = [
  {
    name: 'get_route',
    description: 'Get travel options between two place IDs (walking, driving, and optional transit).',
    parameters: {
      type: 'object',
      properties: {
        from_place_id: { type: 'string', description: 'Route origin place ID' },
        to_place_id: { type: 'string', description: 'Route destination place ID' },
      },
      required: ['from_place_id', 'to_place_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (typeof args.from_place_id !== 'string' || typeof args.to_place_id !== 'string') {
        return { error: 'from_place_id and to_place_id must be strings' };
      }

      const fromPlace = places.find((place) => place.id === args.from_place_id);
      const toPlace = places.find((place) => place.id === args.to_place_id);
      if (!fromPlace) return { error: `Unknown from_place_id: ${args.from_place_id}` };
      if (!toPlace) return { error: `Unknown to_place_id: ${args.to_place_id}` };

      const route = findRoute(args.from_place_id, args.to_place_id);
      if (!route) {
        return {
          error: `Route not found between ${args.from_place_id} and ${args.to_place_id}`,
        };
      }

      const travel = [
        { mode: 'walking', durationMin: route.walking.durationMin },
        { mode: 'driving', durationMin: route.driving.durationMin },
        ...(route.transit ? [{ mode: 'transit', durationMin: route.transit.durationMin }] : []),
      ] as const;

      const fastest = [...travel].sort((a, b) => a.durationMin - b.durationMin)[0];

      return {
        from: { id: fromPlace.id, name: fromPlace.name },
        to: { id: toPlace.id, name: toPlace.name },
        options: {
          walking: route.walking,
          driving: route.driving,
          transit: route.transit ?? null,
        },
        fastest_mode: fastest.mode,
        fastest_duration_min: fastest.durationMin,
      };
    },
  },
];
