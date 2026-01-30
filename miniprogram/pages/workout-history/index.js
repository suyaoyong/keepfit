const { callCloud } = require("../../services/api");

Page({
  data: {
    records: [],
    loading: false,
    errorMessage: "",
  },

  onShow() {
    this.loadHistory();
  },

  async loadHistory() {
    this.setData({ loading: true, errorMessage: "" });
    try {
      const data = await callCloud("workout", { action: "history" });
      this.setData({ records: data || [] });
    } catch (error) {
      const message = error.message || "加载失败，请稍后重试";
      this.setData({ errorMessage: message });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
