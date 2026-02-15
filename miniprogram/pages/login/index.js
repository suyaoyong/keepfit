const { callCloud } = require("../../services/api");

const USER_CACHE_KEY = "keepfit:user";
const AI_SUMMARY_PENDING_KEY = "keepfit:ai:summary:pending";
const AI_SUMMARY_LOGIN_CANCELLED_KEY = "keepfit:ai:summary:login-cancelled";

Page({
  data: {
    loading: false,
    isAiSummaryScene: false,
  },

  onLoad(options = {}) {
    this.setData({
      isAiSummaryScene: String(options.scene || "") === "ai-summary",
    });
  },

  finishAiSummaryReturn() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.switchTab({ url: "/pages/progress/index" });
  },

  async handleLogin() {
    if (this.data.loading) {
      return;
    }

    this.setData({ loading: true });

    try {
      const profile = await new Promise((resolve, reject) => {
        wx.getUserProfile({
          desc: "用于创建训练档案与同步训练进度",
          success: (res) => resolve(res.userInfo || {}),
          fail: reject,
        });
      });

      const result = await callCloud("auth", {
        action: "login",
        profile,
        scope: "userInfo",
        status: "authorized",
      });

      wx.setStorageSync(USER_CACHE_KEY, result);
      if (this.data.isAiSummaryScene) {
        wx.setStorageSync(AI_SUMMARY_PENDING_KEY, true);
        wx.removeStorageSync(AI_SUMMARY_LOGIN_CANCELLED_KEY);
        this.finishAiSummaryReturn();
        return;
      }

      wx.navigateTo({
        url: "/pages/plan-setup/index",
      });
    } catch (error) {
      const errorText = `${error?.errMsg || error?.message || ""}`.toLowerCase();
      const denied = errorText.includes("deny") || errorText.includes("cancel");
      if (this.data.isAiSummaryScene && denied) {
        wx.removeStorageSync(AI_SUMMARY_PENDING_KEY);
        wx.setStorageSync(AI_SUMMARY_LOGIN_CANCELLED_KEY, true);
        this.finishAiSummaryReturn();
        return;
      }

      const message = error?.message || "登录失败，请稍后重试";
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
