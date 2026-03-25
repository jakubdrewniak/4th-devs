import { runAgent } from './agent.js';

const result = await runAgent('listen input/day.wav and give me a feedback');
console.log(result.text.slice(0, 500));
