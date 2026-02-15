// app.js
const { callCloud } = require("./services/api");
const { getCache, setCache, isPaidEnabled } = require("./services/cache");

const FIRST_LAUNCH_KEY = "trial:firstLaunchAt";
const TRIAL_DAYS = 30;

function daysBetween(startTimestamp, endTimestamp) {
  const diffMs = endTimestamp - startTimestamp;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

App({
  onLaunch: async function () {
    this.globalData = {
      env: "keepfit-1gddbzyaad583ad3",
    };

    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }

    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true,
    });

    await this.ensureTrialState();
    await this.redirectOnLaunch();
  },

  onPageNotFound() {
    // Fallback for stale launch/deeplink paths (e.g. removed index page).
    wx.switchTab({
      url: "/pages/workout-today/index",
      fail: () => {
        wx.reLaunch({ url: "/pages/workout-today/index" });
      },
    });
  },

  async ensureTrialState() {
    const now = Date.now();
    const first = getCache(FIRST_LAUNCH_KEY, 0);
    if (!first) {
      setCache(FIRST_LAUNCH_KEY, now);
      return;
    }

    if (!isPaidEnabled()) {
      return;
    }

    const days = daysBetween(first, now);
    if (days >= TRIAL_DAYS) {
      wx.setStorageSync("paywall:expired", true);
    }
  },

  async redirectOnLaunch() {
    try {
      const auth = await callCloud("auth", { action: "profile" });
      const hasLogin = Boolean(auth?.status && auth.status !== "guest");
      if (!hasLogin) {
        return;
      }

      const plan = await callCloud("plan", { action: "current" });
      if (plan?.planId) {
        wx.switchTab({ url: "/pages/workout-today/index" });
        return;
      }

      wx.navigateTo({ url: "/pages/plan-setup/index" });
    } catch (error) {
      // keep default entry
    }
  },
});
