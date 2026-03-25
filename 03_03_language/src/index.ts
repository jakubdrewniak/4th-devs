import * as readline from 'node:readline';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runAgent } from './agent.js';
import { WORKSPACE } from './config.js';
import { log } from './log.js';

const ensureDirs = async () => {
  await mkdir(join(WORKSPACE, 'input'), { recursive: true });
  await mkdir(join(WORKSPACE, 'output'), { recursive: true });
  await mkdir(join(WORKSPACE, 'sessions'), { recursive: true });
  const profilePath = join(WORKSPACE, 'profile.json');
  try {
    await readFile(profilePath, 'utf-8');
  } catch {
    await writeFile(profilePath, `${JSON.stringify({
      role: 'software engineer',
      goals: [
        'Speak clearly in daily standups',
        'Explain technical decisions with confidence',
        'Reduce filler words and hesitation',
      ],
      weakAreas: [],
      sessions: [],
    }, null, 2)}\n`, 'utf-8');
  }
};

const main = async () => {
  await ensureDirs();

  let responseId: string | undefined;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\n  You: ' });

  console.log('');
  console.log('  ────────────────────────────────────────────────────────');
  console.log('  English Coach — analiza wymowy i gramatyki');
  console.log('  ────────────────────────────────────────────────────────');
  console.log('');
  console.log('  Agent odsłuchuje nagranie (Gemini ASR), analizuje wymowę');
  console.log('  i gramatykę, a następnie generuje feedback w formie');
  console.log('  tekstu i audio (Gemini TTS). Postępy są zapisywane');
  console.log('  w profilu (workspace/profile.json) i sesjach.');
  console.log('');
  console.log('  Przykładowe pliki audio są w workspace/input/.');
  console.log('');
  console.log('  Przykłady:');
  console.log('    Please give me feedback on input/example-day-1.wav');
  console.log('    Listen to input/example-day-1.wav and review my pronunciation');
  console.log('');
  console.log('  Wpisz "quit" aby zakończyć.');
  console.log('  ────────────────────────────────────────────────────────');
  console.log('');
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (input === 'quit' || input === 'exit') { process.exit(0); }

    try {
      const result = await runAgent(input, responseId);
      responseId = result.responseId;
      console.log(`\n  Coach: ${result.text}\n`);
    } catch (err) {
      log.warn(err instanceof Error ? err.message : String(err));
    }

    rl.prompt();
  });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
