import { Daytona } from "@daytonaio/sdk";

const daytona = new Daytona();

console.log("creating sandbox...");
const sandbox = await daytona.create({ language: "typescript" });
console.log("sandbox created");

const REPO = process.env.GITHUB_REPO ?? "";
const TOKEN = process.env.GITHUB_TOKEN ?? "";

// Test 1: Is git available as a shell command?
console.log("\n--- git version ---");
const gitVer = await sandbox.process.executeCommand("git --version");
console.log("exit:", gitVer.exitCode, "result:", gitVer.result);

// Test 2: Try SDK git.clone
console.log("\n--- SDK git.clone ---");
try {
  await sandbox.git.clone(REPO, "workspace/repo", undefined, undefined, "git", TOKEN);
  console.log("SDK clone: OK");
} catch (e: any) {
  console.log("SDK clone error:", e?.message ?? e);

  // Test 3: Try shell git clone --depth 1
  console.log("\n--- shell git clone --depth 1 ---");
  const authedUrl = REPO.replace("https://", `https://git:${TOKEN}@`);
  const clone = await sandbox.process.executeCommand(
    `git clone --depth 1 ${authedUrl} workspace/repo 2>&1`,
  );
  console.log("exit:", clone.exitCode, "result:", clone.result);
}

// Test 4: Check what we got
console.log("\n--- ls workspace/repo ---");
const ls = await sandbox.process.executeCommand("ls -la workspace/repo");
console.log("exit:", ls.exitCode, "result:", ls.result);

await sandbox.delete();
console.log("done");
