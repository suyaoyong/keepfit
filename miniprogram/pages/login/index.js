const { callCloud } = require("../../services/api");

const USER_CACHE_KEY = "keepfit:user";

Page({
  data: {
    loading: false,
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
      wx.navigateTo({
        url: "/pages/plan-setup/index",
      });
    } catch (error) {
      const message = error?.message || "登录失败，请稍后重试";
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
