import { Hono } from 'hono'

import type { AppConfig } from '../../../app/config'
import type { AppEnv } from '../../../app/types'

export const createRootRoutes = (config: AppConfig): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/', (c) => {
    return c.json({
      docs: {
        api: config.api.basePath,
        health: `${config.api.basePath}/system/health`,
        ready: `${config.api.basePath}/system/ready`,
      },
      name: config.app.name,
      status: 'ok',
    })
  })

  return routes
}
