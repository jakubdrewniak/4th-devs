import { writeFileSync } from 'node:fs';
import { AxBootstrapFewShot, axDefaultOptimizerLogger } from '@ax-llm/ax';
import { llm } from './config.js';
import { createClassifier } from './classify.js';
import { trainingSet, validationSet } from './eval-data.js';
import { classificationMetric } from './metric.js';
import {
  logTrainingStart,
  logOptimizationResult,
  logValidationHeader,
  logValidationRow,
  logValidationAvg,
} from './logger.js';

const DEMOS_PATH = new URL('../demos.json', import.meta.url).pathname;

const main = async () => {
  const classifier = createClassifier();

  const optimizer = new AxBootstrapFewShot({
    studentAI: llm,
    targetScore: 0.85,
    optimizerLogger: axDefaultOptimizerLogger,
    verbose: true,
    options: {
      maxRounds: 4,
      maxDemos: 4,
      maxExamples: 8,
    },
  });

  logTrainingStart(trainingSet.length);

  const result = await optimizer.compile(
    classifier as any,
    trainingSet,
    classificationMetric,
  );

  const demosCount = result.demos?.length ?? 0;
  if (result.demos?.length) {
    writeFileSync(DEMOS_PATH, JSON.stringify(result.demos, null, 2));
  }

  logOptimizationResult({
    bestScore: result.bestScore,
    stats: result.stats,
    demosCount,
  });

  logValidationHeader();
  const optimized = createClassifier();
  if (result.demos) {
    optimized.setDemos(result.demos);
  }

  let totalScore = 0;
  for (const example of validationSet) {
    const prediction = await optimized.forward(llm, {
      emailFrom: example.emailFrom,
      emailSubject: example.emailSubject,
      emailBody: example.emailBody,
    });
    const score = classificationMetric({ prediction, example }) as number;
    totalScore += score;

    const predLabels = Array.isArray(prediction.labels) ? prediction.labels : [prediction.labels];
    logValidationRow(score, example.emailSubject, example.labels, predLabels as string[]);
  }

  logValidationAvg(totalScore / validationSet.length);
};

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
