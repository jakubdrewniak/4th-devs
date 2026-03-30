const asObject = (value, field) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
};

const asString = (value, field) => {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} cannot be empty.`);
  }
  return trimmed;
};

const slugToTitle = (slug) =>
  slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const normalizeTopic = (value) => {
  const raw = asString(value, "input.topic").toLowerCase();
  const normalized = raw
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^-+|-+$/g, "");

  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("input.topic resolved to an invalid path.");
  }

  if (
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("input.topic must be a safe relative path segment.");
  }

  return normalized;
};

const findHeadingTitle = (content) => {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
};

const getSectionBody = (content, heading) => {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const headingRe = new RegExp(`^##\\s+${heading}\\s*$`, "i");
  const sectionStart = lines.findIndex((line) => headingRe.test(line.trim()));
  if (sectionStart === -1) return "";

  const bodyLines = [];
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) break;
    bodyLines.push(lines[i]);
  }
  return bodyLines.join("\n").trim();
};

const extractUrls = (content) => {
  const matches = content.match(/https?:\/\/[^\s)]+/g);
  return matches ? [...new Set(matches)] : [];
};

const stripLeadingH1 = (content) => {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length === 0) return content;

  let firstNonEmpty = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      firstNonEmpty = i;
      break;
    }
  }

  if (firstNonEmpty === -1) return content;
  if (!/^#\s+/.test(lines[firstNonEmpty])) return content;

  const next = [...lines.slice(0, firstNonEmpty), ...lines.slice(firstNonEmpty + 1)];
  while (next.length > 0 && next[0].trim() === "") next.shift();
  return next.join("\n");
};

const missingInfoCount = (content) => {
  const matches = content.match(
    /Not found in reviewed sources as of|Conflicting information across sources; verification required\./gi,
  );
  return matches ? matches.length : 0;
};

const inputObj = asObject(input, "input");
const topic = normalizeTopic(inputObj.topic);
const topicDir = `vault/research/${topic}`;
const overviewPath = `${topicDir}/overview.md`;
const today = new Date().toISOString().slice(0, 10);

let entries;
try {
  entries = await codemode.vault.list(topicDir);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(
    `Unable to open topic folder "${topicDir}". Ensure it exists and contains product notes. (${message})`,
  );
}

const productFiles = entries
  .filter((entry) => !entry.is_dir)
  .map((entry) => entry.name)
  .filter(
    (name) => name.endsWith(".md") && name !== "overview.md" && !name.startsWith("."),
  )
  .sort((a, b) => a.localeCompare(b));

if (productFiles.length < 2) {
  throw new Error(
    `Expected at least 2 product markdown files in "${topicDir}". Create <product>.md files first.`,
  );
}

if (productFiles.length > 3) {
  throw new Error(
    `Found ${productFiles.length} product files in "${topicDir}", but this skill supports at most 3. Remove extra files and retry.`,
  );
}

const mergedSections = [];
const productNames = [];
let totalMissingMentions = 0;

for (const fileName of productFiles) {
  const filePath = `${topicDir}/${fileName}`;
  const content = await codemode.vault.read(filePath);
  const cleaned = stripLeadingH1(content).trim();
  const fallbackName = slugToTitle(fileName.replace(/\.md$/i, ""));
  const productName = findHeadingTitle(content) || fallbackName;
  const sourcesSection = getSectionBody(content, "Sources");
  const sourceUrls = extractUrls(sourcesSection);
  if (sourceUrls.length === 0) {
    throw new Error(
      `${filePath} must include at least one real URL in the "## Sources" section before overview merge.`,
    );
  }
  const missingMentions = missingInfoCount(content);

  productNames.push(productName);
  totalMissingMentions += missingMentions;

  mergedSections.push(
    [
      `## ${productName}`,
      "",
      `Source file: \`${filePath}\``,
      `Source URLs detected: ${sourceUrls.length}`,
      "",
      cleaned || "_No content found in this product file._",
      "",
    ].join("\n"),
  );
}

const frontmatter = [
  "---",
  `title: ${JSON.stringify(`${slugToTitle(topic)} - Research Overview`)}`,
  `date: ${JSON.stringify(today)}`,
  `topic: ${JSON.stringify(topic)}`,
  `product_count: ${productFiles.length}`,
  `missing_information_mentions: ${totalMissingMentions}`,
  "---",
  "",
].join("\n");

const body = [
  `# ${slugToTitle(topic)} overview`,
  "",
  `This overview merges product research notes from \`${topicDir}\`.`,
  "",
  "## Products covered",
  ...productNames.map((name) => `- ${name}`),
  "",
  "## Missing information summary",
  totalMissingMentions > 0
    ? `Detected ${totalMissingMentions} explicit missing/conflicting-information note(s) across product files.`
    : "No explicit missing/conflicting-information notes were detected in product files.",
  "",
  "## Merged product notes",
  "",
  mergedSections.join("\n---\n\n"),
  "",
].join("\n");

const saved = await codemode.vault.write(overviewPath, `${frontmatter}${body}`);

codemode.output.set({
  path: saved.path,
  bytes_written: saved.bytes_written,
  topic,
  merged_files: productFiles.map((name) => `${topicDir}/${name}`),
  merged_count: productFiles.length,
  missing_information_mentions: totalMissingMentions,
});
