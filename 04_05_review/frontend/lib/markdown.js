const esc = (t) => t
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

export const renderInline = (text) => {
  if (!text) return "";
  let h = esc(text);
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:6px">');
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/__(.+?)__/g, "<strong>$1</strong>");
  h = h.replace(/~~(.+?)~~/g, "<del>$1</del>");
  h = h.replace(/(?<![*\\])\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  h = h.replace(/(?<![_\\])_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>");
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return h;
};

export const buildSegments = (text, highlights) => {
  const segs = [];
  let cursor = 0;

  for (const hl of highlights) {
    if (hl.start > cursor) {
      segs.push({ type: "text", text: text.slice(cursor, hl.start) });
    }
    segs.push({ type: "hl", text: text.slice(hl.start, hl.end), comment: hl });
    cursor = hl.end;
  }

  if (cursor < text.length) {
    segs.push({ type: "text", text: text.slice(cursor) });
  }

  return segs;
};
