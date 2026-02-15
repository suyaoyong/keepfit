Page({
  onShow() {
    wx.switchTab({
      url: "/pages/workout-today/index",
      fail: () => {
        wx.reLaunch({ url: "/pages/workout-today/index" });
      },
    });
  },
});
