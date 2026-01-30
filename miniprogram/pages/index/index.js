const PLAN_ID_KEY = "activePlanId";

Page({
  data: {
    hasPlan: false,
  },

  onShow() {
    const hasPlan = !!wx.getStorageSync(PLAN_ID_KEY);
    this.setData({ hasPlan });

    if (hasPlan) {
      wx.switchTab({
        url: "/pages/workout-today/index",
      });
      return;
    }

    wx.navigateTo({
      url: "/pages/plan-setup/index",
    });
  },

  onGoPlanSetup() {
    wx.navigateTo({
      url: "/pages/plan-setup/index",
    });
  },
});
