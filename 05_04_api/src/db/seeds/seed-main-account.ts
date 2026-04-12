import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import type { AppRuntime } from '../../app/runtime'
import { hashApiKeySecret } from '../../shared/api-key'
import {
  type AccountId,
  type ApiKeyId,
  asAccountId,
  asApiKeyId,
  asTenantId,
  asToolProfileId,
  createPrefixedId,
  type TenantId,
} from '../../shared/ids'
import { hashPassword, normalizeAuthEmail } from '../../shared/password'
import type { TenantRole } from '../../shared/scope'
import {
  accountPreferences,
  accounts,
  apiKeys,
  passwordCredentials,
  tenantMemberships,
  tenants,
  toolProfiles,
} from '../schema'
import { withTransaction } from '../transaction'

const legacyMainAccountSeedManifestSchema = z.object({
  apiKeySecret: z.string().min(1),
  password: z.string().min(8),
  version: z.literal(2),
})

const mainAccountSeedManifestSchema = z.object({
  accountId: z.string().min(1),
  apiKeyId: z.string().min(1),
  apiKeySecret: z.string().min(1),
  password: z.string().min(8),
  tenantId: z.string().min(1),
  tenantMembershipId: z.string().min(1),
  version: z.literal(3),
})

const anyMainAccountSeedManifestSchema = z.union([
  legacyMainAccountSeedManifestSchema,
  mainAccountSeedManifestSchema,
])

type MainAccountSeedManifest = z.infer<typeof mainAccountSeedManifestSchema>
type AnyMainAccountSeedManifest = z.infer<typeof anyMainAccountSeedManifestSchema>

const isCurrentMainAccountSeedManifest = (
  manifest: AnyMainAccountSeedManifest,
): manifest is MainAccountSeedManifest => manifest.version === 3

const defaultMainAccountSeedInput = {
  accountEmail: 'main@local.test',
  accountName: 'Main Account',
  apiKeyLabel: 'Main local key',
  tenantName: 'Local Workspace',
  tenantRole: 'owner' as TenantRole,
  tenantSlug: 'local-workspace',
}

type MainAccountSeedSecretSource = 'existing' | 'generated'

export interface SeedMainAccountInput {
  accountEmail?: string
  accountId?: AccountId
  accountName?: string
  apiKeyId?: ApiKeyId
  apiKeyLabel?: string
  tenantId?: TenantId
  tenantMembershipId?: string
  tenantName?: string
  tenantRole?: TenantRole
  tenantSlug?: string
}

export interface MainAccountSeedResult {
  accountEmail: string
  accountId: AccountId
  accountPassword: string
  apiKeyId: ApiKeyId
  apiKeySecret: string
  manifestPath: string
  secretSource: MainAccountSeedSecretSource
  tenantId: TenantId
  tenantRole: TenantRole
}

const createMainAccountApiKeySecret = (): string => `sk_local_${randomBytes(24).toString('hex')}`

const createMainAccountPassword = (): string => `pw_local_${randomBytes(16).toString('hex')}`

const createGeneratedSeedIds = () => ({
  accountId: asAccountId(createPrefixedId('acc')),
  apiKeyId: asApiKeyId(createPrefixedId('key')),
  tenantId: asTenantId(createPrefixedId('ten')),
  tenantMembershipId: createPrefixedId('mem'),
})

const createAssistantToolProfileId = (accountId: AccountId) =>
  asToolProfileId(`tpf_assistant_${accountId.slice(4)}`)

const resolveMainAccountSeedManifestPath = (databasePath: string): string =>
  join(dirname(databasePath), 'main-account-seed.json')

const readMainAccountSeedManifest = (manifestPath: string) => {
  if (!existsSync(manifestPath)) {
    return null
  }

  const manifestContent = readFileSync(manifestPath, 'utf8')

  return anyMainAccountSeedManifestSchema.parse(JSON.parse(manifestContent))
}

