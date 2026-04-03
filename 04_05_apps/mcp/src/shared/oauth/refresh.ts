/**
 * Proactive token refresh utilities using oauth4webapi.
 *
 * This module provides token refresh functionality that can be used
 * during tool execution to ensure tokens are fresh before making API calls.
 */

import * as oauth from 'oauth4webapi';
import type { ProviderTokens, TokenStore } from '../storage/interface.js';
import { sharedLogger as logger } from '../utils/logger.js';

/** Provider configuration for token refresh */
export interface ProviderRefreshConfig {
  clientId: string;
  clientSecret: string;
  accountsUrl: string;
  tokenEndpointPath?: string;
}

/**
 * Build provider refresh config from unified config.
 * Returns undefined if required fields are missing.
 */
export function buildProviderRefreshConfig(config: {
  PROVIDER_CLIENT_ID?: string;
  PROVIDER_CLIENT_SECRET?: string;
  PROVIDER_ACCOUNTS_URL?: string;
  OAUTH_TOKEN_URL?: string;
}): ProviderRefreshConfig | undefined {
  if (
    !config.PROVIDER_CLIENT_ID ||
    !config.PROVIDER_CLIENT_SECRET ||
    !config.PROVIDER_ACCOUNTS_URL
  ) {
    return undefined;
  }
  return {
    clientId: config.PROVIDER_CLIENT_ID,
    clientSecret: config.PROVIDER_CLIENT_SECRET,
    accountsUrl: config.PROVIDER_ACCOUNTS_URL,
    tokenEndpointPath: config.OAUTH_TOKEN_URL,
  };
}

/** Token refresh result */
export interface RefreshResult {
  success: boolean;
  tokens?: ProviderTokens;
  error?: string;
}

/**
 * Build an oauth4webapi AuthorizationServer object from provider config.
 */
function buildAuthorizationServer(
  config: ProviderRefreshConfig,
): oauth.AuthorizationServer {
  const tokenEndpoint = config.tokenEndpointPath || '/token';

  return {
    issuer: config.accountsUrl,
    token_endpoint: new URL(tokenEndpoint, config.accountsUrl).toString(),
  };
}

/**
 * Refresh provider token using refresh_token grant via oauth4webapi.
 *
 * @param refreshToken - The provider refresh token
 * @param config - Provider configuration
 * @returns New provider tokens or error
 */
export async function refreshProviderToken(
  refreshToken: string,
  config: ProviderRefreshConfig,
): Promise<RefreshResult> {
  const authServer = buildAuthorizationServer(config);
  const client: oauth.Client = {
    client_id: config.clientId,
    token_endpoint_auth_method: 'client_secret_basic',
  };

  logger.debug('oauth_refresh', {
    message: 'Refreshing provider token',
    tokenUrl: authServer.token_endpoint,
  });

  try {
    const clientAuth = oauth.ClientSecretBasic(config.clientSecret);

    const response = await oauth.refreshTokenGrantRequest(
      authServer,
      client,
      clientAuth,
      refreshToken,
    );

    // processRefreshTokenResponse throws ResponseBodyError on OAuth errors
    const result = await oauth.processRefreshTokenResponse(
      authServer,
      client,
      response,
    );

    const accessToken = result.access_token;
    if (!accessToken) {
      return {
        success: false,
        error: 'No access_token in provider response',
      };
    }

    logger.info('oauth_refresh', {
      message: 'Provider token refreshed',
      hasNewRefreshToken: !!result.refresh_token,
    });

    return {
      success: true,
      tokens: {
        access_token: accessToken,
        // Some providers don't rotate refresh tokens
        refresh_token: result.refresh_token ?? refreshToken,
        expires_at: Date.now() + (result.expires_in ?? 3600) * 1000,
        scopes: (result.scope || '').split(/\s+/).filter(Boolean),
      },
    };
  } catch (error) {
    // Handle OAuth2 protocol errors from oauth4webapi
    if (error instanceof oauth.ResponseBodyError) {
      logger.error('oauth_refresh', {
        message: 'Provider refresh failed',
        error: error.error,
        description: error.error_description,
      });
      return {
        success: false,
        error:
          `Provider returned ${error.error}: ${error.error_description || ''}`.trim(),
      };
    }

    logger.error('oauth_refresh', {
      message: 'Token refresh network error',
      error: (error as Error).message,
    });
    return {
      success: false,
      error: `Network error: ${(error as Error).message}`,
    };
  }
}

/** Token expiry check thresholds */
const EXPIRY_BUFFER_MS = 60_000; // 1 minute buffer

/**
 * Refresh throttle to prevent redundant refreshes.
 *
 * NOTE: This throttle is in-memory and works effectively in Node.js.
 * In Cloudflare Workers, each isolate has its own instance, so concurrent
 * requests may trigger multiple refreshes. This is acceptable because:
 * 1. Refreshes are idempotent (same result regardless of how many times)
 * 2. KV eventually consistent - multiple writes resolve to same state
 * 3. The cost is just extra provider API calls, not data corruption
 */
