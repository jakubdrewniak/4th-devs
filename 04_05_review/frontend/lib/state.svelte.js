const findUnique = (text, quote) => {
  const needle = quote?.trim();
  if (!needle) return null;

  const first = text.indexOf(needle);
  if (first === -1) return null;

  const second = text.indexOf(needle, first + 1);
  if (second !== -1) return null;

  return {
    start: first,
    end: first + needle.length,
  };
};

const waitForAnimationFrame = () => new Promise((resolve) => {
  requestAnimationFrame(() => resolve());
});

// Wait for scroll activity to stop before positioning the tooltip.
const waitForScrollIdle = (scroller, idleMs = 90) => new Promise((resolve) => {
  if (!scroller) {
    resolve();
    return;
  }

  let settled = false;
  let timerId = 0;

  const finish = () => {
    if (settled) return;

    settled = true;
    window.clearTimeout(timerId);
    scroller.removeEventListener("scroll", onScroll);
    scroller.removeEventListener("scrollend", onScrollEnd);
    resolve();
  };

  const onScroll = () => {
    window.clearTimeout(timerId);
    timerId = window.setTimeout(finish, idleMs);
  };

  const onScrollEnd = () => {
    finish();
  };

  scroller.addEventListener("scroll", onScroll, { passive: true });
  scroller.addEventListener("scrollend", onScrollEnd, { passive: true });
  timerId = window.setTimeout(finish, idleMs);
});

const scrollBlockIntoView = async (blockId) => {
  if (!blockId) return;

  await waitForAnimationFrame();

  const block = document.getElementById(`blk-${blockId}`);
  if (!(block instanceof HTMLElement)) return;

  const scroller = document.querySelector(".main");
  const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    ? "auto"
    : "smooth";

  block.scrollIntoView({ block: "center", behavior });
  await waitForScrollIdle(scroller instanceof HTMLElement ? scroller : null);
  await waitForAnimationFrame();
};

class AppState {
  documents = $state([]);
  prompts = $state([]);
  selectedDocPath = $state(null);
  selectedPromptPath = $state(null);
  selectedMode = $state("paragraph");
  doc = $state(null);
  review = $state(null);
  selectedBlockId = $state(null);
  selectedCommentId = $state(null);
  editingBlockId = $state(null);
  processingBlockIds = $state(new Set());
  busy = $state(false);
  toasts = $state([]);
  progress = $state({ visible: false, pct: 0, label: "" });
  selectionScrolling = $state(false);
  selectionScrollToken = 0;

  get allComments() {
    return this.review?.comments ?? [];
  }

  get openComments() {
    return this.allComments.filter((c) => c.status === "open");
  }

  get openSuggestions() {
    return this.openComments.filter((c) => c.kind === "suggestion" && c.suggestion);
  }

  get selectedPrompt() {
    return this.prompts.find((p) => p.path === this.selectedPromptPath) ?? null;
  }

  get reviewIsRunning() {
    return this.review?.status === "running";
  }

  get reviewIsComplete() {
    return this.review?.status === "complete";
  }

  get blockOrderMap() {
    return new Map((this.doc?.blocks ?? []).map((block, index) => [block.id, block.order ?? index]));
  }

  sortComments(comments) {
    const blockOrderMap = this.blockOrderMap;
    const statusRank = { open: 0, accepted: 1, resolved: 2, rejected: 3, stale: 4 };

    return [...comments].sort((left, right) => {
      const blockDiff = (blockOrderMap.get(left.blockId) ?? Number.MAX_SAFE_INTEGER)
        - (blockOrderMap.get(right.blockId) ?? Number.MAX_SAFE_INTEGER);
      if (blockDiff) return blockDiff;

      const startDiff = (left.start ?? Number.MAX_SAFE_INTEGER) - (right.start ?? Number.MAX_SAFE_INTEGER);
      if (startDiff) return startDiff;

      const endDiff = (left.end ?? Number.MAX_SAFE_INTEGER) - (right.end ?? Number.MAX_SAFE_INTEGER);
      if (endDiff) return endDiff;

      const statusDiff = (statusRank[left.status] ?? 9) - (statusRank[right.status] ?? 9);
      if (statusDiff) return statusDiff;

      const createdDiff = new Date(left.createdAt ?? 0).getTime() - new Date(right.createdAt ?? 0).getTime();
      if (createdDiff) return createdDiff;

      return String(left.id ?? "").localeCompare(String(right.id ?? ""));
    });
  }