const writeMainAccountSeedManifest = (
  manifestPath: string,
  input: {
    accountId: AccountId
    apiKeyId: ApiKeyId
    apiKeySecret: string
    password: string
    tenantId: TenantId
    tenantMembershipId: string
  },
): void => {
  mkdirSync(dirname(manifestPath), { recursive: true })

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        accountId: input.accountId,
        apiKeyId: input.apiKeyId,
        apiKeySecret: input.apiKeySecret,
        password: input.password,
        tenantId: input.tenantId,
        tenantMembershipId: input.tenantMembershipId,
        version: 3,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

const resolveMainAccountApiKeySecret = (manifestPath: string) => {
  const existingManifest = readMainAccountSeedManifest(manifestPath)

  if (existingManifest) {
    return {
      apiKeySecret: existingManifest.apiKeySecret,
      password: existingManifest.password,
      secretSource: 'existing' as const,
    }
  }

  const apiKeySecret = createMainAccountApiKeySecret()
  const password = createMainAccountPassword()

  return {
    apiKeySecret,
    password,
    secretSource: 'generated' as const,
  }
}

const resolveMainAccountSeedInput = (
  input: SeedMainAccountInput,
  manifestPath: string,
): Required<SeedMainAccountInput> => {
  const existingManifest = readMainAccountSeedManifest(manifestPath)

  const resolvedIds =
    input.accountId && input.apiKeyId && input.tenantId && input.tenantMembershipId
      ? {
          accountId: input.accountId,
          apiKeyId: input.apiKeyId,
          tenantId: input.tenantId,
          tenantMembershipId: input.tenantMembershipId,
        }
      : existingManifest && isCurrentMainAccountSeedManifest(existingManifest)
        ? {
            accountId: asAccountId(existingManifest.accountId),
            apiKeyId: asApiKeyId(existingManifest.apiKeyId),
            tenantId: asTenantId(existingManifest.tenantId),
            tenantMembershipId: existingManifest.tenantMembershipId,
          }
        : createGeneratedSeedIds()

  return {
    ...defaultMainAccountSeedInput,
    ...resolvedIds,
    ...input,
  }
}

export const seedMainAccount = (
  runtime: AppRuntime,
  input: SeedMainAccountInput = {},
): MainAccountSeedResult => {
  const manifestPath = resolveMainAccountSeedManifestPath(runtime.config.database.path)
  const seedInput = resolveMainAccountSeedInput(input, manifestPath)
  const { apiKeySecret, password, secretSource } = resolveMainAccountApiKeySecret(manifestPath)
  const seededAt = runtime.services.clock.nowIso()
  const hashedSecret = hashApiKeySecret(apiKeySecret)
  const passwordHash = hashPassword(password)
  const assistantToolProfileId = createAssistantToolProfileId(seedInput.accountId)

  writeMainAccountSeedManifest(manifestPath, {
    accountId: seedInput.accountId,
    apiKeyId: seedInput.apiKeyId,
    apiKeySecret,
    password,
    tenantId: seedInput.tenantId,
    tenantMembershipId: seedInput.tenantMembershipId,
  })

  withTransaction(runtime.db, (tx) => {
    tx.insert(accounts)
      .values({
        createdAt: seededAt,
        email: normalizeAuthEmail(seedInput.accountEmail),
        id: seedInput.accountId,
        name: seedInput.accountName,
        preferences: null,
        updatedAt: seededAt,
      })
      .onConflictDoUpdate({
        set: {
          email: normalizeAuthEmail(seedInput.accountEmail),
          name: seedInput.accountName,
          preferences: null,
          updatedAt: seededAt,
        },
        target: accounts.id,
      })
      .run()

    tx.insert(tenants)
      .values({
        createdAt: seededAt,
        id: seedInput.tenantId,
        name: seedInput.tenantName,
        slug: seedInput.tenantSlug,
        status: 'active',
        updatedAt: seededAt,
      })
      .onConflictDoUpdate({
        set: {
          name: seedInput.tenantName,
          slug: seedInput.tenantSlug,
          status: 'active',
          updatedAt: seededAt,
        },
        target: tenants.id,
      })
      .run()

    tx.insert(tenantMemberships)
      .values({
        accountId: seedInput.accountId,
        createdAt: seededAt,
        id: seedInput.tenantMembershipId,
        role: seedInput.tenantRole,
        tenantId: seedInput.tenantId,
      })
      .onConflictDoUpdate({
        set: {
          role: seedInput.tenantRole,
        },
        target: [tenantMemberships.tenantId, tenantMemberships.accountId],
      })
      .run()

    tx.insert(apiKeys)
      .values({
        accountId: seedInput.accountId,
        createdAt: seededAt,
        expiresAt: null,
        hashedSecret,
        id: seedInput.apiKeyId,
        label: seedInput.apiKeyLabel,
        lastFour: apiKeySecret.slice(-4),
        lastUsedAt: null,
        revokedAt: null,
        scopeJson: null,
        status: 'active',
      })
      .onConflictDoUpdate({
        set: {
          accountId: seedInput.accountId,
          expiresAt: null,
          hashedSecret,
          label: seedInput.apiKeyLabel,
          lastFour: apiKeySecret.slice(-4),
          lastUsedAt: null,
          revokedAt: null,
          scopeJson: null,
          status: 'active',
        },
        target: apiKeys.id,
      })
      .run()

    tx.insert(passwordCredentials)
      .values({
        accountId: seedInput.accountId,
        createdAt: seededAt,
        passwordHash,
        updatedAt: seededAt,
      })
      .onConflictDoUpdate({
        set: {
          passwordHash,
          updatedAt: seededAt,
        },
        target: passwordCredentials.accountId,
      })
      .run()

    tx.insert(toolProfiles)
      .values({
        accountId: seedInput.accountId,
        createdAt: seededAt,
        id: assistantToolProfileId,
        name: 'Assistant Default',
        scope: 'account_private',
        status: 'active',
        tenantId: seedInput.tenantId,
        updatedAt: seededAt,
      })
      .onConflictDoUpdate({
        set: {
          accountId: seedInput.accountId,
          name: 'Assistant Default',
          scope: 'account_private',
          status: 'active',
          updatedAt: seededAt,
        },
        target: toolProfiles.id,
      })
      .run()

    tx.insert(accountPreferences)
      .values({
        accountId: seedInput.accountId,
        assistantToolProfileId,
        defaultAgentId: null,
        defaultTargetKind: 'assistant',
        tenantId: seedInput.tenantId,
        updatedAt: seededAt,
      })
      .onConflictDoUpdate({
        set: {
          assistantToolProfileId,
          defaultAgentId: null,
          defaultTargetKind: 'assistant',
          updatedAt: seededAt,
        },
        target: [accountPreferences.tenantId, accountPreferences.accountId],
      })
      .run()
  })

  return {
    accountEmail: seedInput.accountEmail,
    accountId: seedInput.accountId,
    accountPassword: password,
    apiKeyId: seedInput.apiKeyId,
    apiKeySecret,
    manifestPath,
    secretSource,
    tenantId: seedInput.tenantId,
    tenantRole: seedInput.tenantRole,
  }
}
