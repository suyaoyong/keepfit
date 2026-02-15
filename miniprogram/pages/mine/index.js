const { callCloud } = require("../../services/api");
const { convictStructure } = require("../../data/convict-structure");

const MINE_PROFILE_CACHE_KEY = "keepfit:mine:profile";
const MINE_PLAN_SNAPSHOT_CACHE_KEY = "keepfit:mine:planSnapshot";
const AI_PROFILE_KEY = "keepfit:ai:profile:v1";
const AI_PROFILE_EDIT_REQUEST_KEY = "keepfit:ai:profile:edit-request";
const AI_WEEKLY_TRAINING_OPTIONS = ["1-2天", "3-4天", "5天及以上"];
const AI_AGE_RANGE_OPTIONS = ["未填写", "18岁以下", "18-29岁", "30-39岁", "40岁及以上"];
const AI_GENDER_OPTIONS = ["未填写", "男", "女", "其他", "不透露"];
const AI_FATIGUE_OPTIONS = ["未填写", "低", "中", "高"];
const STAGE_TO_LEVEL = {
  初试身手: 1,
  渐入佳境: 2,
  炉火纯青: 3,
  闭关修炼: 4,
};

function buildDefaultAiProfile() {
  return {
    heightCm: "",
    weightKg: "",
    weeklyTrainingDays: "",
    ageRange: "",
    gender: "",
    injuryNotes: "",
    fatigueLevel: "",
    trainingPreference: "",
  };
}

function pad2(value) {
  return `${value}`.padStart(2, "0");
}

function buildTimestamp(date = new Date()) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(
    date.getHours()
  )}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

const EXERCISE_NAME_MAP = convictStructure.reduce((acc, item) => {
  acc[item.id] = item.name;
  return acc;
}, {});

function resolveExerciseName(item) {
  const id = String(item?.exerciseId || "").trim();
  return EXERCISE_NAME_MAP[id] || item?.exerciseName || id || "未知动作";
}