  get sortedComments() {
    return this.sortComments(this.allComments);
  }

  get visibleComments() {
    return this.sortedComments.filter((comment) => !comment._broken);
  }

  get openCommentsInOrder() {
    return this.visibleComments.filter((comment) => comment.status === "open");
  }

  get stats() {
    const s = { open: 0, accepted: 0, resolved: 0, rejected: 0, stale: 0 };
    for (const c of this.allComments) s[c.status] = (s[c.status] ?? 0) + 1;
    return s;
  }

  get currentComment() {
    return this.allComments.find((c) => c.id === this.selectedCommentId) ?? null;
  }

  get reviewableBlocks() {
    return this.doc?.blocks?.filter((block) => block.reviewable) ?? [];
  }

  get currentBlock() {
    return this.doc?.blocks?.find((block) => block.id === this.selectedBlockId) ?? null;
  }

  firstCommentForBlock(blockId) {
    const openComment = this.commentsForBlock(blockId, ["open"])[0] ?? null;
    if (openComment) return openComment;

    return this.commentsForBlock(blockId, ["accepted"])[0] ?? null;
  }

  commentsForBlock(blockId, statuses = ["open", "accepted"]) {
    const allowedStatuses = new Set(statuses);

    return this.sortComments(
      this.allComments.filter((comment) => (
        comment.blockId === blockId
        && !comment._broken
        && allowedStatuses.has(comment.status)
      )),
    );
  }

  highlights(blockId) {
    return this.commentsForBlock(blockId);
  }

  hydrateReview() {
    if (!this.doc || !this.review) return;
    const blocks = new Map(this.doc.blocks.map((b) => [b.id, b]));
    for (const c of this.review.comments) {
      delete c._broken;
      if (!["open", "accepted"].includes(c.status)) continue;
      const block = blocks.get(c.blockId);
      if (!block) { c._broken = true; continue; }
      if (Number.isInteger(c.start) && Number.isInteger(c.end) && block.text.slice(c.start, c.end) === c.quote) continue;
      const resolved = findUnique(block.text, c.quote);
      if (resolved) { c.start = resolved.start; c.end = resolved.end; }
      else { c._broken = true; }
    }
  }

  applyResult(doc, review) {
    const previousBlockId = this.selectedBlockId;
    const previousCommentId = this.selectedCommentId;

    this.doc = doc;
    this.review = review;
    this.hydrateReview();

    if (previousCommentId && this.allComments.some((comment) => comment.id === previousCommentId)) {
      this.selectComment(previousCommentId, { scroll: false });
      return;
    }

    if (previousBlockId && this.reviewableBlocks.some((block) => block.id === previousBlockId)) {
      this.selectBlock(previousBlockId, { scroll: false });
      return;
    }

    const firstComment = this.openCommentsInOrder[0] ?? this.visibleComments[0];

    if (firstComment) {
      this.selectComment(firstComment.id, { scroll: false });
      return;
    }

    this.selectedBlockId = this.reviewableBlocks[0]?.id ?? null;
    this.selectedCommentId = null;
    this.cancelSelectionScroll();
  }

  mergeStreamingComment(comment) {
    if (!this.review || !comment?.id) return;
    if (this.allComments.some((entry) => entry.id === comment.id)) return;

    this.review.comments = [...this.review.comments, comment];
    this.review.updatedAt = new Date().toISOString();
    this.hydrateReview();

    const shouldSelectCurrentBlock = !this.selectedCommentId && this.selectedBlockId === comment.blockId;
    const shouldSelectFirstComment = !this.selectedCommentId && this.visibleComments.length === 1;

    if (shouldSelectCurrentBlock || shouldSelectFirstComment) {
      this.selectComment(comment.id, {
        scroll: shouldSelectFirstComment && this.selectedBlockId !== comment.blockId,
      });
    }
  }

