import { newQuickJSAsyncWASMModuleFromVariant } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-wasmfile-release-asyncify";

export interface ExecutionResult {
  logs: string[];
  error?: string;
}

export interface SandboxOptions {
  timeout?: number;
  memoryLimit?: number;
}

const DEFAULT_OPTIONS: Required<SandboxOptions> = {
  timeout: 5000,
  memoryLimit: 128 * 1024 * 1024,
};

let modulePromise: ReturnType<typeof newQuickJSAsyncWASMModuleFromVariant> | null = null;

async function getQuickJS() {
  if (!modulePromise) {
    modulePromise = newQuickJSAsyncWASMModuleFromVariant(variant);
  }
  return modulePromise;
}

export async function executeCode(
  code: string,
  toolImplementations: Record<string, Record<string, (input: unknown) => Promise<unknown>>>,
  options: SandboxOptions = {}
): Promise<ExecutionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const logs: string[] = [];

  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();

  runtime.setMemoryLimit(opts.memoryLimit);

  const startTime = Date.now();
  runtime.setInterruptHandler(() => Date.now() - startTime > opts.timeout);

  const context = runtime.newContext();

  try {
    // Expose console.log
    const consoleHandle = context.newObject();

    const logFn = context.newFunction("log", (...args) => {
      const parts = args.map((handle) => {
        const val = context.dump(handle);
        return typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
      });
      logs.push(parts.join(" "));
    });
    context.setProp(consoleHandle, "log", logFn);
    context.setProp(consoleHandle, "info", logFn);
    logFn.dispose();

    const errorFn = context.newFunction("error", (...args) => {
      const parts = args.map((handle) => {
        const val = context.dump(handle);
        return typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
      });
      logs.push(`[ERROR] ${parts.join(" ")}`);
    });
    context.setProp(consoleHandle, "error", errorFn);
    errorFn.dispose();

    const warnFn = context.newFunction("warn", (...args) => {
      const parts = args.map((handle) => {
        const val = context.dump(handle);
        return typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
      });
      logs.push(`[WARN] ${parts.join(" ")}`);
    });
    context.setProp(consoleHandle, "warn", warnFn);
    warnFn.dispose();

    context.setProp(context.global, "console", consoleHandle);
    consoleHandle.dispose();

    // Expose tool implementations as async host functions
    for (const [serverName, tools] of Object.entries(toolImplementations)) {
      for (const [toolName, fn] of Object.entries(tools)) {
        const hostFnName = `__call_${serverName}_${toolName}`;

        const hostFn = context.newAsyncifiedFunction(hostFnName, async (inputHandle) => {
          const input = inputHandle ? context.dump(inputHandle) : {};
          const result = await fn(input);
          return context.newString(JSON.stringify(result));
        });

        context.setProp(context.global, hostFnName, hostFn);
        hostFn.dispose();
      }
    }

    // Build guest code with API wrappers
    const guestCode = buildGuestCode(code, toolImplementations);

    const result = await context.evalCodeAsync(guestCode);

    // Flush any pending Promise jobs (microtask queue)
    const pendingResult = runtime.executePendingJobs();
    if ('error' in pendingResult) {
      const pendingError = context.dump(pendingResult.error);
      pendingResult.error.dispose();
      return { logs, error: `Pending job error: ${String(pendingError)}` };
    }

    if (result.error) {
      const errorObj = context.dump(result.error);
      result.error.dispose();
      const errorMessage =
        typeof errorObj === "object" && errorObj !== null && "message" in errorObj
          ? String((errorObj as Record<string, unknown>).message)
          : String(errorObj);
      return { logs, error: errorMessage };
    }

    result.value.dispose();
    return { logs };
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

function buildGuestCode(
  code: string,
  toolImplementations: Record<string, Record<string, unknown>>
): string {
  const apiDefs: string[] = [];

  for (const [serverName, tools] of Object.entries(toolImplementations)) {
    const methods = Object.keys(tools).map((toolName) => {
      const hostFn = `__call_${serverName}_${toolName}`;
      // Wrappers must be SYNC — asyncified host functions appear synchronous
      // from QuickJS's perspective. Using `async` would create JS Promises
      // whose microtask queue may not flush before evalCodeAsync returns.
      return `    ${toolName}(input) {\n      const json = ${hostFn}(input);\n      return JSON.parse(json);\n    }`;
    });
    apiDefs.push(`const ${serverName} = {\n${methods.join(",\n")}\n  };`);
  }

  // No async IIFE needed — host functions are sync thanks to asyncify.
  // Wrap in plain IIFE to scope the API objects.
  return `(function() {\n  ${apiDefs.join("\n  ")}\n\n  ${code}\n})();`;
}
