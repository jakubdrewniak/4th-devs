import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { errorEnvelope } from '../adapters/http/api-envelope'
import { apiKeyAuthMiddleware } from '../adapters/http/auth/api-key-auth-middleware'
import { authSessionAuthMiddleware } from '../adapters/http/auth/auth-session-auth-middleware'
import { createRootRoutes } from '../adapters/http/routes/root-routes'
import { createApiRoutes } from '../adapters/http/routes/v1/api-routes'
import { isDomainErrorException, toHttpStatus } from '../shared/errors'
import { accessLogMiddleware } from './middleware/access-log'
import { apiResponseMiddleware } from './middleware/api-response'
import { requestContextMiddleware } from './middleware/request-context'
import { requestSizeGuardMiddleware } from './middleware/request-size-guard'
import { runtimeContextMiddleware } from './middleware/runtime-context'
import type { AppEnv, AppRuntimeInput } from './types'

type DomainErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 502 | 504

const resolveCorsOrigin = (
  config: AppRuntimeInput['config'],
  origin: string,
): string | undefined => {
  if (config.api.cors.allowOrigins.includes('*')) {
    return '*'
  }

  if (!origin) {
    return undefined
  }

  return config.api.cors.allowOrigins.includes(origin) ? origin : undefined
}

export const createApp = (runtime: AppRuntimeInput): Hono<AppEnv> => {
  const app = new Hono<AppEnv>()
  const { config } = runtime
  const api = createApiRoutes(config)
  const apiPaths = [config.api.basePath, `${config.api.basePath}/*`]

  app.use('*', secureHeaders())
  app.use('*', runtimeContextMiddleware(runtime))
  app.use('*', requestContextMiddleware)
  app.use('*', authSessionAuthMiddleware(config))
  app.use('*', apiKeyAuthMiddleware(config))
  app.use(accessLogMiddleware())

  app.route('/', createRootRoutes(config))

  for (const path of apiPaths) {
    app.use(path, apiResponseMiddleware(config))
    app.use(path, requestSizeGuardMiddleware(config.api.maxRequestBodyBytes))
    app.use(
      path,
      cors({
        allowHeaders: config.api.cors.allowHeaders,
        allowMethods: config.api.cors.allowMethods,
        credentials: config.api.cors.allowCredentials,
        exposeHeaders: config.api.cors.exposeHeaders,
        maxAge: config.api.cors.maxAgeSeconds,
        origin: (origin) => resolveCorsOrigin(config, origin),
      }),
    )
    app.use(
      path,
      bodyLimit({
        maxSize: config.api.maxRequestBodyBytes,
        onError: (c) =>
          c.json(
            errorEnvelope(c, {
              message: 'Request body exceeds the configured limit',
              type: 'validation',
            }),
            413,
          ),
      }),
    )
  }

  app.route(config.api.basePath, api)

  app.notFound((c) => {
    if (c.req.path.startsWith(config.api.basePath)) {
      return c.json(
        errorEnvelope(c, {
          message: `Route ${c.req.path} was not found`,
          type: 'not_found',
        }),
        404,
      )
    }

    return c.json(
      {
        error: {
          code: 'not_found',
          message: `Route ${c.req.path} was not found`,
        },
      },
      404,
    )
  })

  app.onError((error, c) => {
    if (isDomainErrorException(error)) {
      return c.json(
        errorEnvelope(c, error.domainError),
        toHttpStatus(error.domainError) as DomainErrorStatus,
      )
    }

    c.get('services').logger.error('Unhandled request error', {
      message: error.message,
      requestId: c.get('requestId'),
      subsystem: 'http',
      traceId: c.get('traceId'),
    })

    return c.json(
      {
        error: {
          code: 'internal_error',
          message: config.app.env === 'production' ? 'Internal server error' : error.message,
        },
        meta: {
          requestId: c.get('requestId'),
          traceId: c.get('traceId'),
        },
        ok: false,
      },
      500,
    )
  })

  return app
}
