const { callCloud } = require("../../services/api");

Page({
  data: {
    bookId: "",
    chapterNo: 1,
    chapterTitle: "",
    bookTitle: "",
    contentHtml: "",
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
      this.setData({
        chapterTitle: chapter?.chapterTitle || `第${chapterNo}章`,
        contentHtml: chapter?.contentHtml || "",
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
