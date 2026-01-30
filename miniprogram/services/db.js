const COLLECTIONS = {
  AUTH: "auth",
  PROFILE: "profile",
  PLANS: "plans",
  PLAN_RULES: "plan_rules",
  METHODS: "methods",
  SCHEDULES: "schedules",
  WORKOUTS: "workouts",
  DIARIES: "diaries",
  PROGRESS: "progress",
};

function getDb() {
  if (!wx.cloud) {
    throw new Error("未检测到云能力，请检查基础库版本或云开发配置");
  }

  return wx.cloud.database();
}

module.exports = {
  COLLECTIONS,
  getDb,
};
