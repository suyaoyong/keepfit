const { callCloud, ensureCloudInit, getAuthProfile } = require("../../services/api");
const { convictStructure } = require("../../data/convict-structure");

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const ALLOWED_AI_FIELDS = [
  "summary",
  "consistency",
  "volumeTrend",
  "strengthFocus",
  "extraTrainingInsight",
  "planFocus",
];
const BLOCKED_PATTERNS = [
  /医疗/i,
  /诊断/i,
  /处方/i,
  /药物/i,
  /康复治疗/i,
  /手术/i,
  /病症/i,
  /你患有/i,
  /必须停止训练/i,
  /超出计划/i,
];

const DEFAULT_AI_RESULT = {
  summary: "",
  consistency: "",
  volumeTrend: "",
  strengthFocus: "",
  extraTrainingInsight: "",
  planFocus: "",
};

const EXERCISE_NAME_MAP = convictStructure.reduce((acc, item) => {
  acc[item.id] = item.name;
  return acc;
}, {});
const PROGRESS_MONTH_CACHE_PREFIX = "keepfit:progress:month:";
const AI_PROFILE_KEY = "keepfit:ai:profile:v1";
const AI_SUMMARY_PENDING_KEY = "keepfit:ai:summary:pending";
const AI_SUMMARY_LOGIN_CANCELLED_KEY = "keepfit:ai:summary:login-cancelled";
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

function pad2(value) {
  return `${value}`.padStart(2, "0");
}

function toDateString(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message || "请求超时")), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function safeParseJson(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      return null;
    }
  }
}

function normalizeRepsPerSet(item) {
  if (Array.isArray(item?.repsPerSet) && item.repsPerSet.length) {
    return item.repsPerSet.map((value) => Number(value) || 0).filter((value) => value > 0);
  }
  const sets = Number(item?.sets) || 0;
  const reps = Number(item?.reps) || 0;
  if (sets > 0 && reps > 0) {
    return Array.from({ length: sets }, () => reps);
  }
  return [];
}

function normalizeHistoryItem(item) {
  const repsPerSet = normalizeRepsPerSet(item);
  const exerciseId = item?.exerciseId || "";
  const displayName = EXERCISE_NAME_MAP[exerciseId] || item?.exerciseName || exerciseId;
  return {
    date: item?.date || "",
    exerciseId,
    exerciseName: displayName,
    sets: Number(item?.sets) || repsPerSet.length,
    repsPerSet,
    repsPerSetText: repsPerSet.join(" / "),
    recordType: "exercise",
  };
}

function normalizeDiaryItem(item) {
  if (item?.recordType === "other") {
    const duration = Number(item?.duration) || 0;
    return {
      date: item?.date || "",
      exerciseId: "other",
      exerciseName: item?.activityName || "其他训练",
      sets: duration ? 1 : 0,
      repsPerSet: duration ? [duration] : [],
      repsPerSetText: duration ? `${duration}分钟` : "-",
      recordType: "other",
    };
  }
  return normalizeHistoryItem(item);
}

function buildDaySummaryMap(records) {
  return records.reduce((acc, item) => {
    if (!item?.date) {
      return acc;
    }
    if (!acc[item.date]) {
      acc[item.date] = [];
    }
    acc[item.date].push(item);
    return acc;
  }, {});
}

function aggregateDailyRecords(records, limit = 5) {
  const grouped = records.reduce((acc, item) => {
    if (!item?.date) {
      return acc;
    }
    if (!acc[item.date]) {
      acc[item.date] = [];
    }
    acc[item.date].push(item);
    return acc;
  }, {});

  const dates = Object.keys(grouped).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return dates.slice(0, limit).map((date) => {
    const items = grouped[date];
    const parts = items.map((entry) => {
      if (entry.recordType === "other") {
        return `${entry.exerciseName}${entry.repsPerSetText ? ` ${entry.repsPerSetText}` : ""}`;
      }
      return `${entry.exerciseName} ${entry.sets}组×${entry.repsPerSetText || "-"}`;
    });
    return {
      date,
      summaryText: parts.join("；"),
      count: items.length,
    };
  });
}

function buildMonthText(year, month) {
  return `${year}-${pad2(month)}`;
}

function buildMonthCacheKey(monthText) {
  return `${PROGRESS_MONTH_CACHE_PREFIX}${monthText}`;
}

function getMonthDateRange(year, month) {
  const monthText = buildMonthText(year, month);
  const endDay = new Date(year, month, 0).getDate();
  return {
    dateFrom: `${monthText}-01`,
    dateTo: `${monthText}-${pad2(endDay)}`,
  };
}

