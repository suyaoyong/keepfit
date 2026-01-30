const DEFAULT_ENV = "keepfit-1gddbzyaad583ad3";
const OPENID_CACHE_KEY = "keepfit:openid";

let cachedOpenId = null;
let openIdPromise = null;

function ensureCloudInit() {
  if (!wx.cloud) {
    throw new Error("未检测到云能力，请检查基础库版本或云开发配置");
  }

  const app = getApp?.();
  const env = app?.globalData?.env || DEFAULT_ENV;
  if (!app?.globalData?.cloudInited) {
    wx.cloud.init({ env, traceUser: true });
    if (app?.globalData) {
      app.globalData.cloudInited = true;
    }
  }
}

async function getOpenId() {
  if (cachedOpenId) {
    return cachedOpenId;
  }

  const stored = wx.getStorageSync(OPENID_CACHE_KEY);
  if (stored) {
    cachedOpenId = stored;
    return stored;
  }

  if (!openIdPromise) {
    openIdPromise = wx.cloud
      .callFunction({
        name: "auth",
        data: { action: "getOpenId" },
      })
      .then((res) => res?.result?.openid || res?.result?.openId || res?.result?.data?.openid)
      .finally(() => {
        openIdPromise = null;
      });
  }

  const openid = await openIdPromise;
  if (openid) {
    cachedOpenId = openid;
    wx.setStorageSync(OPENID_CACHE_KEY, openid);
  }
  return openid;
}

function normalizeError(res) {
  const message = res?.result?.error || "云函数调用失败";
  const err = new Error(message);
  err.detail = res?.result;
  return err;
}

async function callCloud(name, data = {}) {
  ensureCloudInit();

  const openid = await getOpenId();

  const res = await wx.cloud.callFunction({
    name,
    data: {
      ...data,
      _context: { openid },
    },
  });

  if (!res?.result || res.result.ok === false) {
    throw normalizeError(res);
  }

  return res.result.data ?? res.result;
}

module.exports = {
  callCloud,
  getOpenId,
  getTodayWorkout: async () => callCloud("workout", { action: "today" }),
  getSchedules: async (payload = {}) => callCloud("schedule", { action: "get", ...payload }),
  swapSchedule: async (payload = {}) => callCloud("schedule", { action: "swap", ...payload }),
};
