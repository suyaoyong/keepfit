const { callCloud } = require("../../services/api");

Page({
  data: {
    bookId: "",
    loading: false,
    errorMessage: "",
    book: null,
    chapters: [],
    progress: null,
  },

  onLoad(query) {
    this.setData({ bookId: String(query?.bookId || "") });
  },

  onShow() {
    this.loadDetail();
  },

  async loadDetail() {
    const bookId = this.data.bookId;
    if (!bookId) {
      this.setData({ errorMessage: "缺少 bookId" });
      return;
    }

    this.setData({ loading: true, errorMessage: "" });
    try {
      const result = await callCloud("library", { action: "getBookDetail", bookId });
      this.setData({
        book: result?.book || null,
        chapters: result?.chapters || [],
        progress: result?.progress || null,
      });
    } catch (error) {
      this.setData({ errorMessage: error?.message || "加载目录失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onOpenChapter(event) {
    const chapterNo = Number(event?.currentTarget?.dataset?.no);
    if (!Number.isFinite(chapterNo) || chapterNo <= 0) {
      return;
    }
    wx.navigateTo({ url: `/pages/reader/index?bookId=${encodeURIComponent(this.data.bookId)}&chapterNo=${chapterNo}` });
  },

  onContinueRead() {
    const chapterNo = Number(this.data.progress?.chapterNo) || 1;
    wx.navigateTo({ url: `/pages/reader/index?bookId=${encodeURIComponent(this.data.bookId)}&chapterNo=${chapterNo}` });
  },
});
