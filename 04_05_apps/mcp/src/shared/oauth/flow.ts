// Core OAuth flow logic using oauth4webapi
// Provider-agnostic version from Spotify MCP

import * as oauth from 'oauth4webapi';
import type { ProviderTokens, TokenStore } from '../storage/interface.js';
import {
  base64UrlDecodeJson,
  base64UrlEncode,
  base64UrlEncodeJson,
} from '../utils/base64.js';
import { sharedLogger as logger } from '../utils/logger.js';
import {
  type CimdConfig,
  type ClientMetadata,
  fetchClientMetadata,
  isClientIdUrl,
  validateRedirectUri,
} from './cimd.js';
import { refreshProviderToken } from './refresh.js';
import type {
  AuthorizeInput,
  AuthorizeResult,
  CallbackInput,
  CallbackResult,
  OAuthConfig,
  ProviderConfig,
  TokenInput,
  TokenResult,
} from './types.js';

/**
 * Generate a cryptographically secure opaque token.
 */
export function generateOpaqueToken(bytes = 32): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Build an oauth4webapi AuthorizationServer object from provider config.
 */
function buildAuthorizationServer(
  providerConfig: ProviderConfig,
): oauth.AuthorizationServer {
  const authEndpoint = providerConfig.authorizationEndpointPath || '/authorize';
  const tokenEndpoint = providerConfig.tokenEndpointPath || '/token';

  return {
    issuer: providerConfig.accountsUrl,
    authorization_endpoint: new URL(
      authEndpoint,
      providerConfig.accountsUrl,
    ).toString(),
    token_endpoint: new URL(tokenEndpoint, providerConfig.accountsUrl).toString(),
  };
}

/**
 * Build an oauth4webapi Client object from provider config.
 */
function buildOAuthClient(providerConfig: ProviderConfig): oauth.Client {
  return {
    client_id: providerConfig.clientId || '',
    token_endpoint_auth_method: 'client_secret_basic',
  };
}

function isAllowedRedirect(uri: string, config: OAuthConfig, isDev: boolean): boolean {
  try {
    const allowed = new Set(
      config.redirectAllowlist.concat([config.redirectUri]).filter(Boolean),
    );
    const url = new URL(uri);

    if (isDev) {
      const loopback = new Set(['localhost', '127.0.0.1', '::1']);
      if (loopback.has(url.hostname)) {
        return true;
      }
    }

    if (config.redirectAllowAll) {
      return true;
    }

    return (
      allowed.has(`${url.protocol}//${url.host}${url.pathname}`) || allowed.has(uri)
    );
  } catch {
    return false;
  }
}

/**
 * Handle authorization request - redirect to provider or issue dev code
 */
