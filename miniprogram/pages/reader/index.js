const { callCloud } = require("../../services/api");

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
  },

  onLoad(query) {
    this.setData({
      bookId: String(query?.bookId || ""),
      chapterNo: Number(query?.chapterNo) || 1,
    });
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
      const parsed = parseContentBlocks(resolvedHtml);

      this.setData({
        chapterTitle: chapter?.chapterTitle || `第${chapterNo}章`,
        contentHtml: resolvedHtml,
        contentBlocks: parsed.blocks,
        imageUrls: parsed.imageUrls,
        bookTitle: detail?.book?.title || "阅读",
        scrollTopView: shouldRestoreScroll ? Number(progress.scrollTop) || 0 : 0,
      });
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
    const chapterNo = Number(this.data.chapterNo) || 1;
    this.saveProgress();
    this.setData({ chapterNo: chapterNo + 1, scrollTop: 0, scrollTopView: 0 }, () => {
      this.loadChapter();
    });
  },
});