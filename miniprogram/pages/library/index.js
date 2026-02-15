const { callCloud } = require("../../services/api");

Page({
  data: {
    loading: false,
    errorMessage: "",
    books: [],
  },

  onShow() {
    this.loadBooks();
  },

  async loadBooks() {
    this.setData({ loading: true, errorMessage: "" });
    try {
      const result = await callCloud("library", { action: "listBooks" });
      this.setData({ books: result?.books || [] });
    } catch (error) {
      this.setData({ errorMessage: error?.message || "加载书库失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onOpenBook(event) {
    const bookId = event?.currentTarget?.dataset?.bookId;
    if (!bookId) {
      return;
    }
    wx.navigateTo({ url: `/pages/book-detail/index?bookId=${encodeURIComponent(bookId)}` });
  },
});
