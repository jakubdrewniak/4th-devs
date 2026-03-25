const ts = (): string => new Date().toISOString().slice(11, 19);

export const log = {
  info: (msg: string) => console.log(`  [${ts()}] ${msg}`),
  warn: (msg: string) => console.warn(`  [${ts()}] WARN ${msg}`),
  tool: (name: string, preview: string) => console.log(`  [${ts()}] TOOL ${name} → ${preview.slice(0, 220)}`),
  turn: (n: number) => console.log(`  [${ts()}] turn ${n}`),
  hook: (name: string, msg: string) => console.log(`  [${ts()}] HOOK ${name} → ${msg}`),
};
