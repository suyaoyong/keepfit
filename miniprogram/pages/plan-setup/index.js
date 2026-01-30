const { convictStructure } = require("../../data/convict-structure");
const { callCloud } = require("../../services/api");

const PLAN_ID_KEY = "activePlanId";

const WEEK_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const DEFAULT_FOUR = ["push", "leg", "pull", "squat"];
const DEFAULT_SIX = ["push", "leg", "pull", "squat", "bridge", "hand"];

function toDateString(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(date);
  start.setDate(date.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function buildWeekDays() {
  const start = startOfWeek(new Date());
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const date = toDateString(current);
    days.push({
      date,
      dateLabel: `${current.getMonth() + 1}/${current.getDate()}`,
      label: WEEK_LABELS[i],
      selected: false,
    });
  }
  return days;
}

function buildCalendarGrid() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  const offset = startDay === 0 ? 6 : startDay - 1;

  for (let i = 0; i < offset; i += 1) {
    cells.push({ key: `empty-${i}`, empty: true, label: "" });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = toDateString(new Date(year, month, day));
    cells.push({
      key: date,
      date,
      label: String(day),
      selected: false,
      empty: false,
    });
  }

  const total = Math.ceil(cells.length / 7) * 7;
  while (cells.length < total) {
    cells.push({ key: `empty-${cells.length}`, empty: true, label: "" });
  }

  return cells;
}