function isDateInRange(date, dateFrom, dateTo) {
  return Boolean(date) && date >= dateFrom && date <= dateTo;
}

function buildDefaultDayPlan() {
  return {
    date: "",
    planType: "none",
    hasTraining: false,
    plannedExercises: [],
    scheduleStatus: "",
  };
}

function getPlanTypeLabel(planType) {
  if (planType === "planned") {
    return "计划训练";
  }
  if (planType === "rest") {
    return "计划休息";
  }
  return "无计划";
}

function getMonthTitle(year, month) {
  return `${year}年${month}月`;
}

function buildMonthCells(year, month, statusMap, selectedDate) {
  const firstDay = new Date(year, month - 1, 1);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(year, month - 1, 1 - firstWeekday);
  const today = toDateString(new Date());

  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const dateString = toDateString(date);
    const inCurrentMonth = date.getMonth() === month - 1;
    cells.push({
      date: dateString,
      day: date.getDate(),
      inCurrentMonth,
      status: statusMap[dateString] || "none",
      isToday: dateString === today,
      isSelected: dateString === selectedDate,
    });
  }
  return cells;
}

function normalizeAiResult(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const result = { ...DEFAULT_AI_RESULT };
  ALLOWED_AI_FIELDS.forEach((field) => {
    result[field] = String(source[field] || "").trim();
  });
  return result;
}

function containsBlockedContent(text) {
  const content = String(text || "");
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(content));
}

function validateAiResult(aiResult) {
  const joined = ALLOWED_AI_FIELDS.map((key) => aiResult[key]).join("\n");
  if (!joined.trim()) {
    return { ok: false, message: "AI 未返回有效分析字段" };
  }
  if (containsBlockedContent(joined)) {
    return { ok: false, message: "检测到越界内容，已拦截并请重试" };
  }
  return { ok: true, message: "" };
}

function buildAiInputRecords(records) {
  if (!records.length) {
    return "最近暂无训练记录";
  }
  return records
    .slice(0, 20)
    .map(
      (item) =>
        `${item.date} ${item.exerciseName} 组数:${item.sets} 每组次数:${item.repsPerSetText || "-"}`
    )
    .join("\n");
}

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

function buildAiProfileContext(aiProfile) {
  const profile = aiProfile || buildDefaultAiProfile();
  return [
    "训练目标：体能提升（固定）",
    `身高(cm)：${profile.heightCm || "-"}`,
    `体重(kg)：${profile.weightKg || "-"}`,
    `每周可训练天数：${profile.weeklyTrainingDays || "-"}`,
    `年龄段：${profile.ageRange || "-"}`,
    `性别：${profile.gender || "-"}`,
    `伤痛或禁忌部位：${profile.injuryNotes || "-"}`,
    `本周主观疲劳：${profile.fatigueLevel || "-"}`,
    `其他训练偏好：${profile.trainingPreference || "-"}`,
  ].join("\n");
}

