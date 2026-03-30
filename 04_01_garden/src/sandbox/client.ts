import { Daytona } from "@daytonaio/sdk";
import type { Sandbox } from "@daytonaio/sdk";
import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

const WORKDIR = "workspace/repo";
const LOCAL_SYNC_INTERVAL_MS = 700;

const PROJECT_ROOT = join(import.meta.dir, "../..");
const VAULT_DIR = join(PROJECT_ROOT, "vault");

const daytona = new Daytona();

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return results;
    throw error;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(full)));
    } else {
      if (entry.name === ".DS_Store") continue;
      results.push(full);
    }
  }
  return results;
}

async function uploadLocalDir(
  sandbox: Sandbox,
  localDir: string,
  remoteBase: string,
): Promise<number> {
  let count = 0;
  const files = await collectFiles(localDir);
  for (const file of files) {
    const rel = toPosixPath(relative(localDir, file));
    const remotePath = `${remoteBase}/${rel}`;
    await sandbox.fs.uploadFile(file, remotePath);
    count++;
  }
  return count;
}

async function snapshotLocalVault(): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  const files = await collectFiles(VAULT_DIR);

  for (const file of files) {
    const rel = toPosixPath(relative(VAULT_DIR, file));
    try {
      const fileStat = await stat(file);
      snapshot.set(rel, `${fileStat.size}:${Math.trunc(fileStat.mtimeMs)}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }

  return snapshot;
}

async function syncLocalVaultToSandbox(
  sandbox: Sandbox,
  previousSnapshot: Map<string, string>,
): Promise<{ snapshot: Map<string, string>; uploaded: number; deleted: number }> {
  const nextSnapshot = await snapshotLocalVault();
  let uploaded = 0;
  let deleted = 0;

  for (const [rel, signature] of nextSnapshot) {
    if (previousSnapshot.get(rel) === signature) continue;
    await sandbox.fs.uploadFile(join(VAULT_DIR, rel), `${WORKDIR}/vault/${rel}`);
    uploaded++;
  }

  for (const rel of previousSnapshot.keys()) {
    if (nextSnapshot.has(rel)) continue;
    try {
      await sandbox.fs.deleteFile(`${WORKDIR}/vault/${rel}`);
      deleted++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("not found")) throw error;
    }
  }

  return { snapshot: nextSnapshot, uploaded, deleted };
}

async function initSandbox(sandbox: Sandbox): Promise<void> {
  await sandbox.process.executeCommand(`mkdir -p ${WORKDIR}/vault`);

  const vaultCount = await uploadLocalDir(sandbox, VAULT_DIR, `${WORKDIR}/vault`);
  console.log(`sandbox: synced ${vaultCount} vault files`);
}

async function syncVaultBack(sandbox: Sandbox): Promise<number> {
  const result = await sandbox.process.executeCommand(
    `find ${WORKDIR}/vault -type f -not -path '*/system/*' -not -name '.DS_Store'`,
  );

  if (result.exitCode !== 0) {
    console.warn(`sandbox: vault sync skipped (find failed: ${result.result})`);
    return 0;
  }

  const files = (result.result ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((f) => f.startsWith(WORKDIR));

  let count = 0;
  for (const remotePath of files) {
    const rel = remotePath.replace(`${WORKDIR}/vault/`, "");
    const localPath = join(VAULT_DIR, rel);
    await mkdir(dirname(localPath), { recursive: true });
    const buffer = await sandbox.fs.downloadFile(remotePath);
    await Bun.write(localPath, buffer);
    count++;
  }

  if (count > 0) console.log(`sandbox: synced ${count} vault files back`);
  return count;
}

export class LazySandbox {
  private instance: Sandbox | null = null;
  private localSnapshot = new Map<string, string>();
  private localSyncTimer: ReturnType<typeof setInterval> | null = null;
  private syncInFlight = false;

  private startLocalSyncLoop(): void {
    if (this.localSyncTimer) return;
    this.localSyncTimer = setInterval(() => {
      void this.syncLocalVaultNow();
    }, LOCAL_SYNC_INTERVAL_MS);
  }

  private stopLocalSyncLoop(): void {
    if (!this.localSyncTimer) return;
    clearInterval(this.localSyncTimer);
    this.localSyncTimer = null;
  }

  async syncLocalVaultNow(): Promise<void> {
    if (!this.instance || this.syncInFlight) return;

    this.syncInFlight = true;
    try {
      const result = await syncLocalVaultToSandbox(this.instance, this.localSnapshot);
      this.localSnapshot = result.snapshot;

      if (result.uploaded > 0 || result.deleted > 0) {
        console.log(
          `sandbox: synced local vault changes (+${result.uploaded}, -${result.deleted})`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`sandbox: local sync failed (${message})`);
    } finally {
      this.syncInFlight = false;
    }
  }

  async syncVaultBackNow(): Promise<void> {
    if (!this.instance || this.syncInFlight) return;

    this.syncInFlight = true;
    try {
      const count = await syncVaultBack(this.instance);
      if (count > 0 || this.localSnapshot.size === 0) {
        this.localSnapshot = await snapshotLocalVault();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`sandbox: vault back-sync failed (${message})`);
    } finally {
      this.syncInFlight = false;
    }
  }

  async get(): Promise<Sandbox> {
    if (!this.instance) {
      console.log("sandbox: creating...");
      const sandbox = await daytona.create({ language: "typescript" });
      await initSandbox(sandbox);
      this.instance = sandbox;
      this.localSnapshot = await snapshotLocalVault();
      this.startLocalSyncLoop();
    }
    return this.instance;
  }

  async destroy(): Promise<void> {
    if (this.instance) {
      this.stopLocalSyncLoop();
      await this.syncLocalVaultNow();
      await this.syncVaultBackNow();
      await this.instance.delete();
      this.instance = null;
      this.localSnapshot.clear();
      console.log("sandbox: destroyed");
    }
  }
}

export { WORKDIR, VAULT_DIR, syncVaultBack };
