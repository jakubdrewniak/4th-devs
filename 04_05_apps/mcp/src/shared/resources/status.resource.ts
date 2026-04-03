import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { getServerWithInternals } from '../mcp/server-internals.js';
import { logger } from '../utils/logger.js';

/**
 * Dynamic status resource that changes over time.
 * Demonstrates resource subscriptions and update notifications.
 */

// Server status state
const serverStatus = {
  status: 'running' as 'running' | 'idle' | 'busy',
  uptime: 0,
  requestCount: 0,
  lastUpdated: new Date().toISOString(),
};

// Track update interval
let statusUpdateInterval: NodeJS.Timeout | null = null;

/**
 * Start status updates (for demonstration).
 * In production, this would track real server metrics.
 */
export function startStatusUpdates(server: McpServer): void {
  if (statusUpdateInterval) {
    return; // Already running
  }

  // Update status every 10 seconds
  statusUpdateInterval = setInterval(() => {
    // Simulate status changes
    serverStatus.uptime += 10;
    serverStatus.requestCount += Math.floor(Math.random() * 5);
    const statuses: Array<'running' | 'idle' | 'busy'> = ['running', 'idle', 'busy'];
    serverStatus.status = statuses[Math.floor(Math.random() * 3)];
    serverStatus.lastUpdated = new Date().toISOString();

    // Notify subscribers of the update
    try {
      getServerWithInternals(server).sendResourceUpdated?.({
        uri: 'status://server',
      });

      logger.debug('status_resource', {
        message: 'Status updated, notification sent',
        status: serverStatus.status,
        uptime: serverStatus.uptime,
      });
    } catch (error) {
      logger.error('status_resource', {
        message: 'Failed to send resource update notification',
        error: (error as Error).message,
      });
    }
  }, 10_000);

  logger.info('status_resource', {
    message: 'Status update notifications started (every 10s)',
  });
}

/**
 * Stop status updates.
 */
export function stopStatusUpdates(): void {
  if (statusUpdateInterval) {
    clearInterval(statusUpdateInterval);
    statusUpdateInterval = null;
    logger.info('status_resource', {
      message: 'Status update notifications stopped',
    });
  }
}

/**
 * Increment request count (call this from request handlers to track real metrics).
 */
export function incrementRequestCount(): void {
  serverStatus.requestCount++;
  serverStatus.lastUpdated = new Date().toISOString();
}

/**
 * Status resource handler.
 */
export const statusResource = {
  uri: 'status://server',
  name: 'Server Status',
  description:
    'Dynamic server status (subscribable resource with update notifications)',
  mimeType: 'application/json',

  handler: async (): Promise<ReadResourceResult> => {
    logger.debug('status_resource', { message: 'Server status requested' });

    const statusData = {
      ...serverStatus,
      timestamp: new Date().toISOString(),
    };

    return {
      contents: [
        {
          uri: 'status://server',
          mimeType: 'application/json',
          text: JSON.stringify(statusData, null, 2),
        },
      ],
    };
  },
};