function csvEscape(value) {
  const raw = String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

function buildExportRows(workouts = [], diaries = []) {
  const workoutRows = (workouts || []).map((item) => ({
    date: item?.date || "",
    source: "训练记录",
    type: "六艺",
    actionName: resolveExerciseName(item),
    sets: Number(item?.sets) || 0,
    reps: Number(item?.reps) || 0,
    duration: "",
    notes: item?.notes || "",
  }));

  const diaryRows = (diaries || []).map((item) => {
    const isOther = item?.recordType === "other";
    return {
      date: item?.date || "",
      source: "训练日记",
      type: isOther ? "其他训练" : "六艺",
      actionName: isOther ? item?.activityName || "其他训练" : resolveExerciseName(item),
      sets: isOther ? "" : Number(item?.sets) || 0,
      reps: isOther ? "" : Number(item?.reps) || 0,
      duration: isOther ? Number(item?.duration) || 0 : "",
      notes: item?.notes || "",
    };
  });

  return workoutRows
    .concat(diaryRows)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function toCsvContent(rows) {
  const header = ["日期", "来源", "类型", "动作/项目", "组数", "次数", "时长(分钟)", "备注"];
  const lines = [header.map(csvEscape).join(",")];
  rows.forEach((row) => {
    const line = [
      row.date,
      row.source,
      row.type,
      row.actionName,
      row.sets,
      row.reps,
      row.duration,
      row.notes,
    ]
      .map(csvEscape)
      .join(",");
    lines.push(line);
  });
  return lines.join("\n");
}

function buildIdentityFromStage(stageName) {
  const normalized = stageName || "初试身手";
  const level = STAGE_TO_LEVEL[normalized] || 1;
  return {
    identityStageName: normalized,
    identityLevelText: `Lv${level} 训练者`,
  };
}

function buildAiProfileSummary(profile) {
  const data = profile && typeof profile === "object" ? profile : {};
  const requiredDone = Boolean(data.heightCm && data.weightKg && data.weeklyTrainingDays);
  const requiredText = requiredDone
    ? `必填已完成：${data.heightCm}cm / ${data.weightKg}kg / ${data.weeklyTrainingDays}`
    : "必填未完成：请补充个人训练基础资料（身高、体重、每周可训练天数）";
  const optionalParts = [
    data.ageRange ? `年龄段：${data.ageRange}` : "",
    data.gender ? `性别：${data.gender}` : "",
    data.fatigueLevel ? `疲劳：${data.fatigueLevel}` : "",
  ].filter(Boolean);
  return {
    requiredDone,
    requiredText,
    optionalText: optionalParts.join("，") || "可在本页补充年龄、性别、疲劳等信息",
  };
}

Page({
  data: {
    loading: false,
    profile: {
      nickName: "未登录",
      avatarUrl: "",
      status: "guest",
    },
    coreEntries: [
      { id: "plan", title: "计划设置", desc: "创建/调整训练计划", action: "goPlanSetup" },
      { id: "history", title: "训练历史", desc: "查看完整训练历史", action: "goHistory" },
    ],
    supportEntries: [
      { id: "ai", title: "训练基础资料", desc: "编辑个人训练基础资料（必填/选填）", action: "goAiProfile" },
      { id: "data", title: "数据与隐私", desc: "导出/清理本地数据", action: "openDataPrivacy" },
      { id: "version", title: "版本与更新说明", desc: "查看当前版本与本次更新", action: "showVersionNotes" },
    ],
    aiProfileSummary: {
      requiredDone: false,
      requiredText: "必填未完成：请补充个人训练基础资料（身高、体重、每周可训练天数）",
      optionalText: "可在本页补充年龄、性别、疲劳等信息",
    },
    aiProfile: buildDefaultAiProfile(),
    aiWeeklyTrainingOptions: AI_WEEKLY_TRAINING_OPTIONS,
    aiAgeRangeOptions: AI_AGE_RANGE_OPTIONS,
    aiGenderOptions: AI_GENDER_OPTIONS,
    aiFatigueOptions: AI_FATIGUE_OPTIONS,
    showAiProfileModal: false,
    planSnapshot: {
      loaded: false,
      hasPlan: false,
      planName: "",
      stageName: "",
      scheduleType: "",
      weeklySessions: 0,
    },
    identityStageName: "初试身手",
    identityLevelText: "Lv1 训练者",
  },

  onShow() {
    this.hydrateFromCache();
    this.loadAiProfile();
    this.loadAiProfileSummary();
    this.loadProfile();
    this.loadPlanSnapshot();

    const openEditor = Boolean(wx.getStorageSync(AI_PROFILE_EDIT_REQUEST_KEY));
    if (openEditor) {
      wx.removeStorageSync(AI_PROFILE_EDIT_REQUEST_KEY);
      this.setData({ showAiProfileModal: true });
    }
  },

  hydrateFromCache() {
    const cachedProfile = wx.getStorageSync(MINE_PROFILE_CACHE_KEY);
    const cachedSnapshot = wx.getStorageSync(MINE_PLAN_SNAPSHOT_CACHE_KEY);
    const nextData = {};

    if (cachedProfile && typeof cachedProfile === "object") {
      nextData.profile = {
        nickName: cachedProfile.nickName || "未登录",
        avatarUrl: cachedProfile.avatarUrl || "",
        status: cachedProfile.status || "guest",
      };
    }

    if (cachedSnapshot && typeof cachedSnapshot === "object") {
      nextData.planSnapshot = {
        loaded: true,
        hasPlan: Boolean(cachedSnapshot.hasPlan),
        planName: cachedSnapshot.planName || "",
        stageName: cachedSnapshot.stageName || "",
        scheduleType: cachedSnapshot.scheduleType || "",
        weeklySessions: Number(cachedSnapshot.weeklySessions) || 0,
      };
      Object.assign(nextData, buildIdentityFromStage(nextData.planSnapshot.stageName));
    }

    if (Object.keys(nextData).length) {
      this.setData(nextData);
    }
  },

  async loadProfile() {
    this.setData({ loading: true });
    try {
      const data = await callCloud("auth", { action: "profile" });
      const profile = {
        nickName: data?.nickName || "未登录",
        avatarUrl: data?.avatarUrl || "",
        status: data?.status || "guest",
      };
      this.setData({ profile });
      wx.setStorageSync(MINE_PROFILE_CACHE_KEY, profile);
    } catch (error) {
      wx.showToast({ title: error?.message || "加载用户信息失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onTapCoreEntry(event) {
    const action = event.currentTarget.dataset.action;
    if (!action || typeof this[action] !== "function") {
      return;
    }
    this[action]();
  },

  goPlanSetup() {
    wx.navigateTo({ url: "/pages/plan-setup/index" });
  },

  goHistory() {
    wx.navigateTo({ url: "/pages/workout-history/index" });
  },

  goAiProfile() {
    this.setData({ showAiProfileModal: true });
  },

  loadAiProfile() {
    const stored = wx.getStorageSync(AI_PROFILE_KEY);
    if (!stored || typeof stored !== "object") {
      this.setData({ aiProfile: buildDefaultAiProfile() });
      return;
    }
    this.setData({
      aiProfile: {
        ...buildDefaultAiProfile(),
        ...stored,
      },
    });
  },

  onAiProfileInput(event) {
    const field = event?.currentTarget?.dataset?.field;
    if (!field) {
      return;
    }
    this.setData({ [`aiProfile.${field}`]: String(event?.detail?.value || "") });
  },

  onAiProfilePickerChange(event) {
    const field = event?.currentTarget?.dataset?.field;
    const index = Number(event?.detail?.value);
    const optionMap = {
      weeklyTrainingDays: AI_WEEKLY_TRAINING_OPTIONS,
      ageRange: AI_AGE_RANGE_OPTIONS,
      gender: AI_GENDER_OPTIONS,
      fatigueLevel: AI_FATIGUE_OPTIONS,
    };
    const options = optionMap[field];
    if (!field || !Array.isArray(options) || !Number.isFinite(index) || !options[index]) {
      return;
    }
    const nextValue = options[index] === "未填写" ? "" : options[index];
    this.setData({ [`aiProfile.${field}`]: nextValue });
  },

  saveAiProfile() {
    const profile = {
      ...buildDefaultAiProfile(),
      ...this.data.aiProfile,
    };
    wx.setStorageSync(AI_PROFILE_KEY, profile);
    this.setData({ aiProfileSummary: buildAiProfileSummary(profile) });
    return profile;
  },

  onSaveAiProfile() {
    this.saveAiProfile();
    this.setData({ showAiProfileModal: false });
    wx.showToast({ title: "训练基础资料已保存", icon: "success" });
  },

  onCloseAiProfileModal() {
    this.setData({ showAiProfileModal: false });
  },

  loadAiProfileSummary() {
    const stored = wx.getStorageSync(AI_PROFILE_KEY);
    this.setData({ aiProfileSummary: buildAiProfileSummary(stored) });
  },

  async loadPlanSnapshot() {
    try {
      const [plan, progress] = await Promise.all([
        callCloud("plan", { action: "current" }),
        callCloud("progress", { action: "get" }).catch(() => null),
      ]);

      const scheduleTypeMap = {
        week: "周排期",
        month: "月排期",
        calendar: "日历排期",
      };

      const planSnapshot = {
        loaded: true,
        hasPlan: true,
        planName: plan?.planName || "未命名计划",
        stageName: progress?.stageName || "初试身手",
        scheduleType: scheduleTypeMap[plan?.scheduleType] || "未设置",
        weeklySessions: Number(plan?.weeklySessions) || 0,
      };
      const identity = buildIdentityFromStage(planSnapshot.stageName);

      this.setData({ planSnapshot, ...identity });
      wx.setStorageSync(MINE_PLAN_SNAPSHOT_CACHE_KEY, planSnapshot);
    } catch (error) {
      const planSnapshot = {
        loaded: true,
        hasPlan: false,
        planName: "",
        stageName: "",
        scheduleType: "",
        weeklySessions: 0,
      };
      const identity = buildIdentityFromStage("初试身手");
      this.setData({ planSnapshot, ...identity });
      wx.setStorageSync(MINE_PLAN_SNAPSHOT_CACHE_KEY, planSnapshot);
    }
  },

  onTapSupportEntry(event) {
    const action = event.currentTarget.dataset.action;
    if (!action || typeof this[action] !== "function") {
      return;
    }
    this[action]();
  },

  openDataPrivacy() {
    wx.showActionSheet({
      itemList: ["导出训练数据（CSV）", "清空本地缓存"],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.exportTrainingData();
          return;
        }
        wx.showModal({
          title: "清空本地缓存",
          content: "将清除本地缓存数据（不删除云端训练记录），是否继续？",
          confirmText: "确认清空",
          cancelText: "取消",
          success: (modalRes) => {
            if (!modalRes.confirm) {
              return;
            }
            wx.clearStorageSync();
            wx.showToast({ title: "本地缓存已清空", icon: "success" });
          },
        });
      },
    });
  },

  async exportTrainingData() {
    wx.showLoading({ title: "正在导出" });
    try {
      const [currentPlan, workouts, diaries] = await Promise.all([
        callCloud("plan", { action: "current" }).catch(() => null),
        callCloud("workout", { action: "history" }).catch(() => []),
        callCloud("diary", { action: "history", limit: 500 }).catch(() => []),
      ]);

      const payload = {
        exportedAt: new Date().toISOString(),
        user: {
          nickName: this.data.profile.nickName || "",
          status: this.data.profile.status || "",
        },
        profile: {},
        currentPlan: currentPlan || null,
        workoutHistory: workouts || [],
        diaryHistory: diaries || [],
      };

      const rows = buildExportRows(workouts || [], diaries || []);
      const csvContent = toCsvContent(rows);

      const fs = wx.getFileSystemManager();
      const stamp = buildTimestamp();
      const csvPath = `${wx.env.USER_DATA_PATH}/keepfit-training-export-${stamp}.csv`;
      const jsonPath = `${wx.env.USER_DATA_PATH}/keepfit-training-export-${stamp}.json`;
      fs.writeFileSync(csvPath, csvContent, "utf8");
      fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

      wx.hideLoading();
      wx.showToast({ title: "导出成功", icon: "success" });
      wx.openDocument({
        filePath: csvPath,
        showMenu: true,
        fail: () => {
          wx.showModal({
            title: "导出完成",
            content: `已生成导出文件：\n1) 可读版 CSV：${csvPath}\n2) 备份 JSON：${jsonPath}\n\n若未自动打开，可在开发者工具文件面板查看。`,
            showCancel: false,
          });
        },
      });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error?.message || "导出失败", icon: "none" });
    }
  },

  showVersionNotes() {
    wx.showModal({
      title: "版本与更新说明",
      content:
        "当前版本：v2026.02.10\n\n本次更新：\n1. 最近记录与训练历史改为按天汇总。\n2. AI总结支持六字段并可直接触发。\n3. 我的页面精简为核心入口。",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  noop() {},
});

