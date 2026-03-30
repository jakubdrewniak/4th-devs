const asObject = (value, field) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
};

const asNonEmptyString = (value, field) => {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} cannot be empty.`);
  }
  return trimmed;
};

const payload = asObject(input, "input");
const path = asNonEmptyString(payload.path, "input.path");
const findLine = asNonEmptyString(payload.find_line, "input.find_line");
const replaceLine = asNonEmptyString(payload.replace_line, "input.replace_line");
const insertAfterLine = asNonEmptyString(payload.insert_after_line, "input.insert_after_line");

const original = await codemode.vault.read(path);
const normalized = original.replace(/\r\n/g, "\n");
const hasTrailingNewline = normalized.endsWith("\n");
const lines = normalized.split("\n");

const targetIndex = lines.findIndex((line) => line === findLine);
if (targetIndex === -1) {
  throw new Error(`Line not found in ${path}: "${findLine}"`);
}

const updatedLines = [
  ...lines.slice(0, targetIndex),
  replaceLine,
  insertAfterLine,
  ...lines.slice(targetIndex + 1),
];

let updated = updatedLines.join("\n");
if (hasTrailingNewline && !updated.endsWith("\n")) {
  updated += "\n";
}

const saved = await codemode.vault.write(path, updated);

codemode.output.set({
  status: "updated",
  path: saved.path,
  bytes_written: saved.bytes_written,
  replaced_index: targetIndex + 1,
  inserted_index: targetIndex + 2,
});
