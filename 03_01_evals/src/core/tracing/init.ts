import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'
import type { Logger } from '../logger.js'

interface TracingConfig {
  enabled?: boolean
  logger?: Logger
  serviceName?: string
}

let sdk: NodeSDK | null = null
let spanProcessor: LangfuseSpanProcessor | null = null
let initialized = false
let tracingLogger: Logger | null = null

export const getTracingLogger = (): Logger | null => tracingLogger

export const logTrace = (
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  data?: Record<string, unknown>,
): void => {
  if (!tracingLogger) {
    return
  }

  tracingLogger[level](message, data)
}

export const initTracing = (config: TracingConfig = {}): void => {
  if (initialized) {
    config.logger?.warn('Tracing already initialized, skipping')
    return
  }

  const {
    enabled = true,
    logger,
    serviceName = '03_01_evals',
  } = config

  tracingLogger = logger?.child({ module: 'tracing' }) ?? null

  if (!enabled) {
    tracingLogger?.info('Tracing disabled')
    initialized = true
    return
  }

  const secretKey = process.env.LANGFUSE_SECRET_KEY
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY

  if (!secretKey || !publicKey) {
    tracingLogger?.warn('Langfuse credentials missing, tracing disabled', {
      hasSecretKey: !!secretKey,
      hasPublicKey: !!publicKey,
    })
    initialized = true
    return
  }

  try {
    spanProcessor = new LangfuseSpanProcessor()
    sdk = new NodeSDK({
      serviceName,
      spanProcessors: [spanProcessor],
      autoDetectResources: false,
    })

    sdk.start()
    initialized = true

    tracingLogger?.info('Tracing initialized', {
      serviceName,
      baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
    })
  } catch (error) {
    initialized = true
    tracingLogger?.error('Failed to initialize tracing', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export const flush = async (): Promise<void> => {
  try {
    await spanProcessor?.forceFlush()
  } catch {
    // best effort only
  }
}

export const shutdownTracing = async (): Promise<void> => {
  try {
    await sdk?.shutdown()
  } catch {
    // best effort only
  } finally {
    sdk = null
    spanProcessor = null
    initialized = false
  }
}

export const isTracingActive = (): boolean => initialized && spanProcessor !== null