export async function handleAuthorize(
  input: AuthorizeInput,
  store: TokenStore,
  providerConfig: ProviderConfig,
  oauthConfig: OAuthConfig,
  options: {
    baseUrl: string;
    isDev: boolean;
    callbackPath?: string;
    /** CIMD configuration (SEP-991) */
    cimd?: CimdConfig & { enabled?: boolean };
  },
): Promise<AuthorizeResult> {
  if (!input.redirectUri) {
    throw new Error('invalid_request: redirect_uri is required');
  }
  if (!input.codeChallenge || input.codeChallengeMethod !== 'S256') {
    throw new Error(
      'invalid_request: PKCE code_challenge with S256 method is required',
    );
  }

  // CIMD: Validate URL-based client_id (SEP-991)
  let clientMetadata: ClientMetadata | null = null;
  const cimdEnabled = options.cimd?.enabled ?? true;

  if (input.clientId && isClientIdUrl(input.clientId)) {
    if (!cimdEnabled) {
      logger.warning('oauth_authorize', {
        message: 'CIMD client_id received but CIMD is disabled',
        clientId: input.clientId,
      });
      throw new Error('invalid_client: URL-based client_id not supported');
    }

    logger.debug('oauth_authorize', {
      message: 'CIMD client_id detected, fetching metadata',
      clientId: input.clientId,
    });

    const result = await fetchClientMetadata(input.clientId, {
      timeoutMs: options.cimd?.timeoutMs,
      maxBytes: options.cimd?.maxBytes,
      allowedDomains: options.cimd?.allowedDomains,
    });

    if (result.success === false) {
      logger.error('oauth_authorize', {
        message: 'CIMD metadata fetch failed',
        clientId: input.clientId,
        error: result.error,
      });
      throw new Error(`invalid_client: ${result.error}`);
    }

    clientMetadata = result.metadata;

    // Validate redirect_uri against metadata
    if (!validateRedirectUri(clientMetadata, input.redirectUri)) {
      logger.error('oauth_authorize', {
        message: 'redirect_uri not in client metadata',
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        allowedUris: clientMetadata.redirect_uris,
      });
      throw new Error('invalid_request: redirect_uri not registered for this client');
    }

    logger.info('oauth_authorize', {
      message: 'CIMD client validated',
      clientId: input.clientId,
      clientName: clientMetadata.client_name,
    });
  }

  const txnId = generateOpaqueToken(16);
  await store.saveTransaction(txnId, {
    codeChallenge: input.codeChallenge,
    state: input.state,
    createdAt: Date.now(),
    scope: input.requestedScope,
    sid: input.sid,
  });

  logger.debug('oauth_authorize', {
    message: 'Checking provider configuration',
    hasClientId: !!providerConfig.clientId,
    hasClientSecret: !!providerConfig.clientSecret,
  });

  // Production: redirect to provider
  if (providerConfig.clientId && providerConfig.clientSecret) {
    logger.info('oauth_authorize', {
      message: 'Using production flow - redirecting to provider',
    });

    const authServer = buildAuthorizationServer(providerConfig);
    const authorizationEndpoint = authServer.authorization_endpoint;
    if (!authorizationEndpoint) {
      throw new Error('Authorization endpoint not configured');
    }
    const authUrl = new URL(authorizationEndpoint);

    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', providerConfig.clientId);

    const callbackPath = options.callbackPath || '/oauth/callback';
    const cb = new URL(callbackPath, options.baseUrl).toString();
    authUrl.searchParams.set('redirect_uri', cb);

    const scopeToUse = providerConfig.oauthScopes || input.requestedScope || '';
    if (scopeToUse) {
      authUrl.searchParams.set('scope', scopeToUse);
    }

    const compositeState =
      base64UrlEncodeJson({
        tid: txnId,
        cs: input.state,
        cr: input.redirectUri,
        sid: input.sid,
      }) || txnId;

    authUrl.searchParams.set('state', compositeState);

    // Apply extra auth params (e.g., access_type=offline&prompt=consent for Google)
    if (providerConfig.extraAuthParams) {
      const extraParams = new URLSearchParams(providerConfig.extraAuthParams);
      for (const [key, value] of extraParams) {
        authUrl.searchParams.set(key, value);
      }
    }

    logger.debug('oauth_authorize', {
      message: 'Redirect URL constructed',
      url: authUrl.origin + authUrl.pathname,
      hasExtraParams: !!providerConfig.extraAuthParams,
    });

    return {
      redirectTo: authUrl.toString(),
      txnId,
    };
  }

  logger.warning('oauth_authorize', {
    message: 'Missing provider credentials - using dev shortcut',
  });

  // Dev-only shortcut: immediately redirect with code
  const code = generateOpaqueToken(16);
  await store.saveCode(code, txnId);

  const safe = isAllowedRedirect(input.redirectUri, oauthConfig, options.isDev)
    ? input.redirectUri
    : oauthConfig.redirectUri;

  const redirect = new URL(safe);
  redirect.searchParams.set('code', code);
  if (input.state) {
    redirect.searchParams.set('state', input.state);
  }

  return {
    redirectTo: redirect.toString(),
    txnId,
  };
}

/**
 * Handle provider callback - exchange code for tokens using oauth4webapi
 */