function parseWeeklySessions(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

Page({
  data: {
    profile: {
      abilityLevel: "",
      trainingFrequency: "",
      sessionDuration: "",
      injuryNotes: "",
    },
    planName: "",
    planType: "自建",
    exercises: [],
    exerciseOptions: [],
    levelOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    startLevels: {},
    submitting: false,
    recommendation: null,
    scheduleType: "week",
    weekDays: [],
    monthGrid: [],
    calendarGrid: [],
    methodExerciseIndex: 0,
    methodLevel: 1,
    methodDetail: null,
  },

  async onLoad() {
    const exercises = convictStructure.map((item) => ({
      id: item.id,
      name: item.name,
    }));
    const startLevels = {};
    exercises.forEach((item) => {
      startLevels[item.id] = 1;
    });

    const exerciseOptions = exercises.map((item) => item.name);
    this.setData({
      exercises,
      exerciseOptions,
      startLevels,
      weekDays: buildWeekDays(),
      monthGrid: buildCalendarGrid(),
      calendarGrid: buildCalendarGrid(),
    });

    await this.loadProfile();
    await this.loadMethodDetail();
  },

  async loadProfile() {
    try {
      const profile = await callCloud("profile", { action: "get" });
      if (profile) {
        this.setData({ profile });
      }
    } catch (error) {
      // ignore load errors
    }
  },

  onInputChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value || "";
    this.setData({
      [`profile.${field}`]: value,
    });
  },

  onPlanInputChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value || "";
    this.setData({
      [field]: value,
    });
  },

  onSelectPlanType(e) {
    const type = e.currentTarget.dataset.type || "自建";
    this.setData({ planType: type });
  },

  onSelectLevel(e) {
    const exerciseId = e.currentTarget.dataset.id;
    const index = e.detail.value;
    const level = this.data.levelOptions[index];
    this.setData({
      [`startLevels.${exerciseId}`]: level,
    });
  },

  onMethodExerciseChange(e) {
    const index = Number(e.detail.value) || 0;
    this.setData({ methodExerciseIndex: index }, () => {
      this.loadMethodDetail();
    });
  },

  onMethodLevelChange(e) {
    const index = Number(e.detail.value) || 0;
    const level = this.data.levelOptions[index] || 1;
    this.setData({ methodLevel: level }, () => {
      this.loadMethodDetail();
    });
  },

  onSelectScheduleType(e) {
    const type = e.currentTarget.dataset.type;
    if (type && type !== this.data.scheduleType) {
      this.setData({ scheduleType: type });
    }
  },

  onToggleWeekDay(e) {
    const date = e.currentTarget.dataset.date;
    const weekDays = this.data.weekDays.map((item) =>
      item.date === date ? { ...item, selected: !item.selected } : item
    );
    this.setData({ weekDays });
  },

  onToggleMonthDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) {
      return;
    }
    const monthGrid = this.data.monthGrid.map((item) =>
      item.date === date ? { ...item, selected: !item.selected } : item
    );
    this.setData({ monthGrid });
  },

  onToggleCalendarDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) {
      return;
    }
    const calendarGrid = this.data.calendarGrid.map((item) =>
      item.date === date ? { ...item, selected: !item.selected } : item
    );
    this.setData({ calendarGrid });
  },

  validateProfile() {
    const { abilityLevel, trainingFrequency, sessionDuration } = this.data.profile;
    if (!abilityLevel.trim()) {
      wx.showToast({ title: "请填写当前能力水平", icon: "none" });
      return false;
    }
    if (!trainingFrequency.trim()) {
      wx.showToast({ title: "请填写训练频率", icon: "none" });
      return false;
    }
    if (!sessionDuration.trim()) {
      wx.showToast({ title: "请填写可用训练时长", icon: "none" });
      return false;
    }
    return true;
  },

  getSelectedDates() {
    const { scheduleType, weekDays, monthGrid, calendarGrid } = this.data;
    if (scheduleType === "week") {
      return weekDays.filter((item) => item.selected).map((item) => item.date);
    }
    if (scheduleType === "month") {
      return monthGrid.filter((item) => item.selected).map((item) => item.date);
    }
    return calendarGrid.filter((item) => item.selected).map((item) => item.date);
  },

  getExerciseIds() {
    const recommendation = this.data.recommendation;
    if (recommendation?.exercises?.length) {
      return recommendation.exercises;
    }
    const scope = recommendation?.exerciseScope || "six";
    return scope === "four" ? DEFAULT_FOUR : DEFAULT_SIX;
  },

  buildTargets(exerciseIds, setsRange) {
    return exerciseIds.reduce((acc, exerciseId) => {
      acc[exerciseId] = {
        level: Number(this.data.startLevels[exerciseId]) || 1,
        setsRange,
      };
      return acc;
    }, {});
  },

  autoPickWeekDates(count) {
    const available = this.data.weekDays;
    if (!count || !available.length) {
      return [];
    }
    const step = Math.floor(available.length / count);
    const dates = [];
    for (let i = 0; i < count; i += 1) {
      const index = Math.min(i * step, available.length - 1);
      dates.push(available[index].date);
    }
    return Array.from(new Set(dates));
  },

  buildSchedulePayload(dates, exerciseIds, setsRange) {
    const targets = this.buildTargets(exerciseIds, setsRange);
    return dates.map((date) => ({
      date,
      exercises: exerciseIds,
      targets,
      status: "planned",
      swapped: false,
    }));
  },

  async saveProfile() {
    return callCloud("profile", {
      action: "set",
      profile: this.data.profile,
    });
  },

  async loadMethodDetail() {
    const exercise = this.data.exercises[this.data.methodExerciseIndex];
    if (!exercise) {
      return;
    }
    try {
      const response = await callCloud("method", {
        exerciseId: exercise.id,
        level: this.data.methodLevel,
      });
      const item = response?.items?.[0] || null;
      this.setData({ methodDetail: item });
    } catch (error) {
      this.setData({ methodDetail: null });
    }
  },

  async onGenerateRecommendation() {
    if (!this.validateProfile()) {
      return;
    }
    this.setData({ submitting: true, planType: "推荐" });
    try {
      await this.saveProfile();
      const recommendation = await callCloud("recommendation", {
        profile: this.data.profile,
        startLevels: this.data.startLevels,
      });
      this.setData({ recommendation });
      wx.showToast({ title: "推荐计划已生成", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "推荐失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onCreatePlan() {
    if (!this.validateProfile()) {
      return;
    }

    const recommendation = this.data.recommendation;
    const exerciseIds = this.getExerciseIds();
    const setsRange = recommendation?.setsRange || "";
    const weeklySessions =
      recommendation?.weeklySessions || parseWeeklySessions(this.data.profile.trainingFrequency);

    let dates = this.getSelectedDates();
    if (!dates.length && this.data.scheduleType === "week" && weeklySessions) {
      dates = this.autoPickWeekDates(weeklySessions);
    }
    if (!dates.length) {
      wx.showToast({ title: "请先选择排期日期", icon: "none" });
      return;
    }

    const schedules = this.buildSchedulePayload(dates, exerciseIds, setsRange);

    this.setData({ submitting: true });
    try {
      await this.saveProfile();

      const plan = await callCloud("plan", {
        action: "create",
        planName: this.data.planName || recommendation?.planName || "训练计划",
        planType: recommendation ? "推荐" : this.data.planType,
        planLevel: recommendation?.planName || "",
        weeklySessions,
        setsRange,
        exerciseScope: recommendation?.exerciseScope || "six",
        scheduleType: this.data.scheduleType,
        startLevels: this.data.startLevels,
        recommendationId: recommendation?.recommendationId || "",
        schedules,
      });

      if (plan?.planId) {
        wx.setStorageSync(PLAN_ID_KEY, plan.planId);
      }

      wx.showToast({ title: "计划创建成功", icon: "success" });
      wx.switchTab({ url: "/pages/workout-today/index" });
    } catch (error) {
      wx.showToast({ title: error.message || "创建失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
