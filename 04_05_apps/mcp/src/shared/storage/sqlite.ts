// SQLite session storage for Node.js/Bun runtime using Drizzle ORM
// Uses better-sqlite3 which works in both Node.js and Bun

import Database from 'better-sqlite3';
import { asc, count, eq, lt } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { ProviderTokens, SessionRecord, SessionStore } from './interface.js';
import { MAX_SESSIONS_PER_API_KEY } from './interface.js';

// ─────────────────────────────────────────────────────────────────────────────
// Schema Definition
// ─────────────────────────────────────────────────────────────────────────────

export const sessions = sqliteTable('sessions', {
  sessionId: text('session_id').primaryKey(),
  apiKey: text('api_key'),
  rsAccessToken: text('rs_access_token'),
  rsRefreshToken: text('rs_refresh_token'),
  providerJson: text('provider_json'),
  createdAt: integer('created_at').notNull(),
  lastAccessed: integer('last_accessed').notNull(),
  initialized: integer('initialized').default(0),
  protocolVersion: text('protocol_version'),
});

export type SessionRow = typeof sessions.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely parse JSON with fallback to null on error.
 */
function safeJsonParse<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function rowToRecord(row: SessionRow): SessionRecord {
  return {
    apiKey: row.apiKey || undefined,
    rs_access_token: row.rsAccessToken || undefined,
    rs_refresh_token: row.rsRefreshToken || undefined,
    provider: safeJsonParse<ProviderTokens>(row.providerJson),
    created_at: row.createdAt,
    last_accessed: row.lastAccessed,
    initialized: row.initialized === 1,
    protocolVersion: row.protocolVersion || undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Store Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SQLite-based session store using Drizzle ORM.
 * Provides persistent session storage with multi-tenant support.
 */
export class SqliteSessionStore implements SessionStore {
  private db: BetterSQLite3Database;
  private sqlite: Database.Database;
  private createSessionTxn: ReturnType<typeof this.sqlite.transaction>;

  constructor(dbPath: string = './sessions.db') {
    this.sqlite = new Database(dbPath);

    // Enable WAL mode for better concurrency
    this.sqlite.pragma('journal_mode = WAL');

    this.db = drizzle(this.sqlite);
    this.initSchema();

    // Pre-compile transaction for atomic session creation
    this.createSessionTxn = this.sqlite.transaction(
      (sessionId: string, apiKey: string, now: number) => {
        // Count existing sessions for this API key
        const countResult = this.sqlite
          .prepare('SELECT COUNT(*) as cnt FROM sessions WHERE api_key = ?')
          .get(apiKey) as { cnt: number };

        // Evict oldest if at limit
        if (countResult.cnt >= MAX_SESSIONS_PER_API_KEY) {
          const oldest = this.sqlite
            .prepare(
              'SELECT session_id FROM sessions WHERE api_key = ? ORDER BY last_accessed ASC LIMIT 1',
            )
            .get(apiKey) as { session_id: string } | undefined;

          if (oldest) {
            this.sqlite
              .prepare('DELETE FROM sessions WHERE session_id = ?')
              .run(oldest.session_id);
          }
        }

        // Insert or update the session
        this.sqlite
          .prepare(
            `INSERT INTO sessions (session_id, api_key, created_at, last_accessed, initialized)
             VALUES (?, ?, ?, ?, 0)
             ON CONFLICT(session_id) DO UPDATE SET
               api_key = excluded.api_key,
               last_accessed = excluded.last_accessed,
               initialized = 0`,
          )
          .run(sessionId, apiKey, now, now);
      },
    );
  }

  private initSchema(): void {
    // Create table if not exists
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        api_key TEXT,
        rs_access_token TEXT,
        rs_refresh_token TEXT,
        provider_json TEXT,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        initialized INTEGER DEFAULT 0,
        protocol_version TEXT
      )
    `);

    // Create indexes
    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_api_key ON sessions(api_key)
    `);
    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_api_key_accessed ON sessions(api_key, last_accessed)
    `);
    // Index for cleanup queries (DELETE WHERE last_accessed < ?)
    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_last_accessed ON sessions(last_accessed)
    `);
  }

  async create(sessionId: string, apiKey: string): Promise<SessionRecord> {
    const now = Date.now();

    // Execute atomically in a transaction to prevent race conditions
    this.createSessionTxn(sessionId, apiKey, now);

    return {
      apiKey,
      created_at: now,
      last_accessed: now,
      initialized: false,
    };
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId))
      .limit(1);

    if (rows.length === 0) return null;

    // Update last_accessed
    const now = Date.now();
    await this.db
      .update(sessions)
      .set({ lastAccessed: now })
      .where(eq(sessions.sessionId, sessionId));

    const record = rowToRecord(rows[0]);
    record.last_accessed = now;
    return record;
  }

  async update(sessionId: string, data: Partial<SessionRecord>): Promise<void> {
    const updates: Partial<SessionRow> = {
      lastAccessed: Date.now(),
    };

    if (data.initialized !== undefined) {
      updates.initialized = data.initialized ? 1 : 0;
    }
    if (data.protocolVersion !== undefined) {
      updates.protocolVersion = data.protocolVersion;
    }
    if (data.rs_access_token !== undefined) {
      updates.rsAccessToken = data.rs_access_token;
    }
    if (data.rs_refresh_token !== undefined) {
      updates.rsRefreshToken = data.rs_refresh_token;
    }
    if (data.provider !== undefined) {
      updates.providerJson = data.provider ? JSON.stringify(data.provider) : null;
    }

    await this.db
      .update(sessions)
      .set(updates)
      .where(eq(sessions.sessionId, sessionId));
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.sessionId, sessionId));
  }

  async getByApiKey(apiKey: string): Promise<SessionRecord[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.apiKey, apiKey))
      .orderBy(asc(sessions.lastAccessed));

    return rows.map(rowToRecord);
  }

  async countByApiKey(apiKey: string): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(sessions)
      .where(eq(sessions.apiKey, apiKey));

    return result[0]?.value ?? 0;
  }

  async deleteOldestByApiKey(apiKey: string): Promise<void> {
    const oldest = await this.db
      .select({ sessionId: sessions.sessionId })
      .from(sessions)
      .where(eq(sessions.apiKey, apiKey))
      .orderBy(asc(sessions.lastAccessed))
      .limit(1);

    if (oldest.length > 0) {
      await this.delete(oldest[0].sessionId);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy compatibility methods
  // ─────────────────────────────────────────────────────────────────────────

  async ensure(sessionId: string): Promise<void> {
    const existing = await this.get(sessionId);
    if (!existing) {
      const now = Date.now();
      await this.db
        .insert(sessions)
        .values({
          sessionId,
          createdAt: now,
          lastAccessed: now,
          initialized: 0,
        })
        .onConflictDoNothing();
    }
  }

  async put(sessionId: string, value: SessionRecord): Promise<void> {
    const now = Date.now();
    await this.db
      .insert(sessions)
      .values({
        sessionId,
        apiKey: value.apiKey ?? null,
        rsAccessToken: value.rs_access_token ?? null,
        rsRefreshToken: value.rs_refresh_token ?? null,
        providerJson: value.provider ? JSON.stringify(value.provider) : null,
        createdAt: value.created_at,
        lastAccessed: now,
        initialized: value.initialized ? 1 : 0,
        protocolVersion: value.protocolVersion ?? null,
      })
      .onConflictDoUpdate({
        target: sessions.sessionId,
        set: {
          apiKey: value.apiKey ?? null,
          rsAccessToken: value.rs_access_token ?? null,
          rsRefreshToken: value.rs_refresh_token ?? null,
          providerJson: value.provider ? JSON.stringify(value.provider) : null,
          lastAccessed: now,
          initialized: value.initialized ? 1 : 0,
          protocolVersion: value.protocolVersion ?? null,
        },
      });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Maintenance methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Close the database connection.
   * Call this on graceful shutdown.
   */
  close(): void {
    this.sqlite.close();
  }

  /**
   * Clean up expired sessions (older than TTL).
   * Call periodically or on startup.
   *
   * @param ttlMs - Time-to-live in milliseconds (default: 24 hours)
   * @returns Number of deleted sessions
   */
  async cleanup(ttlMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - ttlMs;

    // Use Drizzle for consistent query style
    const result = await this.db
      .delete(sessions)
      .where(lt(sessions.lastAccessed, cutoff));

    // better-sqlite3 returns RunResult with changes property
    return (result as unknown as { changes: number }).changes;
  }

  /**
   * Get store statistics for monitoring/debugging.
   */
  async getStats(): Promise<{ sessions: number }> {
    const result = await this.db.select({ value: count() }).from(sessions);
    return { sessions: result[0]?.value ?? 0 };
  }
}