export async function handleProviderCallback(
  input: CallbackInput,
  store: TokenStore,
  providerConfig: ProviderConfig,
  oauthConfig: OAuthConfig,
  options: {
    baseUrl: string;
    isDev: boolean;
    callbackPath?: string;
  },
): Promise<CallbackResult> {
  const decoded =
    base64UrlDecodeJson<{
      tid?: string;
      cs?: string;
      cr?: string;
      sid?: string;
    }>(input.compositeState) || {};

  const txnId = decoded.tid || input.compositeState;
  const txn = await store.getTransaction(txnId);

  if (!txn) {
    logger.error('oauth_callback', {
      message: 'Transaction not found',
      txnId,
    });
    throw new Error('unknown_txn');
  }

  const callbackPath = options.callbackPath || '/oauth/callback';
  const redirectUri = new URL(callbackPath, options.baseUrl).toString();

  const authServer = buildAuthorizationServer(providerConfig);
  const client = buildOAuthClient(providerConfig);

  logger.debug('oauth_callback', {
    message: 'Exchanging code for tokens',
    tokenUrl: authServer.token_endpoint,
  });

  // Build callback parameters with the authorization code
  const callbackParams = new URLSearchParams();
  callbackParams.set('code', input.providerCode);

  // Create client authentication (Basic auth)
  const clientAuth = oauth.ClientSecretBasic(providerConfig.clientSecret || '');

  try {
    // Use oauth4webapi for the token exchange
    const response = await oauth.authorizationCodeGrantRequest(
      authServer,
      client,
      clientAuth,
      callbackParams,
      redirectUri,
      oauth.nopkce, // We don't use PKCE with provider, only with our clients
    );

    logger.debug('oauth_callback', {
      message: 'Token response received',
      status: response.status,
    });

    // Process the response - throws ResponseBodyError on OAuth errors
    const result = await oauth.processAuthorizationCodeResponse(
      authServer,
      client,
      response,
    );

    const accessToken = result.access_token;
    if (!accessToken) {
      logger.error('oauth_callback', {
        message: 'No access token in provider response',
      });
      throw new Error('provider_no_token');
    }

    const expiresIn = result.expires_in ?? 3600;
    const expiresAt = Date.now() + expiresIn * 1000;
    const scopes = (result.scope || '').split(/\s+/).filter(Boolean);

    const providerTokens: ProviderTokens = {
      access_token: accessToken,
      refresh_token: result.refresh_token,
      expires_at: expiresAt,
      scopes,
    };

    logger.info('oauth_callback', {
      message: 'Provider tokens received',
      hasRefreshToken: !!result.refresh_token,
      expiresIn,
    });

    // Update transaction with provider tokens
    txn.provider = providerTokens;
    await store.saveTransaction(txnId, txn);

    // Issue RS code back to client
    const asCode = generateOpaqueToken(24);
    await store.saveCode(asCode, txnId);

    logger.debug('oauth_callback', {
      message: 'RS code generated',
    });

    const clientRedirect = decoded.cr || oauthConfig.redirectUri;
    const safe = isAllowedRedirect(clientRedirect, oauthConfig, options.isDev)
      ? clientRedirect
      : oauthConfig.redirectUri;

    const redirect = new URL(safe);
    redirect.searchParams.set('code', asCode);
    if (decoded.cs) {
      redirect.searchParams.set('state', decoded.cs);
    }

    return {
      redirectTo: redirect.toString(),
      txnId,
      providerTokens,
    };
  } catch (error) {
    // Handle OAuth2 protocol errors from oauth4webapi
    if (error instanceof oauth.ResponseBodyError) {
      logger.error('oauth_callback', {
        message: 'Provider token error',
        error: error.error,
        description: error.error_description,
      });
      throw new Error(
        `provider_token_error: ${error.error} ${error.error_description || ''}`.trim(),
      );
    }

    logger.error('oauth_callback', {
      message: 'Token fetch failed',
      error: (error as Error).message,
    });
    throw new Error(`fetch_failed: ${(error as Error).message}`);
  }
}

/**
 * Handle token exchange (authorization_code or refresh_token grant)
 */
