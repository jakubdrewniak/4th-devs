import { app } from "./state.svelte.js";

const json = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
};

const addProcessingBlock = (blockId) => {
  if (!blockId) return;
  app.processingBlockIds = new Set([...app.processingBlockIds, blockId]);
};

const removeProcessingBlock = (blockId) => {
  if (!blockId) return;
  const next = new Set(app.processingBlockIds);
  next.delete(blockId);
  app.processingBlockIds = next;
};

export const bootstrap = async () => {
  const r = await json("/api/bootstrap");
  app.documents = r.documents;
  app.prompts = r.prompts;
  app.selectedDocPath = r.documents[0]?.path ?? null;
  app.selectedPromptPath = r.prompts[0]?.path ?? null;
  app.ensureValidMode();
};

export const fetchDoc = async (path) => {
  const r = await json(`/api/document?path=${encodeURIComponent(path)}`);
  app.applyResult(r.document, r.review);
};

export const runReview = async () => {
  if (!app.selectedDocPath || !app.selectedPromptPath) return;
  app.busy = true;
  app.editingBlockId = null;
  app.processingBlockIds = new Set();
  app.progress = { visible: true, pct: 0, label: "Preparing..." };

  try {
    const res = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentPath: app.selectedDocPath,
        promptPath: app.selectedPromptPath,
        mode: app.selectedMode,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Request failed");
    }

    if (!res.body) {
      throw new Error("Review stream unavailable.");
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);

          if (ev.type === "started") {
            if (ev.document && ev.review) {
              app.applyResult(ev.document, ev.review);
            }
            app.progress = {
              visible: true,
              pct: 0,
              label: ev.totalBlocks === 1 ? "Reviewing..." : `0 / ${ev.totalBlocks} done · 0 comments`,
            };
          }

          if (ev.type === "block_start") {
            addProcessingBlock(ev.blockId);
            const active = app.processingBlockIds.size;
            app.progress = {
              visible: true,
              pct: (ev.blockIndex / ev.totalBlocks) * 100,
              label: ev.totalBlocks === 1
                ? "Reviewing..."
                : `${active} block${active > 1 ? "s" : ""} in flight · ${ev.blockIndex + 1} / ${ev.totalBlocks} queued`,
            };
          }

          if (ev.type === "comment_added") {
            app.mergeStreamingComment(ev.comment);
            const active = app.processingBlockIds.size;
            app.progress = {
              visible: true,
              pct: app.progress.pct,
              label: active > 0
                ? `${active} block${active > 1 ? "s" : ""} in flight · ${ev.totalComments} comments`
                : `${ev.totalComments} comments`,
            };
          }

          if (ev.type === "block_done") {
            removeProcessingBlock(ev.blockId);
            const done = ev.completedBlocks ?? (ev.blockIndex + 1);
            app.progress = {
              visible: true,
              pct: (done / ev.totalBlocks) * 100,
              label: `${done} / ${ev.totalBlocks} done · ${ev.totalComments} comments`,
            };
          }

          if (ev.type === "summary_start") {
            app.progress = {
              visible: true,
              pct: Math.max(app.progress.pct, 96),
              label: "Summarizing insights...",
            };
          }

          if (ev.type === "complete") {
            app.applyResult(ev.document, ev.review);
            app.processingBlockIds = new Set();
            app.progress = { visible: true, pct: 100, label: "Done" };
            app.toast(`Review complete — ${ev.review.comments.length} comments`);
          }

          if (ev.type === "error") throw new Error(ev.error);
        } catch (e) {
          if (e.message !== "Unexpected end of JSON input") throw e;
        }
      }
    }
  } catch (e) {
    app.markReviewFailed();
    app.toast(e.message, true);
  } finally {
    app.busy = false;
    setTimeout(() => { app.progress = { visible: false, pct: 0, label: "" }; }, 1500);
  }
};

export const rerunBlockReview = async (blockId, message = "") => {
  if (!app.review?.id || !blockId) return;

  app.busy = true;
  addProcessingBlock(blockId);

  try {
    const r = await json("/api/review/block", {
      method: "POST",
      body: JSON.stringify({
        reviewId: app.review.id,
        blockId,
        message,
      }),
    });

    app.applyResult(r.document, r.review);
    if (r.createdCommentIds?.[0]) {
      app.selectComment(r.createdCommentIds[0], { scroll: false });
    } else {
      app.selectBlock(blockId, { openFirstComment: true, scroll: false });
    }
    app.toast(
      r.createdCommentIds?.length
        ? `Block re-reviewed — ${r.createdCommentIds.length} comment${r.createdCommentIds.length === 1 ? "" : "s"}`
        : "Block re-reviewed",
    );
  } catch (e) {
    app.toast(e.message, true);
  } finally {
    removeProcessingBlock(blockId);
    app.busy = false;
  }
};