const REFRESH_COOLDOWN_MS = 30_000; // 30 seconds
const recentlyRefreshed = new Map<string, number>();

/**
 * Check if a token was recently refreshed (throttle).
 * Prevents concurrent/repeated refreshes within the same process.
 */
function shouldSkipRefresh(rsToken: string): boolean {
  const lastRefresh = recentlyRefreshed.get(rsToken);
  if (lastRefresh && Date.now() - lastRefresh < REFRESH_COOLDOWN_MS) {
    return true;
  }
  return false;
}

/**
 * Mark a token as recently refreshed (only call on SUCCESS).
 */
function markRefreshed(rsToken: string): void {
  recentlyRefreshed.set(rsToken, Date.now());
  // Cleanup old entries to prevent memory leak
  if (recentlyRefreshed.size > 1000) {
    const now = Date.now();
    for (const [key, timestamp] of recentlyRefreshed) {
      if (now - timestamp > REFRESH_COOLDOWN_MS) {
        recentlyRefreshed.delete(key);
      }
    }
  }
}

/**
 * Check if a token is expired or will expire soon.
 *
 * @param expiresAt - Token expiry timestamp (ms)
 * @param bufferMs - Buffer time before expiry to consider "near expiry"
 * @returns true if token is expired or expiring within buffer
 */
export function isTokenExpiredOrExpiring(
  expiresAt: number | undefined,
  bufferMs = EXPIRY_BUFFER_MS,
): boolean {
  if (!expiresAt) return false; // No expiry = assume valid
  return Date.now() >= expiresAt - bufferMs;
}

/**
 * Proactively refresh token if near expiry.
 *
 * This should be called before tool execution to ensure fresh tokens.
 * Updates the token store with new tokens if refresh succeeds.
 *
 * @param rsAccessToken - The RS access token to check
 * @param tokenStore - Token storage
 * @param providerConfig - Provider configuration for refresh
 * @returns Refreshed provider access token, or original if refresh not needed/failed
 */
export async function ensureFreshToken(
  rsAccessToken: string,
  tokenStore: TokenStore,
  providerConfig: ProviderRefreshConfig | undefined,
): Promise<{ accessToken: string; wasRefreshed: boolean }> {
  const record = await tokenStore.getByRsAccess(rsAccessToken);

  if (!record?.provider?.access_token) {
    return { accessToken: '', wasRefreshed: false };
  }

  // Check if token is near expiry
  if (!isTokenExpiredOrExpiring(record.provider.expires_at)) {
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }

  // Throttle: skip if this token was recently refreshed (within same process)
  // This is a best-effort optimization; in Workers it won't prevent cross-isolate refreshes
  if (shouldSkipRefresh(rsAccessToken)) {
    logger.debug('oauth_refresh', {
      message: 'Token refresh throttled (recently refreshed in this process)',
    });
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }

  logger.info('oauth_refresh', {
    message: 'Token near expiry, attempting refresh',
    expiresAt: record.provider.expires_at,
    now: Date.now(),
  });

  // Need refresh - check we have what we need
  if (!record.provider.refresh_token) {
    logger.warning('oauth_refresh', {
      message: 'Token near expiry but no refresh token available',
    });
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }

  if (!providerConfig) {
    logger.warning('oauth_refresh', {
      message: 'Token near expiry but no provider config for refresh',
    });
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }

  // Attempt refresh using oauth4webapi
  const result = await refreshProviderToken(
    record.provider.refresh_token,
    providerConfig,
  );

  if (!result.success || !result.tokens) {
    logger.error('oauth_refresh', {
      message: 'Token refresh failed, using existing token',
      error: result.error,
    });
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }

  // Determine if RS access token should rotate
  // Only rotate when provider refresh_token changed (security trade-off for KV quota)
  const providerRefreshRotated =
    result.tokens.refresh_token !== record.provider.refresh_token;
  const newRsAccess = providerRefreshRotated ? undefined : record.rs_access_token;

  // Update token store with new tokens
  try {
    await tokenStore.updateByRsRefresh(
      record.rs_refresh_token,
      result.tokens,
      newRsAccess,
    );

    // Mark as refreshed ONLY on success (prevents redundant refreshes in same process)
    markRefreshed(rsAccessToken);

    logger.info('oauth_refresh', {
      message: 'Token store updated with refreshed tokens',
      rsAccessRotated: providerRefreshRotated,
    });

    return { accessToken: result.tokens.access_token, wasRefreshed: true };
  } catch (error) {
    logger.error('oauth_refresh', {
      message: 'Failed to update token store',
      error: (error as Error).message,
    });
    // Return new token even if store update failed - better than failing the request
    return { accessToken: result.tokens.access_token, wasRefreshed: true };
  }
}
