# 05_04_api Local Seed

The local dev database was reset and reseeded on `2026-04-01`.

## Current Seeded Account

- email: `main@local.test`
- password: `pw_local_941f4f48bb6ee916d94ff4f286a284fa`
- account id: `acc_fed69f97c4a64f5b9154b90014e75a6b`
- tenant id: `ten_7994f103f2254a8d862dd9ba1389ebda`
- tenant membership id: `mem_749069896e5d4753aff136efbd779d50`
- tenant role: `owner`
- api key id: `key_00dfae41c43d47bbac5522dbf130c605`
- api key secret: `sk_local_4d59fedcea18ae49a9fe15c964a6315b9b90ed4a637c2110`
- manifest: `/Users/overment/playground/devs/05_04_api/var/main-account-seed.json`

## Browser Login

- email: `main@local.test`
- password: `pw_local_941f4f48bb6ee916d94ff4f286a284fa`

## API Headers

```http
Authorization: Bearer sk_local_4d59fedcea18ae49a9fe15c964a6315b9b90ed4a637c2110
X-Tenant-Id: ten_7994f103f2254a8d862dd9ba1389ebda
```

## Reset Commands

```bash
rm var/05_04_api.sqlite var/05_04_api.sqlite-shm var/05_04_api.sqlite-wal var/main-account-seed.json
npm run db:migrate
npm run db:seed
```

The seed script is [seed-main-account.ts](/Users/overment/playground/devs/05_04_api/src/db/seed-main-account.ts), and the persisted credentials manifest is [main-account-seed.json](/Users/overment/playground/devs/05_04_api/var/main-account-seed.json).
