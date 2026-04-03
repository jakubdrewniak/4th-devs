import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getServerWithInternals } from '../mcp/server-internals.js';
import { logger } from '../utils/logger.js';
import { paginateArray } from '../utils/pagination.js';
import { configResource } from './config.resource.js';
import { docsResource } from './docs.resource.js';
import { logoResource, logoSvgResource } from './logo.resource.js';
import { startStatusUpdates, statusResource } from './status.resource.js';

const resources = [
  configResource,
  docsResource,
  logoResource,
  logoSvgResource,
  statusResource,
];

export function registerResources(server: McpServer): void {
  // Register each resource individually using the high-level API
  for (const resource of resources) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
        annotations: {
          audience: ['user', 'assistant'],
          priority: 0.5,
          lastModified: new Date().toISOString(),
        },
      },
      resource.handler,
    );
  }

  // Add a ResourceTemplate example with completion and listing
  // URI format: example://items/{collection}/{id}
  const exampleTemplate = new ResourceTemplate('example://items/{collection}/{id}', {
    list: async () => {
      const items = [
        { collection: 'books', id: '1' },
        { collection: 'books', id: '2' },
        { collection: 'movies', id: '1' },
      ];
      const page = paginateArray(items, undefined, 100);
      return {
        resources: page.data.map(({ collection, id }) => ({
          uri: `example://items/${collection}/${id}`,
          name: `${collection}-${id}.json`,
          title: `${collection} ${id}`,
          mimeType: 'application/json',
          annotations: {
            audience: ['assistant'],
            priority: 0.6,
            lastModified: new Date().toISOString(),
          },
        })),
        nextCursor: page.nextCursor,
      };
    },
    complete: {
      collection: async (_value: string) => ['books', 'movies', 'music'],
      id: async (_value: string) => ['1', '2', '3'],
    },
  });

  server.registerResource(
    'example-items',
    exampleTemplate,
    {
      title: 'Example Items',
      description: 'Dynamic items accessible by collection and id',
      mimeType: 'application/json',
    },
    async (_uri, variables) => {
      const { collection, id } = variables as {
        collection: string;
        id: string;
      };
      return {
        contents: [
          {
            uri: `example://items/${collection}/${id}`,
            name: `${collection}-${id}.json`,
            title: `${collection} ${id}`,
            mimeType: 'application/json',
            text: JSON.stringify({ collection, id, ok: true }),
            annotations: {
              audience: ['assistant'],
              priority: 0.6,
              lastModified: new Date().toISOString(),
            },
          },
        ],
      };
    },
  );

  // Start status resource updates (for subscription notifications)
  startStatusUpdates(server);

  logger.info('resources', {
    message: `Registered ${resources.length} resources`,
    resourceUris: resources.map((r) => r.uri),
  });
}

/**
 * Emit resource update notification.
 * Per MCP spec, the notification only includes the URI.
 *
 * @param server - The MCP server instance
 * @param uri - The URI of the updated resource
 */
export function emitResourceUpdated(server: McpServer, uri: string): void {
  try {
    getServerWithInternals(server).sendResourceUpdated?.({ uri });
  } catch (error) {
    console.warn('Failed to send resource updated notification:', error);
  }
  logger.debug('resources', {
    message: 'Resource updated notification sent',
    uri,
  });
}

// Emit listChanged when resources are updated
export function emitResourcesListChanged(server: McpServer): void {
  server.sendResourceListChanged();
  logger.debug('resources', {
    message: 'Resources list changed notification sent',
  });
}
