export const computeDiff = (before, after) => {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  const added = afterLines.filter((line) => !beforeSet.has(line) && line.trim());
  const removed = beforeLines.filter((line) => !afterSet.has(line) && line.trim());

  const parts = [];
  for (const line of removed) parts.push(`- ${line.trim()}`);
  for (const line of added) parts.push(`+ ${line.trim()}`);

  return parts.length ? parts.join("\n") : "(no textual diff)";
};

export const summarizeDiff = (before, after) => {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  const added = afterLines.filter((line) => !beforeSet.has(line) && line.trim()).length;
  const removed = beforeLines.filter((line) => !afterSet.has(line) && line.trim()).length;
  return `+${added}/-${removed} lines`;
};
