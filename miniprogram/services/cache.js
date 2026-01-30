const CACHE_PREFIX = "keepfit:";
const PAYWALL_FLAG_KEY = "paywall:enabled";

function makeKey(key) {
  return `${CACHE_PREFIX}${key}`;
}

function setCache(key, value) {
  wx.setStorageSync(makeKey(key), value);
}

function getCache(key, fallback = null) {
  const value = wx.getStorageSync(makeKey(key));
  return value === "" || value === undefined ? fallback : value;
}

function removeCache(key) {
  wx.removeStorageSync(makeKey(key));
}

function setPaidEnabled(enabled) {
  setCache(PAYWALL_FLAG_KEY, Boolean(enabled));
}

function isPaidEnabled() {
  return Boolean(getCache(PAYWALL_FLAG_KEY, false));
}

module.exports = {
  setCache,
  getCache,
  removeCache,
  setPaidEnabled,
  isPaidEnabled,
};