  markReviewFailed() {
    if (!this.review || this.reviewIsComplete) return;

    this.review.status = "failed";
    this.review.updatedAt = new Date().toISOString();

    if (!this.review.summary?.trim()) {
      this.review.summary = "Review stopped before completion. Partial suggestions remain visible.";
    }
  }

  toast(msg, error = false) {
    const id = crypto.randomUUID();
    this.toasts = [...this.toasts, { id, msg, error }];
    setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); }, 3000);
  }

  cancelSelectionScroll() {
    this.selectionScrollToken += 1;
    this.selectionScrolling = false;
  }

  scrollSelectionIntoView(blockId) {
    if (!blockId) {
      this.cancelSelectionScroll();
      return;
    }

    const token = ++this.selectionScrollToken;
    this.selectionScrolling = true;

    scrollBlockIntoView(blockId).finally(() => {
      if (token !== this.selectionScrollToken) return;
      this.selectionScrolling = false;
    });
  }

  navigate(dir) {
    const sorted = this.visibleComments;
    if (!sorted.length) return;
    const idx = sorted.findIndex((c) => c.id === this.selectedCommentId);
    const next = idx === -1 ? (dir === 1 ? 0 : sorted.length - 1) : (idx + dir + sorted.length) % sorted.length;
    this.selectComment(sorted[next].id);
  }

  selectNextOpenComment(anchorCommentId, { dir = 1, scroll = true } = {}) {
    const ordered = this.visibleComments;
    if (!ordered.length) return false;

    const anchorIndex = ordered.findIndex((comment) => comment.id === anchorCommentId);
    const start = anchorIndex === -1 ? (dir === 1 ? -1 : 0) : anchorIndex;

    for (let step = 1; step <= ordered.length; step += 1) {
      const index = (start + step * dir + ordered.length) % ordered.length;
      const candidate = ordered[index];
      if (candidate.status !== "open") continue;

      this.selectComment(candidate.id, { scroll });
      return true;
    }

    return false;
  }

  selectComment(commentId, { scroll = true } = {}) {
    if (!commentId) {
      this.selectedCommentId = null;
      this.cancelSelectionScroll();
      return;
    }

    const comment = this.allComments.find((entry) => entry.id === commentId) ?? null;
    this.selectedCommentId = commentId;

    if (!comment) {
      this.cancelSelectionScroll();
      return;
    }

    this.selectedBlockId = comment.blockId;
    if (scroll) this.scrollSelectionIntoView(comment.blockId);
    else this.cancelSelectionScroll();
  }

  selectBlock(blockId, { commentId = null, openFirstComment = true, scroll = true } = {}) {
    if (!blockId) {
      this.selectedBlockId = null;
      this.selectedCommentId = null;
      this.cancelSelectionScroll();
      return;
    }

    this.selectedBlockId = blockId;

    if (commentId) {
      this.selectedCommentId = commentId;
    } else if (openFirstComment) {
      this.selectedCommentId = this.firstCommentForBlock(blockId)?.id ?? null;
    }

    if (scroll) this.scrollSelectionIntoView(blockId);
    else this.cancelSelectionScroll();
  }

  navigateBlocks(dir) {
    const blocks = this.reviewableBlocks;
    if (!blocks.length) return null;

    const idx = blocks.findIndex((block) => block.id === this.selectedBlockId);
    const next = idx === -1
      ? (dir === 1 ? 0 : blocks.length - 1)
      : (idx + dir + blocks.length) % blocks.length;

    const target = blocks[next];
    this.selectBlock(target.id);
    return target;
  }

  beginBlockEdit(blockId = this.selectedBlockId) {
    const target = this.reviewableBlocks.find((block) => block.id === blockId);
    if (!target) return;

    this.selectedBlockId = target.id;
    this.selectedCommentId = null;
    this.editingBlockId = target.id;
    this.cancelSelectionScroll();
  }

  ensureValidMode() {
    const prompt = this.selectedPrompt;
    if (!prompt) return;
    const modes = prompt.modes?.length ? prompt.modes : ["paragraph", "at_once"];
    if (!modes.includes(this.selectedMode)) this.selectedMode = modes[0];
  }
}

export const app = new AppState();
