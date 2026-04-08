import type { AxMetricFn } from '@ax-llm/ax';
import type { LabeledEmail } from './eval-data.js';

const jaccard = (a: string[], b: string[]): number => {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
};

export const classificationMetric: AxMetricFn = ({ prediction, example }) => {
  const expected = example as LabeledEmail;
  const pred = prediction as {
    labels?: string | string[];
    priority?: string;
    needsReply?: boolean;
    summary?: string;
  };

  const predLabels = Array.isArray(pred.labels)
    ? pred.labels
    : typeof pred.labels === 'string'
      ? [pred.labels]
      : [];

  const labelScore = jaccard(predLabels, expected.labels);
  const priorityScore = pred.priority === expected.priority ? 1 : 0;
  const replyScore = pred.needsReply === expected.needsReply ? 1 : 0;

  const needsReplyLabelConsistent =
    (pred.needsReply === true) === predLabels.includes('needs-reply');
  const consistencyBonus = needsReplyLabelConsistent ? 0.1 : 0;

  return Math.min(1, labelScore * 0.5 + priorityScore * 0.25 + replyScore * 0.15 + consistencyBonus);
};