export const acceptComment = async (id) => {
  app.busy = true;
  try {
    const r = await json("/api/comments/accept", {
      method: "POST",
      body: JSON.stringify({ reviewId: app.review.id, commentId: id }),
    });
    app.applyResult(r.document, r.review);
    app.selectComment(id, { scroll: false });
    app.toast("Suggestion applied");
  } catch (e) { app.toast(e.message, true); }
  finally { app.busy = false; }
};

export const rejectComment = async (id) => {
  app.busy = true;
  try {
    const r = await json("/api/comments/reject", {
      method: "POST",
      body: JSON.stringify({ reviewId: app.review.id, commentId: id }),
    });
    app.applyResult(r.document, r.review);
    if (!app.selectNextOpenComment(id, { scroll: false })) {
      app.selectBlock(app.selectedBlockId, { openFirstComment: true, scroll: false });
    }
    app.toast("Comment rejected");
  } catch (e) { app.toast(e.message, true); }
  finally { app.busy = false; }
};

export const resolveComment = async (id) => {
  app.busy = true;
  try {
    const r = await json("/api/comments/resolve", {
      method: "POST",
      body: JSON.stringify({ reviewId: app.review.id, commentId: id }),
    });
    app.applyResult(r.document, r.review);
    if (!app.selectNextOpenComment(id, { scroll: false })) {
      app.selectBlock(app.selectedBlockId, { openFirstComment: true, scroll: false });
    }
    app.toast("Comment resolved");
  } catch (e) { app.toast(e.message, true); }
  finally { app.busy = false; }
};

export const convertComment = async (id, suggestion) => {
  app.busy = true;
  try {
    const r = await json("/api/comments/convert", {
      method: "POST",
      body: JSON.stringify({ reviewId: app.review.id, commentId: id, suggestion }),
    });
    app.applyResult(r.document, r.review);
    app.selectComment(id, { scroll: false });
    app.toast("Converted to suggestion");
  } catch (e) { app.toast(e.message, true); }
  finally { app.busy = false; }
};

export const revertComment = async (id) => {
  app.busy = true;
  try {
    const r = await json("/api/comments/revert", {
      method: "POST",
      body: JSON.stringify({ reviewId: app.review.id, commentId: id }),
    });
    app.applyResult(r.document, r.review);
    app.selectComment(id, { scroll: false });
    app.toast("Suggestion reverted");
  } catch (e) { app.toast(e.message, true); }
  finally { app.busy = false; }
};

export const acceptAll = async () => {
  app.busy = true;
  try {
    const r = await json("/api/comments/accept-all", {
      method: "POST",
      body: JSON.stringify({ reviewId: app.review.id }),
    });
    app.applyResult(r.document, r.review);
    app.selectBlock(app.reviewableBlocks[0]?.id ?? null, { openFirstComment: true, scroll: false });
    app.toast("All suggestions accepted");
  } catch (e) { app.toast(e.message, true); }
  finally { app.busy = false; }
};

export const rejectAll = async () => {
  app.busy = true;
  try {
    const r = await json("/api/comments/reject-all", {
      method: "POST",
      body: JSON.stringify({ reviewId: app.review.id }),
    });
    app.applyResult(r.document, r.review);
    app.selectBlock(app.reviewableBlocks[0]?.id ?? null, { openFirstComment: true, scroll: false });
    app.toast("All comments rejected");
  } catch (e) { app.toast(e.message, true); }
  finally { app.busy = false; }
};

export const saveBlock = async (docPath, blockId, text) => {
  app.busy = true;
  try {
    const r = await json("/api/document/save", {
      method: "POST",
      body: JSON.stringify({ documentPath: docPath, blockId, text }),
    });
    app.applyResult(r.document, app.review);
    app.editingBlockId = null;
    app.selectComment(null, { scroll: false });
    app.selectBlock(blockId, { openFirstComment: false, scroll: false });
    app.toast("Block saved");
  } catch (e) { app.toast(e.message, true); }
  finally { app.busy = false; }
};

export const download = () => {
  if (!app.selectedDocPath) return;
  const a = document.createElement("a");
  a.href = `/api/document/download?path=${encodeURIComponent(app.selectedDocPath)}`;
  a.download = "";
  document.body.append(a);
  a.click();
  a.remove();
};