function isPositiveNumberText(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

function hasAiRequiredProfile(aiProfile) {
  const profile = aiProfile || {};
  return (
    isPositiveNumberText(profile.heightCm) &&
    isPositiveNumberText(profile.weightKg) &&
    String(profile.weeklyTrainingDays || "").trim()
  );
}

function buildAiPrompt(recordsText, aiProfile) {
  const profileText = buildAiProfileContext(aiProfile);
  return [
    "你是训练记录总结助手。你的任务是基于用户“已有训练计划”和“训练记录”生成结构化总结。",
    "【输出格式】",
    "- 只允许输出一个 JSON 对象",
    "- 不允许 Markdown、不允许代码块、不允许额外解释",
    "- 仅允许以下 6 个字段，且必须全部返回：summary, consistency, volumeTrend, strengthFocus, extraTrainingInsight, planFocus",
    "【字段要求】",
    "- summary：近期训练总览（40-90字）",
    "- consistency：训练连续性观察（40-90字）",
    "- volumeTrend：训练量变化趋势（40-90字）",
    "- strengthFocus：六艺动作表现（40-90字）",
    "- extraTrainingInsight：其他训练观察（40-90字）",
    "- planFocus：下一步关注点（40-90字，最多2条可执行建议）",
    "【分析边界】",
    "- 仅基于提供的数据，不得臆测未提供信息",
    "- 数据不足时必须明确写“样本不足”或“波动较大”，不得下强结论",
    "- 禁止输出医疗建议、诊断、处方、康复/手术建议",
    "- 禁止输出营养处方、补剂方案、疼痛处置方案",
    "- 禁止输出超出用户既有计划的训练指导",
    "- 禁止使用“保证/一定/必须”等承诺式表述",
    "【个性化优先级】",
    "优先参考：训练目标、每周可训练天数、疲劳等级、伤痛限制",
    "次级参考：身高、体重、性别、年龄段",
    "【写作要求】",
    "- 使用简洁中文，避免空话",
    "- 每个字段尽量包含可验证依据（如频次、组次、动作完成情况）",
    "- 与用户动作名称保持一致（如俯卧撑、深蹲、引体向上、举腿、桥、倒立撑）",
    "【输入数据】",
    "用户资料：",
    profileText,
    "训练记录（时间窗口：最近30天，最多20条）：",
    recordsText,
  ].join("\n");
}

function parseDateString(dateText) {
  if (!dateText || typeof dateText !== "string") {
    return null;
  }
  const parts = dateText.split("-").map((item) => Number(item));
  if (parts.length !== 3 || parts.some((num) => !Number.isFinite(num))) {
    return null;
  }
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getWeekRange(dateText) {
  const anchor = parseDateString(dateText) || new Date();
  const day = anchor.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(anchor);
  weekStart.setDate(anchor.getDate() + mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return {
    weekStart: toDateString(weekStart),
    weekEnd: toDateString(weekEnd),
  };
}

function countDaysInRangeBy(dayMap, dateFrom, dateTo, predicate) {
  return Object.keys(dayMap || {}).filter((date) => {
    if (!isDateInRange(date, dateFrom, dateTo)) {
      return false;
    }
    return predicate(dayMap[date], date);
  }).length;
}

function getMonthStreak(daySummaryMap, statusMap, selectedDate) {
  const anchor = parseDateString(selectedDate) || new Date();
  const month = anchor.getMonth();
  let streak = 0;
  let cursor = new Date(anchor);

  while (cursor.getMonth() === month) {
    const date = toDateString(cursor);
    const hasSummary = Array.isArray(daySummaryMap[date]) && daySummaryMap[date].length > 0;
    const status = statusMap[date];
    const hasTraining = hasSummary || status === "trained" || status === "extra";
    if (!hasTraining) {
      break;
    }
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function buildProgressHeroSummary({ selectedDate, daySummaryMap, dayPlanMap, statusMap, stageName }) {
  const anchorDate = selectedDate || toDateString(new Date());
  const monthPrefix = anchorDate.slice(0, 8);
  const trainedDaysInMonth = Object.keys(daySummaryMap || {}).filter(
    (date) => date.startsWith(monthPrefix) && Array.isArray(daySummaryMap[date]) && daySummaryMap[date].length > 0
  ).length;
  const totalRecordsInMonth = Object.keys(daySummaryMap || {}).reduce((sum, date) => {
    if (!date.startsWith(monthPrefix) || !Array.isArray(daySummaryMap[date])) {
      return sum;
    }
    return sum + daySummaryMap[date].length;
  }, 0);

  const { weekStart, weekEnd } = getWeekRange(anchorDate);
  const weekPlannedDays = countDaysInRangeBy(dayPlanMap, weekStart, weekEnd, (plan) => plan?.planType === "planned");
  const weekDoneDays = countDaysInRangeBy(daySummaryMap, weekStart, weekEnd, (items) =>
    Array.isArray(items) && items.length > 0
  );
  const completionRate = weekPlannedDays > 0 ? Math.round((weekDoneDays / weekPlannedDays) * 100) : weekDoneDays > 0 ? 100 : 0;

  return {
    heroStageName: stageName || "初试身手",
    heroLevelText: `Lv${STAGE_TO_LEVEL[stageName] || 1} 训练者`,
    heroMonthStreak: getMonthStreak(daySummaryMap || {}, statusMap || {}, anchorDate),
    heroWeekDoneDays: weekDoneDays,
    heroWeekPlannedDays: weekPlannedDays,
    heroWeekCompletionRate: completionRate,
    heroEvidenceText: `本月训练 ${trainedDaysInMonth} 天 · 记录 ${totalRecordsInMonth} 条`,
  };
}
Page({
  data: {
    hasPlan: true,
    loading: false,
    monthTitle: "",
    monthCursor: {
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
    },
    weekdayLabels: WEEKDAY_LABELS,
    monthCells: [],
    selectedDate: "",
    selectedDaySummary: [],
    selectedDayPlan: buildDefaultDayPlan(),
    selectedPlanTypeLabel: "无计划",
    recentRecords: [],
    analysisSourceRecords: [],
    daySummaryMap: {},
    dayPlanMap: {},
    statusMap: {},
    heroStageName: "初试身手",
    heroLevelText: "Lv1 训练者",
    heroMonthStreak: 0,
    heroWeekDoneDays: 0,
    heroWeekPlannedDays: 0,
    heroWeekCompletionRate: 0,
    heroEvidenceText: "本月训练 0 天 · 记录 0 条",
    aiLoading: false,
    aiResult: null,
    aiError: "",
    aiDisclaimer: "AI 仅用于训练记录总结，不提供医疗建议或超计划指导。",
    aiProfile: buildDefaultAiProfile(),
    aiWeeklyTrainingOptions: AI_WEEKLY_TRAINING_OPTIONS,
    aiAgeRangeOptions: AI_AGE_RANGE_OPTIONS,
    aiGenderOptions: AI_GENDER_OPTIONS,
    aiFatigueOptions: AI_FATIGUE_OPTIONS,
    showAiProfileModal: false,
    showAiLoginRetry: false,
  },

  async onShow() {
    await this.bootstrap();
    await this.tryResumeAiSummaryFlow();
  },

  async bootstrap() {
    this.loadAiProfile();
    this.syncAiLoginRetryHint();
    this.hydrateMonthCache();
    this.setData({ loading: true });
    await this.loadMonthData();
    this.setData({ loading: false });
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

  syncAiLoginRetryHint() {
    const cancelled = Boolean(wx.getStorageSync(AI_SUMMARY_LOGIN_CANCELLED_KEY));
    this.setData({ showAiLoginRetry: cancelled });
  },

  hydrateMonthCache() {
    const { year, month } = this.data.monthCursor;
    const monthText = buildMonthText(year, month);
    const cacheKey = buildMonthCacheKey(monthText);
    const cached = wx.getStorageSync(cacheKey);
    if (!cached || typeof cached !== "object") {
      return;
    }
    this.setData({ ...cached, hasPlan: true });
  },

  async loadMonthData() {
    const { year, month } = this.data.monthCursor;
    const monthText = buildMonthText(year, month);

    let progressData = null;
    try {
      progressData = await callCloud("progress", { action: "get", month: monthText });
      this.setData({ hasPlan: true });
    } catch (error) {
      if ((error?.message || "").includes("未创建计划")) {
        this.setData({ hasPlan: false });
        return;
      }
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
      return;
    }

    const statusMap = progressData?.calendarStatusMap || {};
    const stageName = progressData?.stageName || "初试身手";
    const dayPlanMap = progressData?.calendarDetailMap || {};
    const { dateFrom, dateTo } = getMonthDateRange(year, month);

    let records = [];
    try {
      records = await this.loadMonthlyHistory(dateFrom, dateTo);
    } catch (error) {
      wx.showToast({ title: error.message || "训练记录加载失败", icon: "none" });
    }

    const daySummaryMap = buildDaySummaryMap(records);
    const recentRecords = aggregateDailyRecords(records, 5);
    const analysisSourceRecords = records.slice(0, 20);

    const today = toDateString(new Date());
    const monthPrefix = `${year}-${pad2(month)}-`;
    let selectedDate = today.startsWith(monthPrefix) ? today : `${monthPrefix}01`;
    if (!dayPlanMap[selectedDate] && !daySummaryMap[selectedDate]) {
      const firstPlanDate = Object.keys(dayPlanMap).find((d) => d.startsWith(monthPrefix));
      const firstRecordDate = Object.keys(daySummaryMap).find((d) => d.startsWith(monthPrefix));
      selectedDate = firstPlanDate || firstRecordDate || `${monthPrefix}01`;
    }

    const selectedDayPlan = dayPlanMap[selectedDate] || buildDefaultDayPlan();
    const monthCells = buildMonthCells(year, month, statusMap, selectedDate);
    const heroSummary = buildProgressHeroSummary({
      selectedDate,
      daySummaryMap,
      dayPlanMap,
      statusMap,
      stageName,
    });

    const viewData = {
      statusMap,
      dayPlanMap,
      daySummaryMap,
      recentRecords,
      analysisSourceRecords,
      monthTitle: getMonthTitle(year, month),
      selectedDate,
      selectedDaySummary: daySummaryMap[selectedDate] || [],
      selectedDayPlan,
      selectedPlanTypeLabel: getPlanTypeLabel(selectedDayPlan.planType),
      monthCells,
      ...heroSummary,
    };
    this.setData(viewData);
    const cacheKey = buildMonthCacheKey(monthText);
    wx.setStorageSync(cacheKey, viewData);
  },

  async loadMonthlyHistory(dateFrom, dateTo) {
    try {
      const workoutRange = await callCloud("workout", {
        action: "historyRange",
        dateFrom,
        dateTo,
      });
      const diaryRange = await callCloud("diary", {
        action: "historyRange",
        dateFrom,
        dateTo,
      });
      const workoutRecords = (workoutRange || []).map(normalizeHistoryItem);
      const diaryRecords = (diaryRange || []).map(normalizeDiaryItem);
      return workoutRecords
        .concat(diaryRecords)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    } catch (error) {
      const workoutAll = await callCloud("workout", { action: "history" });
      const diaryAll = await callCloud("diary", { action: "history", limit: 500 });
      const workoutRecords = (workoutAll || [])
        .filter((item) => isDateInRange(item?.date, dateFrom, dateTo))
        .map(normalizeHistoryItem);
      const diaryRecords = (diaryAll || [])
        .filter((item) => isDateInRange(item?.date, dateFrom, dateTo))
        .map(normalizeDiaryItem);
      return workoutRecords
        .concat(diaryRecords)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    }
  },

  async onPrevMonth() {
    const { year, month } = this.data.monthCursor;
    const nextYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 1 ? 12 : month - 1;
    this.setData({ monthCursor: { year: nextYear, month: nextMonth }, loading: true });
    await this.loadMonthData();
    this.setData({ loading: false });
  },

  async onNextMonth() {
    const { year, month } = this.data.monthCursor;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    this.setData({ monthCursor: { year: nextYear, month: nextMonth }, loading: true });
    await this.loadMonthData();
    this.setData({ loading: false });
  },

  onSelectDay(event) {
    const date = event.currentTarget.dataset.date;
    if (!date) {
      return;
    }
    const monthCells = this.data.monthCells.map((item) => ({
      ...item,
      isSelected: item.date === date,
    }));
    const selectedDayPlan = this.data.dayPlanMap[date] || buildDefaultDayPlan();
    const heroSummary = buildProgressHeroSummary({
      selectedDate: date,
      daySummaryMap: this.data.daySummaryMap,
      dayPlanMap: this.data.dayPlanMap,
      statusMap: this.data.statusMap,
      stageName: this.data.heroStageName,
    });
    this.setData({
      selectedDate: date,
      selectedDaySummary: this.data.daySummaryMap[date] || [],
      selectedDayPlan,
      selectedPlanTypeLabel: getPlanTypeLabel(selectedDayPlan.planType),
      monthCells,
      ...heroSummary,
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

  onOpenAiProfileModal() {
    this.setData({ showAiProfileModal: true });
  },

  onCloseAiProfileModal() {
    this.setData({ showAiProfileModal: false });
  },

  saveAiProfile() {
    const aiProfile = {
      ...buildDefaultAiProfile(),
      ...this.data.aiProfile,
    };
    wx.setStorageSync(AI_PROFILE_KEY, aiProfile);
    return aiProfile;
  },

  onSaveAiProfileOnly() {
    this.saveAiProfile();
    wx.showToast({ title: "AI资料已保存", icon: "success" });
  },

  async onSaveAiProfileAndContinue() {
    const aiProfile = this.saveAiProfile();
    if (!hasAiRequiredProfile(aiProfile)) {
      wx.showToast({ title: "请补充身高/体重/每周可训练天数", icon: "none" });
      return;
    }
    this.setData({ showAiProfileModal: false });
    await this.runAiAnalysis(aiProfile);
  },

  onGoAiProfileAdvanced() {
    this.saveAiProfile();
    this.setData({ showAiProfileModal: false });
    wx.setStorageSync(AI_PROFILE_EDIT_REQUEST_KEY, true);
    wx.switchTab({ url: "/pages/mine/index" });
  },

  async isAiAuthorized() {
    const profile = await getAuthProfile();
    return profile?.status === "authorized";
  },

  async ensureAiAuthorized() {
    const authorized = await this.isAiAuthorized();
    if (authorized) {
      wx.removeStorageSync(AI_SUMMARY_LOGIN_CANCELLED_KEY);
      this.setData({ showAiLoginRetry: false });
      return true;
    }
    return new Promise((resolve) => {
      wx.showModal({
        title: "需要登录后使用 AI",
        content: "AI总结仅在登录后可用。手动记录和历史查看不受影响，是否现在去登录？",
        confirmText: "去登录",
        cancelText: "稍后",
        success: (res) => {
          if (!res.confirm) {
            wx.setStorageSync(AI_SUMMARY_LOGIN_CANCELLED_KEY, true);
            this.setData({ showAiLoginRetry: true });
            resolve(false);
            return;
          }
          wx.setStorageSync(AI_SUMMARY_PENDING_KEY, true);
          wx.removeStorageSync(AI_SUMMARY_LOGIN_CANCELLED_KEY);
          this.setData({ showAiLoginRetry: false });
          wx.navigateTo({ url: "/pages/login/index?scene=ai-summary" });
          resolve(false);
        },
        fail: () => resolve(false),
      });
    });
  },

  async tryResumeAiSummaryFlow() {
    const pending = Boolean(wx.getStorageSync(AI_SUMMARY_PENDING_KEY));
    if (!pending) {
      return;
    }
    const authorized = await this.isAiAuthorized();
    if (!authorized) {
      this.setData({ showAiLoginRetry: true });
      return;
    }
    wx.removeStorageSync(AI_SUMMARY_PENDING_KEY);
    wx.removeStorageSync(AI_SUMMARY_LOGIN_CANCELLED_KEY);
    this.setData({ showAiLoginRetry: false });
    await this.startAiSummaryFlow();
  },

  async onContinueLoginAndRunAi() {
    wx.removeStorageSync(AI_SUMMARY_LOGIN_CANCELLED_KEY);
    this.setData({ showAiLoginRetry: false });
    await this.startAiSummaryFlow();
  },

  async onRunAiAnalysis() {
    await this.startAiSummaryFlow();
  },

  async startAiSummaryFlow() {
    const authorized = await this.ensureAiAuthorized();
    if (!authorized) {
      return;
    }
    const aiProfile = {
      ...buildDefaultAiProfile(),
      ...this.data.aiProfile,
    };
    if (!hasAiRequiredProfile(aiProfile)) {
      this.setData({ showAiProfileModal: true });
      return;
    }
    this.saveAiProfile();
    await this.runAiAnalysis(aiProfile);
  },

  async runAiAnalysis(aiProfile) {
    const sourceRecords = this.data.analysisSourceRecords || [];
    if (!sourceRecords.length) {
      wx.showToast({ title: "暂无可分析记录", icon: "none" });
      return;
    }

    this.setData({ aiLoading: true, aiError: "", aiResult: null });
    try {
      const recordsText = buildAiInputRecords(sourceRecords);
      const result = await this.runAiMainPath(recordsText, aiProfile);
      const normalized = normalizeAiResult(result);
      const valid = validateAiResult(normalized);
      if (!valid.ok) {
        this.setData({ aiError: valid.message, aiResult: null });
        wx.showToast({ title: "AI 内容已拦截", icon: "none" });
        return;
      }
      this.setData({ aiResult: normalized, aiError: "" });
    } catch (error) {
      const message = error?.message || "AI 分析失败";
      this.setData({ aiError: message, aiResult: null });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ aiLoading: false });
    }
  },

  async runAiMainPath(recordsText, aiProfile) {
    const prompt = buildAiPrompt(recordsText, aiProfile);
    try {
      ensureCloudInit();
      const ai = wx.cloud?.extend?.AI;
      if (ai && typeof ai.createModel === "function") {
        const model = ai.createModel("deepseek");
        const response = await withTimeout(
          model.generateText({
            model: "deepseek-v3",
            messages: [
              { role: "system", content: "你必须严格输出 JSON。" },
              { role: "user", content: prompt },
            ],
            temperature: 0.2,
          }),
          8000,
          "AI 主通道超时，已切换到云函数兜底"
        );
        const content = response?.choices?.[0]?.message?.content || "";
        const parsed = safeParseJson(content);
        if (parsed) {
          return parsed;
        }
      }
    } catch (error) {
      // fall through to cloud function fallback
    }

    return callCloud("ai-parse", {
      action: "analyzeProgress",
      recordsText,
      profileContext: buildAiProfileContext(aiProfile),
    });
  },

  onGoPlanSetup() {
    wx.navigateTo({ url: "/pages/plan-setup/index" });
  },

  onGoHistory() {
    wx.navigateTo({ url: "/pages/workout-history/index" });
  },

  noop() {},
});














