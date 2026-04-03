import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { UnifiedConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { redactSensitiveData } from '../utils/security.js';

/**
 * Create config resource with provided configuration.
 * Allows runtime config injection for both Node and Workers.
 */
export function createConfigResource(config: UnifiedConfig) {
  return {
    uri: 'config://server',
    name: 'Server Configuration',
    description: 'Current server configuration (sensitive data redacted)',
    mimeType: 'application/json',

    handler: async (): Promise<ReadResourceResult> => {
      logger.debug('config_resource', { message: 'Server configuration requested' });

      // Redact sensitive configuration data
      const safeConfig = redactSensitiveData(config as Record<string, unknown>);

      return {
        contents: [
          {
            uri: 'config://server',
            mimeType: 'application/json',
            text: JSON.stringify(safeConfig, null, 2),
          },
        ],
      };
    },
  };
}

// For backward compatibility with Node.js where config is available at import time
export const configResource = {
  uri: 'config://server',
  name: 'Server Configuration',
  description: 'Current server configuration (sensitive data redacted)',
  mimeType: 'application/json',
  handler: async (): Promise<ReadResourceResult> => {
    throw new Error('Use createConfigResource(config) to initialize this resource');
  },
};
