const { callCloud } = require("../../services/api");
const { MAX_METHOD_LEVEL, normalizeMethodLevel } = require("../../data/method-sections");

const CHINESE_LEVEL_MARKERS = [
  "第一式",
  "第二式",
  "第三式",
  "第四式",
  "第五式",
  "第六式",
  "第七式",
  "第八式",
  "第九式",
  "第十式",
];

function getLevelMarkerCandidates(level) {
  const normalized = normalizeMethodLevel(level);
  const base = CHINESE_LEVEL_MARKERS[normalized - 1];
  const candidates = [base];
  if (normalized === 10) {
    candidates.push("最终式");
  }
  return candidates.filter(Boolean);
}

function hasAnyMarker(text, markers) {
  const source = String(text || "");
  return markers.some(
    (marker) =>
      source.includes(marker) || source.includes(`${marker}-`) || source.includes(`${marker}—`)
  );
}

function startsWithAnyMarker(text, markers) {
  const source = String(text || "");
  return markers.some((marker) => source.startsWith(marker));
}

function isUsefulSectionStart(paragraphs, startIndex) {
  const maxLookahead = Math.min(paragraphs.length - 1, startIndex + 3);
  for (let i = startIndex; i <= maxLookahead; i += 1) {
    if (String(paragraphs[i]?.plain || "").startsWith("动作")) {
      return true;
    }
  }
  return false;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCloudFileIdsFromHtml(contentHtml) {
  const html = String(contentHtml || "");
  const re = /<img[^>]+src=["'](cloud:\/\/[^"']+)["']/gi;
  const ids = [];
  let match = null;
  while ((match = re.exec(html))) {
    if (match[1]) {
      ids.push(match[1]);
    }
  }
  return Array.from(new Set(ids));
}

async function getTempUrlMap(fileIds) {
  if (!Array.isArray(fileIds) || !fileIds.length) {
    return {};
  }

  const result = {};
  const chunkSize = 50;
  for (let i = 0; i < fileIds.length; i += chunkSize) {
    const chunk = fileIds.slice(i, i + chunkSize);
    // eslint-disable-next-line no-await-in-loop
    const res = await wx.cloud.getTempFileURL({ fileList: chunk });
    const list = (res && res.fileList) || [];
    list.forEach((item) => {
      const fileID = item && item.fileID;
      const tempFileURL = item && item.tempFileURL;
      if (fileID && tempFileURL) {
        result[fileID] = tempFileURL;
      }
    });
  }

  return result;
}

function replaceCloudSrcWithTempUrls(contentHtml, urlMap) {
  let html = String(contentHtml || "");
  Object.keys(urlMap || {}).forEach((fileId) => {
    const tempUrl = urlMap[fileId];
    if (!tempUrl) {
      return;
    }
    html = html.replace(new RegExp(escapeRegExp(fileId), "g"), tempUrl);
  });
  return html;
}

function parseContentBlocks(contentHtml) {
  const html = String(contentHtml || "");
  const blocks = [];
  const imageUrls = [];

  const pRe = /<p>([\s\S]*?)<\/p>/gi;
  let match = null;
  while ((match = pRe.exec(html))) {
    const inner = String(match[1] || "").trim();
    if (!inner) {
      continue;
    }

    const imgMatch = inner.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    if (imgMatch && imgMatch[1]) {
      const src = String(imgMatch[1]);
      const altMatch = inner.match(/alt=["']([^"']*)["']/i);
      const alt = altMatch ? String(altMatch[1]) : "插图";
      blocks.push({ type: "image", src, alt });
      imageUrls.push(src);
      continue;
    }

    blocks.push({ type: "text", html: `<p>${inner}</p>` });
  }

  if (!blocks.length && html) {
    blocks.push({ type: "text", html });
  }

  return {
    blocks,
    imageUrls: Array.from(new Set(imageUrls)),
  };
}

function stripHtmlTags(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function extractMethodSectionHtml(contentHtml, level) {
  const html = String(contentHtml || "");
  const targetLevel = normalizeMethodLevel(level);
  const targetMarkers = getLevelMarkerCandidates(targetLevel);
  const nextMarkers = targetLevel < MAX_METHOD_LEVEL ? getLevelMarkerCandidates(targetLevel + 1) : [];
  const paragraphs = [];

  const pRe = /<p>[\s\S]*?<\/p>/gi;
  let match = null;
  while ((match = pRe.exec(html))) {
    const full = String(match[0] || "");
    paragraphs.push({
      full,
      plain: stripHtmlTags(full),
    });
  }

  if (!paragraphs.length) {
    return html;
  }

  let startIndex = -1;
  for (let i = 0; i < paragraphs.length; i += 1) {
    if (startsWithAnyMarker(paragraphs[i].plain, targetMarkers) && isUsefulSectionStart(paragraphs, i)) {
      startIndex = i;
      break;
    }
  }
  if (startIndex < 0) {
    for (let i = 0; i < paragraphs.length; i += 1) {
      if (hasAnyMarker(paragraphs[i].plain, targetMarkers) && isUsefulSectionStart(paragraphs, i)) {
        startIndex = i;
        break;
      }
    }
  }
  if (startIndex < 0) {
    return html;
  }

  let endIndex = paragraphs.length;
  if (nextMarkers.length) {
    for (let i = startIndex + 1; i < paragraphs.length; i += 1) {
      if (startsWithAnyMarker(paragraphs[i].plain, nextMarkers)) {
        endIndex = i;
        break;
      }
    }
  }

  const section = paragraphs.slice(startIndex, endIndex).map((item) => item.full).join("");
  return section || html;
}

Page({
  data: {
    bookId: "",
    chapterNo: 1,
    chapterTitle: "",
    bookTitle: "",
    contentHtml: "",
    contentBlocks: [],
    imageUrls: [],
    loading: false,
    errorMessage: "",
    scrollTop: 0,
    scrollTopView: 0,
    mode: "book",
    methodLevel: 1,
    prevDisabled: false,
    nextDisabled: false,
    prevLabel: "上一章",
    nextLabel: "下一章",
  },

  onLoad(query) {
    const mode = String(query?.mode || "").trim() === "method" ? "method" : "book";
    const methodLevel = normalizeMethodLevel(query?.level || 1);
    this.setData(
      {
        bookId: String(query?.bookId || ""),
        chapterNo: Number(query?.chapterNo) || 1,
        mode,
        methodLevel,
      },
      () => {
        this.updateNavState();
      }
    );
  },

  onShow() {
    this.loadChapter();
  },

  onHide() {
    this.saveProgress();
  },

  onUnload() {
    this.saveProgress();
  },

  updateNavState() {
    if (this.data.mode === "method") {
      const level = normalizeMethodLevel(this.data.methodLevel);
      this.setData({
        prevDisabled: level <= 1,
        nextDisabled: level >= MAX_METHOD_LEVEL,
        prevLabel: "上一式",
        nextLabel: "下一式",
      });
      return;
    }

    this.setData({
      prevDisabled: Number(this.data.chapterNo) <= 1,
      nextDisabled: false,
      prevLabel: "上一章",
      nextLabel: "下一章",
    });
  },

  async resolveChapterHtml(rawHtml) {
    const html = String(rawHtml || "");
    const cloudFileIds = extractCloudFileIdsFromHtml(html);
    if (!cloudFileIds.length) {
      return html;
    }

    try {
      const map = await getTempUrlMap(cloudFileIds);
      return replaceCloudSrcWithTempUrls(html, map);
    } catch (error) {
      return html;
    }
  },

  async loadChapter() {
    const { bookId, chapterNo } = this.data;
    if (!bookId || !chapterNo) {
      this.setData({ errorMessage: "参数缺失" });
      return;
    }

    this.setData({ loading: true, errorMessage: "" });
    try {
      const [chapter, detail] = await Promise.all([
        callCloud("library", { action: "getChapter", bookId, chapterNo }),
        callCloud("library", { action: "getBookDetail", bookId }).catch(() => null),
      ]);

      const progress = detail?.progress || null;
      const shouldRestoreScroll = progress && Number(progress.chapterNo) === chapterNo;
      const resolvedHtml = await this.resolveChapterHtml(chapter?.contentHtml || "");
      const finalHtml =
        this.data.mode === "method"
          ? extractMethodSectionHtml(resolvedHtml, this.data.methodLevel)
          : resolvedHtml;
      const parsed = parseContentBlocks(finalHtml);

      const baseTitle = chapter?.chapterTitle || `第${chapterNo}章`;
      const levelLabel = `第${normalizeMethodLevel(this.data.methodLevel)}式`;
      const chapterTitle =
        this.data.mode === "method" ? `${baseTitle} · ${levelLabel}` : baseTitle;

      this.setData({
        chapterTitle,
        contentHtml: finalHtml,
        contentBlocks: parsed.blocks,
        imageUrls: parsed.imageUrls,
        bookTitle: detail?.book?.title || "阅读",
        scrollTopView:
          this.data.mode === "method" ? 0 : shouldRestoreScroll ? Number(progress.scrollTop) || 0 : 0,
      });
      this.updateNavState();
    } catch (error) {
      this.setData({ errorMessage: error?.message || "章节加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onReaderScroll(event) {
    const top = Number(event?.detail?.scrollTop) || 0;
    this.setData({ scrollTop: top });
  },

  onPreviewImage(event) {
    const current = String(event?.currentTarget?.dataset?.src || "");
    const urls = this.data.imageUrls || [];
    if (!current || !urls.length) {
      return;
    }

    wx.previewImage({ current, urls });
  },

  async saveProgress() {
    if (this.data.mode === "method") {
      return;
    }

    const { bookId, chapterNo, scrollTop } = this.data;
    if (!bookId || !chapterNo) {
      return;
    }

    try {
      await callCloud("library", {
        action: "saveProgress",
        bookId,
        chapterNo,
        scrollTop,
      });
    } catch (error) {
      // ignore save failures
    }
  },

  onPrevChapter() {
    if (this.data.prevDisabled) {
      return;
    }

    if (this.data.mode === "method") {
      const nextLevel = normalizeMethodLevel(this.data.methodLevel - 1);
      this.setData({ methodLevel: nextLevel, scrollTop: 0, scrollTopView: 0 }, () => {
        this.loadChapter();
      });
      return;
    }

    const chapterNo = Number(this.data.chapterNo) || 1;
    if (chapterNo <= 1) {
      return;
    }

    this.saveProgress();
    this.setData({ chapterNo: chapterNo - 1, scrollTop: 0, scrollTopView: 0 }, () => {
      this.loadChapter();
    });
  },

  onNextChapter() {
    if (this.data.nextDisabled) {
      return;
    }

    if (this.data.mode === "method") {
      const nextLevel = normalizeMethodLevel(this.data.methodLevel + 1);
      this.setData({ methodLevel: nextLevel, scrollTop: 0, scrollTopView: 0 }, () => {
        this.loadChapter();
      });
      return;
    }

    const chapterNo = Number(this.data.chapterNo) || 1;
    this.saveProgress();
    this.setData({ chapterNo: chapterNo + 1, scrollTop: 0, scrollTopView: 0 }, () => {
      this.loadChapter();
    });
  },
});
