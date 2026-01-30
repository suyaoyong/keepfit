const { callCloud } = require("../../services/api");

Page({
  data: {
    progressItems: [],
    hasPlan: true,
  },

  onShow() {
    this.loadProgress();
  },

  async loadProgress() {
    try {
      const data = await callCloud("progress", { action: "get" });
      this.setData({
        progressItems: data.items || [],
        hasPlan: true,
      });
    } catch (error) {
      if ((error?.message || "").includes("未创建计划")) {
        this.setData({ hasPlan: false });
        return;
      }
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  onGoPlanSetup() {
    wx.navigateTo({ url: "/pages/plan-setup/index" });
  },

  onResetPlan() {
    wx.showModal({
      title: "确认重置计划",
      content: "将停用当前计划并清空本地计划信息，是否继续？",
      confirmText: "重置",
      cancelText: "取消",
      success: async (res) => {
        if (!res.confirm) {
          return;
        }
        try {
          await callCloud("plan", { action: "reset" });
          wx.removeStorageSync("activePlanId");
          wx.showToast({ title: "计划已重置", icon: "success" });
          wx.navigateTo({ url: "/pages/plan-setup/index" });
        } catch (error) {
          wx.showToast({ title: error.message || "重置失败", icon: "none" });
        }
      },
    });
  },

  onGoHistory() {
    wx.navigateTo({ url: "/pages/workout-history/index" });
  },
});
