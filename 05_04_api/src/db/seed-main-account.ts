import { loadConfig } from '../app/config'
import { loadEnvFileIntoProcess } from '../app/load-env'
import { closeAppRuntime, createAppRuntime, initializeAppRuntime } from '../app/runtime'
import { seedMainAccount } from './seeds/seed-main-account'

loadEnvFileIntoProcess()

const formatSeedInstructions = (seedResult: ReturnType<typeof seedMainAccount>): string =>
  [
    'Seeded main account.',
    `email: ${seedResult.accountEmail}`,
    `account id: ${seedResult.accountId}`,
    `tenant id: ${seedResult.tenantId}`,
    `tenant role: ${seedResult.tenantRole}`,
    `api key id: ${seedResult.apiKeyId}`,
    `secret source: ${seedResult.secretSource}`,
    `credentials manifest: ${seedResult.manifestPath}`,
    'Secrets are stored in the manifest and are not printed to stdout.',
  ].join('\n')

const main = async () => {
  const config = loadConfig()
  const runtime = await initializeAppRuntime(createAppRuntime(config))

  try {
    const seedResult = seedMainAccount(runtime)

    console.info(formatSeedInstructions(seedResult))
  } finally {
    await closeAppRuntime(runtime)
  }
}

await main()
