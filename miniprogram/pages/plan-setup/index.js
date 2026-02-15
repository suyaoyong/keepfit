const { convictStructure } = require("../../data/convict-structure");
const { callCloud } = require("../../services/api");

const PLAN_ID_KEY = "activePlanId";

const WEEK_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const DEFAULT_SIX = ["push", "leg", "pull", "squat", "bridge", "hand"];
const ABILITY_LEVEL_OPTIONS = ["初试身手", "渐入佳境", "炉火纯青", "闭关修炼"];
const LOCKED_IN_STARTER = ["bridge", "hand"];

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

function getLockedExerciseIdsByAbility(abilityLevel) {
  return abilityLevel === "初试身手" ? LOCKED_IN_STARTER : [];
}

Page({
  data: {
    profile: {
      abilityLevel: ABILITY_LEVEL_OPTIONS[0],
    },
    abilityLevelOptions: ABILITY_LEVEL_OPTIONS,
    abilityLevelIndex: 0,
    planName: "",
    exercises: [],
    exerciseOptions: [],
    scheduleExerciseOptions: [],
    scheduleExerciseIds: [],
    scheduleExerciseIndex: 0,
    levelOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    startLevels: {},
    submitting: false,
    scheduleType: "week",
    weekDays: [],
    monthGrid: [],
    calendarGrid: [],
    methodExerciseIndex: 0,
    methodLevel: 1,
    methodDetail: null,
    lockedExerciseIds: ["bridge", "hand"],
    currentStageName: "初试身手",
    weekScheduleRows: [],
    activeScheduleExerciseId: "",
    exerciseScheduleMap: {},
    levelNameMap: {},
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
    await this.loadStageLock();
    this.initExerciseScheduleMap();
    await this.loadCurrentPlan();
    await this.loadMethodDetail();
    await this.loadLevelNames();
    this.buildWeekScheduleRows();
  },

  async loadProfile() {
    try {
      const profile = await callCloud("profile", { action: "get" });
      if (profile) {
        const abilityLevel = this.normalizeAbilityLevel(profile.abilityLevel);
        this.setData({
          profile: {
            ...this.data.profile,
            ...profile,
            abilityLevel,
          },
          abilityLevelIndex: ABILITY_LEVEL_OPTIONS.indexOf(abilityLevel),
        });
      }
    } catch (error) {
      // ignore load errors
    }
  },

  normalizeAbilityLevel(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return ABILITY_LEVEL_OPTIONS[0];
    }
    if (ABILITY_LEVEL_OPTIONS.includes(raw)) {
      return raw;
    }
    if (raw.includes("闭")) {
      return "闭关修炼";
    }
    if (raw.includes("炉")) {
      return "炉火纯青";
    }
    if (raw.includes("渐") || raw.includes("中")) {
      return "渐入佳境";
    }
    return "初试身手";
  },

  onAbilityLevelChange(e) {
    const index = Number(e.detail.value) || 0;
    const nextLevel = ABILITY_LEVEL_OPTIONS[index] || ABILITY_LEVEL_OPTIONS[0];
    this.setData({
      abilityLevelIndex: index,
      "profile.abilityLevel": nextLevel,
    });
    this.applyStageLock(nextLevel);
  },

  onPlanInputChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value || "";
    this.setData({
      [field]: value,
    });
  },

  onSelectLevel(e) {
    const exerciseId = e.currentTarget.dataset.id;
    const index = e.detail.value;
    const level = this.data.levelOptions[index];
    this.setData({
      [`startLevels.${exerciseId}`]: level,
    });
    this.loadLevelName(exerciseId, level);
  },

  onToggleWeekExerciseDay(e) {
    const exerciseId = e.currentTarget.dataset.exerciseId;
    const day = Number(e.currentTarget.dataset.day);
    if (!exerciseId || !day) {
      return;
    }
    if (this.data.lockedExerciseIds.includes(exerciseId)) {
      return;
    }
    const current = this.data.exerciseScheduleMap[exerciseId]?.daysOfWeek || [];
    const next = current.includes(day)
      ? current.filter((item) => item !== day)
      : current.concat(day);
    this.setData(
      {
        [`exerciseScheduleMap.${exerciseId}.daysOfWeek`]: next,
      },
      () => this.buildWeekScheduleRows()
    );
  },

  onSelectScheduleExercise(e) {
    const index = Number(e.detail.value) || 0;
    const exerciseId = this.data.scheduleExerciseIds[index];
    if (!exerciseId) {
      return;
    }
    this.setData({ activeScheduleExerciseId: exerciseId, scheduleExerciseIndex: index }, () => {
      this.syncMonthGridSelection();
    });
  },

  syncMonthGridSelection() {
    const active = this.data.activeScheduleExerciseId;
    if (!active) {
      return;
    }
    const days = this.data.exerciseScheduleMap[active]?.daysOfMonth || [];
    const monthGrid = this.data.monthGrid.map((item) =>
      item.date ? { ...item, selected: days.includes(Number(item.label)) } : item
    );
    this.setData({ monthGrid });
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
      this.setData({ scheduleType: type }, () => {
        if (type === "month") {
          this.syncMonthGridSelection();
        }
      });
    }
  },

  async loadCurrentPlan() {
    try {
      const plan = await callCloud("plan", { action: "current" });
      if (!plan?.planId) {
        return;
      }
      const nextStartLevels = { ...this.data.startLevels, ...(plan.startLevels || {}) };
      const nextScheduleType = plan.scheduleType || this.data.scheduleType;
      const nextPlanName = plan.planName || this.data.planName;

      this.setData(
        {
          planName: nextPlanName,
          scheduleType: nextScheduleType,
          startLevels: nextStartLevels,
        },
        async () => {
          this.applyPlanTemplate(plan.scheduleTemplate);
          await this.loadLevelNames();
        }
      );
    } catch (error) {
      // No active plan is acceptable on first setup.
    }
  },

  applyPlanTemplate(template) {
    if (!template || !template.exerciseSchedules) {
      return;
    }

    const exerciseScheduleMap = { ...this.data.exerciseScheduleMap };
    Object.keys(exerciseScheduleMap).forEach((id) => {
      const item = template.exerciseSchedules[id] || {};
      exerciseScheduleMap[id] = {
        daysOfWeek: Array.isArray(item.daysOfWeek) ? item.daysOfWeek.slice() : [],
        daysOfMonth: Array.isArray(item.daysOfMonth) ? item.daysOfMonth.slice() : [],
      };
    });

    this.setData(
      {
        exerciseScheduleMap,
      },
      () => {
        this.buildWeekScheduleRows();
        this.syncMonthGridSelection();
      }
    );
  },

  onToggleMonthDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) {
      return;
    }
    const monthGrid = this.data.monthGrid.map((item) =>
      item.date === date ? { ...item, selected: !item.selected } : item
    );
    this.setData({ monthGrid }, () => {
      const active = this.data.activeScheduleExerciseId;
      if (!active) {
        return;
      }
      const daysOfMonth = monthGrid
        .filter((item) => item.selected)
        .map((item) => Number(item.label));
      this.setData({
        [`exerciseScheduleMap.${active}.daysOfMonth`]: daysOfMonth,
      });
    });
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
    const { abilityLevel } = this.data.profile;
    if (!abilityLevel.trim()) {
      wx.showToast({ title: "Please set ability level", icon: "none" });
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

  buildWeekScheduleRows() {
    const rows = this.data.exercises.map((exercise) => {
      const selected = this.data.exerciseScheduleMap[exercise.id]?.daysOfWeek || [];
      const days = WEEK_LABELS.map((label, index) => {
        const day = index + 1;
        return {
          day,
          label,
          selected: selected.includes(day),
        };
      });
      return {
        id: exercise.id,
        name: exercise.name,
        days,
        locked: this.data.lockedExerciseIds.includes(exercise.id),
      };
    });
    this.setData({ weekScheduleRows: rows });
  },

  getExerciseIds() {
    const exerciseIds = DEFAULT_SIX;
    return exerciseIds.filter((id) => !this.data.lockedExerciseIds.includes(id));
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

  buildScheduleTemplate(setsRange) {
    const exerciseSchedules = {};
    const exerciseIds = this.getExerciseIds();
    exerciseIds.forEach((id) => {
      const mapping = this.data.exerciseScheduleMap[id] || {};
      exerciseSchedules[id] = {
        daysOfWeek: mapping.daysOfWeek || [],
        daysOfMonth: mapping.daysOfMonth || [],
      };
    });
    return {
      type: this.data.scheduleType,
      exerciseSchedules,
      exercises: exerciseIds,
      targets: this.buildTargets(exerciseIds, setsRange),
    };
  },

  hasTemplateSelection(template) {
    if (!template?.exerciseSchedules) {
      return false;
    }
    return Object.values(template.exerciseSchedules).some((item) => {
      const daysOfWeek = item?.daysOfWeek || [];
      const daysOfMonth = item?.daysOfMonth || [];
      return daysOfWeek.length || daysOfMonth.length;
    });
  },
  computeWeeklySessions(scheduleType, scheduleTemplate, schedules) {
    if (scheduleType === "calendar") {
      return Array.isArray(schedules) ? schedules.length : 0;
    }
    const exerciseSchedules = scheduleTemplate?.exerciseSchedules || {};
    if (scheduleType === "week") {
      const days = new Set();
      Object.values(exerciseSchedules).forEach((item) => {
        (item?.daysOfWeek || []).forEach((day) => days.add(day));
      });
      return days.size;
    }
    if (scheduleType === "month") {
      const days = new Set();
      Object.values(exerciseSchedules).forEach((item) => {
        (item?.daysOfMonth || []).forEach((day) => days.add(day));
      });
      return days.size;
    }
    return 0;
  },

  async saveProfile() {
    return callCloud("profile", {
      action: "set",
      profile: this.data.profile,
    });
  },

  async loadStageLock() {
    try {
      const progress = await callCloud("progress", { action: "get" });
      const abilityLevel = this.normalizeAbilityLevel(this.data.profile?.abilityLevel);
      const stageName = abilityLevel || progress?.stageName || "初试身手";
      this.applyStageLock(stageName);
    } catch (error) {
      const abilityLevel = this.normalizeAbilityLevel(this.data.profile?.abilityLevel);
      this.applyStageLock(abilityLevel || "初试身手");
    }
  },

  applyStageLock(stageName) {
    const normalizedStage = this.normalizeAbilityLevel(stageName);
    const lockedExerciseIds = getLockedExerciseIdsByAbility(normalizedStage);
    this.setData(
      {
        currentStageName: normalizedStage,
        lockedExerciseIds,
      },
      () => {
        this.refreshScheduleExerciseOptions();
        this.buildWeekScheduleRows();
      }
    );
  },

  refreshScheduleExerciseOptions() {
    const availableExercises = this.data.exercises.filter(
      (item) => !this.data.lockedExerciseIds.includes(item.id)
    );
    const scheduleExerciseIds = availableExercises.map((item) => item.id);
    const scheduleExerciseOptions = availableExercises.map((item) => item.name);
    const hasCurrent = scheduleExerciseIds.includes(this.data.activeScheduleExerciseId);
    const activeScheduleExerciseId = hasCurrent
      ? this.data.activeScheduleExerciseId
      : scheduleExerciseIds[0] || "";
    const scheduleExerciseIndex = Math.max(0, scheduleExerciseIds.indexOf(activeScheduleExerciseId));
    this.setData(
      {
        scheduleExerciseOptions,
        scheduleExerciseIds,
        activeScheduleExerciseId,
        scheduleExerciseIndex,
        methodExerciseIndex: activeScheduleExerciseId
          ? this.data.exercises.findIndex((item) => item.id === activeScheduleExerciseId)
          : 0,
      },
      () => {
        if (this.data.scheduleType === "month") {
          this.syncMonthGridSelection();
        }
      }
    );
  },

  initExerciseScheduleMap() {
    const exerciseScheduleMap = {};
    this.data.exercises.forEach((exercise) => {
      exerciseScheduleMap[exercise.id] = {
        daysOfWeek: [],
        daysOfMonth: [],
      };
    });
    const availableExercises = this.data.exercises.filter(
      (item) => !this.data.lockedExerciseIds.includes(item.id)
    );
    const firstAvailable = availableExercises[0] || null;
    this.setData({
      exerciseScheduleMap,
      activeScheduleExerciseId: firstAvailable ? firstAvailable.id : "",
      scheduleExerciseOptions: availableExercises.map((item) => item.name),
      scheduleExerciseIds: availableExercises.map((item) => item.id),
      scheduleExerciseIndex: 0,
      methodExerciseIndex: firstAvailable
        ? this.data.exercises.findIndex((item) => item.id === firstAvailable.id)
        : 0,
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

  async loadLevelNames() {
    const tasks = this.data.exercises.map((exercise) => {
      const level = Number(this.data.startLevels[exercise.id]) || 1;
      return this.loadLevelName(exercise.id, level);
    });
    await Promise.all(tasks);
  },

  async loadLevelName(exerciseId, level) {
    if (!exerciseId) {
      return;
    }
    try {
      const response = await callCloud("method", { exerciseId, level });
      const levelName = response?.items?.[0]?.levelName || `第${level}式`;
      this.setData({
        [`levelNameMap.${exerciseId}`]: `第${level}式 · ${levelName}`,
      });
    } catch (error) {
      this.setData({
        [`levelNameMap.${exerciseId}`]: `第${level}式`,
      });
    }
  },
  async onCreatePlan() {
    if (!this.validateProfile()) {
      return;
    }
    const exerciseIds = this.getExerciseIds();
    const setsRange = "";
    
    let schedules = [];
    let scheduleTemplate = null;
    if (this.data.scheduleType === "calendar") {
      const dates = this.getSelectedDates();
      if (!dates.length) {
        wx.showToast({ title: "请先选择排期日期", icon: "none" });
        return;
      }
      schedules = this.buildSchedulePayload(dates, exerciseIds, setsRange);
    } else {
      scheduleTemplate = this.buildScheduleTemplate(setsRange);
      if (!this.hasTemplateSelection(scheduleTemplate)) {
        wx.showToast({ title: "请先选择排期周期", icon: "none" });
        return;
      }
    }
    const weeklySessions = this.computeWeeklySessions(this.data.scheduleType, scheduleTemplate, schedules);

    this.setData({ submitting: true });
    try {
      await this.saveProfile();

      const plan = await callCloud("plan", {
        action: "create",
        planName: this.data.planName || "\u8bad\u7ec3\u8ba1\u5212",
        planLevel: this.normalizeAbilityLevel(this.data.profile?.abilityLevel),
        weeklySessions,
        setsRange,
        exerciseScope: "six",
        scheduleType: this.data.scheduleType,
        startLevels: this.data.startLevels,
        schedules,
        scheduleTemplate,
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
          wx.removeStorageSync(PLAN_ID_KEY);
          this.setData({
            planName: "",
          });
          wx.showToast({ title: "计划已重置", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "重置失败", icon: "none" });
        }
      },
    });
  },
});