export async function handleToken(
  input: TokenInput,
  store: TokenStore,
  providerConfig?: ProviderConfig,
): Promise<TokenResult> {
  if (input.grant === 'refresh_token') {
    logger.debug('oauth_token', {
      message: 'Processing refresh_token grant',
    });

    const rec = await store.getByRsRefresh(input.refreshToken);
    if (!rec) {
      logger.error('oauth_token', {
        message: 'Invalid refresh token',
      });
      throw new Error('invalid_grant');
    }

    // Check if provider token is expired or expiring soon (1 minute buffer)
    const now = Date.now();
    const providerExpiresAt = rec.provider.expires_at ?? 0;
    const isExpiringSoon = now >= providerExpiresAt - 60_000;

    let provider = rec.provider;

    if (isExpiringSoon && providerConfig) {
      logger.info('oauth_token', {
        message: 'Provider token expired/expiring, refreshing',
        expiresAt: providerExpiresAt,
        now,
      });

      if (!rec.provider.refresh_token) {
        logger.error('oauth_token', {
          message: 'No provider refresh token available',
        });
        throw new Error('provider_token_expired');
      }

      // Use the centralized refreshProviderToken from refresh.ts
      const refreshResult = await refreshProviderToken(rec.provider.refresh_token, {
        clientId: providerConfig.clientId || '',
        clientSecret: providerConfig.clientSecret || '',
        accountsUrl: providerConfig.accountsUrl,
        tokenEndpointPath: providerConfig.tokenEndpointPath,
      });

      if (!refreshResult.success || !refreshResult.tokens) {
        logger.error('oauth_token', {
          message: 'Provider refresh failed',
          error: refreshResult.error,
        });
        throw new Error('provider_refresh_failed');
      }

      provider = refreshResult.tokens;
    }

    // Conditional RS access token rotation:
    // Only rotate when provider refresh_token changed (security vs KV quota trade-off)
    const providerRefreshRotated =
      provider.refresh_token !== rec.provider.refresh_token;
    const newAccess = providerRefreshRotated ? generateOpaqueToken(24) : undefined;

    const updated = await store.updateByRsRefresh(
      input.refreshToken,
      provider,
      newAccess,
    );

    // Calculate expires_in based on provider token expiry
    const expiresIn = provider.expires_at
      ? Math.max(1, Math.floor((provider.expires_at - Date.now()) / 1000))
      : 3600;

    logger.info('oauth_token', {
      message: 'Token refreshed successfully',
      providerRefreshed: isExpiringSoon,
      rsAccessRotated: providerRefreshRotated,
    });

    return {
      access_token: newAccess ?? rec.rs_access_token,
      refresh_token: input.refreshToken,
      token_type: 'bearer',
      expires_in: expiresIn,
      scope: (updated?.provider.scopes || []).join(' '),
    };
  }

  // authorization_code grant
  logger.debug('oauth_token', {
    message: 'Processing authorization_code grant',
  });

  const txnId = await store.getTxnIdByCode(input.code);
  if (!txnId) {
    logger.error('oauth_token', {
      message: 'Authorization code not found',
    });
    throw new Error('invalid_grant');
  }

  const txn = await store.getTransaction(txnId);
  if (!txn) {
    logger.error('oauth_token', {
      message: 'Transaction not found for code',
    });
    throw new Error('invalid_grant');
  }

  // Verify PKCE using oauth4webapi
  const expected = txn.codeChallenge;
  const actual = await oauth.calculatePKCECodeChallenge(input.codeVerifier);
  if (expected !== actual) {
    logger.error('oauth_token', {
      message: 'PKCE verification failed',
    });
    throw new Error('invalid_grant');
  }

  // Mint RS tokens
  const rsAccess = generateOpaqueToken(24);
  const rsRefresh = generateOpaqueToken(24);

  logger.debug('oauth_token', {
    message: 'Minting RS tokens',
    hasProviderTokens: !!txn.provider?.access_token,
  });

  if (txn.provider?.access_token) {
    await store.storeRsMapping(rsAccess, txn.provider, rsRefresh);
    logger.info('oauth_token', {
      message: 'RS→Provider mapping stored',
    });
  } else {
    logger.warning('oauth_token', {
      message: 'No provider tokens in transaction - RS mapping not created',
    });
  }

  // Single-use code
  await store.deleteTransaction(txnId);
  await store.deleteCode(input.code);

  logger.info('oauth_token', {
    message: 'Token exchange completed',
  });

  return {
    access_token: rsAccess,
    refresh_token: rsRefresh,
    token_type: 'bearer',
    expires_in: 3600,
    scope: (txn.provider?.scopes || []).join(' ') || txn.scope || '',
  };
}
