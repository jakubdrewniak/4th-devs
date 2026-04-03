import { app } from "./state.svelte.js";
import { acceptComment, download, rejectComment, rerunBlockReview, resolveComment, revertComment, runReview } from "./api.js";

const isEditableTarget = (target) => {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;

  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return true;

  return element.isContentEditable || Boolean(element.closest("[contenteditable='true']"));
};

export const setupKeys = () => {
  document.addEventListener("keydown", (e) => {
    const hasPrimaryModifier = e.metaKey || e.ctrlKey;
    const editableTarget = isEditableTarget(e.target);

    if (hasPrimaryModifier && !editableTarget && e.key === "Enter") {
      if (app.busy) return;
      e.preventDefault();
      runReview();
      return;
    }

    if (hasPrimaryModifier && !editableTarget && e.shiftKey && e.key.toLowerCase() === "e") {
      if (app.busy) return;
      e.preventDefault();
      download();
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (editableTarget) return;
    if (document.querySelector(".picker-menu")) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      app.navigateBlocks(1);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      app.navigateBlocks(-1);
      return;
    }

    if (e.key === "e" && app.currentBlock?.reviewable && !app.busy) {
      e.preventDefault();
      app.beginBlockEdit();
      return;
    }

    if (e.shiftKey && e.key.toLowerCase() === "r" && app.currentBlock?.reviewable && !app.busy) {
      e.preventDefault();
      rerunBlockReview(app.currentBlock.id);
      return;
    }

    if (e.key === "j") { app.navigate(1); return; }
    if (e.key === "k") { app.navigate(-1); return; }

    if (e.key === "Escape") {
      if (app.editingBlockId) { app.editingBlockId = null; return; }
      app.selectComment(null, { scroll: false });
      return;
    }

    const c = app.currentComment;
    if (!c) return;
    const actionsLocked = app.busy || !app.reviewIsComplete;

    if (!actionsLocked && e.key === "a" && c.status === "open" && c.kind === "suggestion" && c.suggestion) {
      acceptComment(c.id);
      return;
    }
    if (!actionsLocked && e.key === "r" && c.status === "open") {
      rejectComment(c.id);
      return;
    }
    if (!actionsLocked && e.key === "d" && c.status === "open") {
      resolveComment(c.id);
      return;
    }
    if (!actionsLocked && e.key === "u" && c.status === "accepted" && c.originalBlockText) {
      revertComment(c.id);
    }
  });
};
