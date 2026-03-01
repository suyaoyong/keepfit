const { convictStructure } = require("../../data/convict-structure");
const {
  callCloud,
  getTodayWorkout,
  getSchedules,
} = require("../../services/api");
const {
  METHOD_BOOK_ID,
  getMethodChapterNo,
  normalizeMethodLevel,
} = require("../../data/method-sections");

const PLAN_ID_KEY = "activePlanId";
const HISTORY_RECORD_MAX_DAYS = 7;
const STAGE_TO_LEVEL = {
  初试身手: 1,
  渐入佳境: 2,
  炉火纯青: 3,
  闭关修炼: 4,
};
const SHARE_PATH = "/pages/workout-today/index";
const DEFAULT_SHARE_TITLE = "KeepFit 今日训练";

function buildExerciseMap() {
  return convictStructure.reduce((acc, item) => {
    acc[item.id] = item.name;
    return acc;
  }, {});
}

function normalizePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function buildFormByExercise(exerciseIds, source = {}) {
  return exerciseIds.reduce((acc, id) => {
    const current = source[id] || {};
    acc[id] = {
      sets: current.sets || "",
      reps: current.reps || "",
    };
    return acc;
  }, {});
}

function addDays(baseDate, deltaDays) {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + deltaDays);
  return date;
}

Page({
  data: {
    exerciseNameMap: {},
    lockedExerciseIds: ["bridge", "hand"],
    displayExercises: [],
    levelNameMap: {},
    formByExercise: {},
    submitting: false,
    todayPlan: null,
    hasActivePlan: true,
    dayStatus: "training",
    dayStatusLabel: "今日训练",
    otherTrainingName: "",
    otherTrainingDuration: "",
    historyRecordDate: "",
    historyDateMin: "",
    historyDateMax: "",
    historyDisplayExercises: [],
    historyFormByExercise: {},
    historyOtherTrainingName: "",
    historyOtherTrainingDuration: "",
    historyLoading: false,
    historyEditorVisible: false,
    currentStageName: "初试身手",
    identityLabel: "Lv1 训练者",
    streakDays: 0,
    weeklyDone: 0,
    weeklyTotal: 0,
    weeklyPercent: 0,
    primaryActionText: "开始训练",
    heroSummaryText: "",
  },

  onLoad() {
    const today = this.toDateString(new Date());
    const minDate = this.toDateString(addDays(new Date(), -HISTORY_RECORD_MAX_DAYS));
    this.setData({
      exerciseNameMap: buildExerciseMap(),
      historyRecordDate: today,
      historyDateMin: minDate,
      historyDateMax: today,
    });
  },

  async onShow() {
    this.refreshHistoryDateWindow();
    await this.loadStageLock();
    await this.loadToday();
  },

  refreshHistoryDateWindow() {
    const today = this.toDateString(new Date());
    const minDate = this.toDateString(addDays(new Date(), -HISTORY_RECORD_MAX_DAYS));
    const current = String(this.data.historyRecordDate || "");
    const nextRecordDate =
      current && current >= minDate && current <= today ? current : today;
    this.setData({
      historyRecordDate: nextRecordDate,
      historyDateMin: minDate,
      historyDateMax: today,
    });
  },

  async loadStageLock() {
    try {
      const progress = await callCloud("progress", { action: "get" });
      const lockedExerciseIds = progress?.lockedExerciseIds || ["bridge", "hand"];
      const stageName = String(progress?.stageName || "初试身手");
      const evidence = this.buildEvidenceFromCalendar(progress?.calendarStatusMap || {});
      this.setData({
        lockedExerciseIds,
        currentStageName: stageName,
        identityLabel: `Lv${STAGE_TO_LEVEL[stageName] || 1} 训练者`,
        ...evidence,
      });
    } catch (error) {
      this.setData({
        lockedExerciseIds: ["bridge", "hand"],
        currentStageName: "初试身手",
        identityLabel: "Lv1 训练者",
        streakDays: 0,
        weeklyDone: 0,
        weeklyTotal: 0,
        weeklyPercent: 0,
      });
    }
  },

  buildEvidenceFromCalendar(calendarStatusMap) {
    const statusMap =
      calendarStatusMap && typeof calendarStatusMap === "object" ? calendarStatusMap : {};
    const trainedSet = new Set(["trained", "extra"]);
    const today = new Date();
    let streakDays = 0;
    for (let i = 0; i < 120; i += 1) {
      const date = addDays(today, -i);
      const key = this.toDateString(date);
      const status = String(statusMap[key] || "").trim().toLowerCase();
      if (!trainedSet.has(status)) {
        break;
      }
      streakDays += 1;
    }

    const start = (() => {
      const base = new Date(today);
      const day = base.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      base.setDate(base.getDate() + diff);
      return base;
    })();

    let weeklyDone = 0;
    let weeklyTotal = 0;
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(start, i);
      const key = this.toDateString(date);
      const status = String(statusMap[key] || "").trim().toLowerCase();
      if (status === "planned" || status === "trained") {
        weeklyTotal += 1;
      }
      if (status === "trained") {
        weeklyDone += 1;
      }
    }
    if (!weeklyTotal) {
      weeklyTotal = Math.max(weeklyDone, 0);
    }
    const weeklyPercent = weeklyTotal ? Math.min(100, Math.round((weeklyDone / weeklyTotal) * 100)) : 0;
    return { streakDays, weeklyDone, weeklyTotal, weeklyPercent };
  },

  updateHeroSummary() {
    const names = (this.data.displayExercises || [])
      .slice(0, 2)
      .map((id) => this.data.exerciseNameMap[id] || id);
    const summary = names.length ? `今日训练：${names.join(" + ")}` : "今日训练：按计划休息";
    this.setData({ heroSummaryText: summary });
  },

  updatePrimaryActionText() {
    if (!this.data.hasActivePlan) {
      this.setData({ primaryActionText: "前往计划设置" });
      return;
    }
    if (this.data.dayStatus === "rest") {
      this.setData({ primaryActionText: "查看进度" });
      return;
    }
    const hasInput = this.collectFilledEntries().length > 0 || Boolean(this.collectOtherTraining());
    this.setData({ primaryActionText: hasInput ? "提交训练" : "开始训练" });
  },

  async loadToday() {
    try {
      const todayPlan = await getTodayWorkout();
      const plannedExercises = Array.isArray(todayPlan?.exercises) ? todayPlan.exercises : [];
      const displayExercises = plannedExercises.filter(
        (id) => !this.data.lockedExerciseIds.includes(id)
      );
      const dayStatus = this.resolveDayStatus(todayPlan, displayExercises);

      this.setData({
        todayPlan: todayPlan || null,
        hasActivePlan: true,
        dayStatus,
        dayStatusLabel: dayStatus === "rest" ? "今日休息" : "今日训练",
        displayExercises,
        formByExercise: buildFormByExercise(displayExercises, this.data.formByExercise),
      });

      await this.loadLevelNames(todayPlan, displayExercises);
      this.updateHeroSummary();
      this.updatePrimaryActionText();
    } catch (error) {
      const hasActivePlan = await this.detectActivePlan();
      this.setData({
        todayPlan: null,
        hasActivePlan,
        dayStatus: hasActivePlan ? "rest" : "training",
        dayStatusLabel: hasActivePlan ? "今日休息" : "今日训练",
        displayExercises: [],
        formByExercise: {},
        levelNameMap: {},
      });
      this.updateHeroSummary();
      this.updatePrimaryActionText();
    }
  },

  async detectActivePlan() {
    try {
      const current = await callCloud("plan", { action: "current" });
      return Boolean(current?.planId);
    } catch (error) {
      return false;
    }
  },

  resolveDayStatus(todayPlan, displayExercises) {
    const scheduleStatus = String(todayPlan?.status || "").toLowerCase();
    if (scheduleStatus === "rest" || scheduleStatus === "rested") {
      return "rest";
    }
    if (Array.isArray(displayExercises) && displayExercises.length) {
      return "training";
    }
    return "rest";
  },

  async loadLevelNames(todayPlan, exerciseIds) {
    if (!todayPlan || !exerciseIds.length) {
      this.setData({ levelNameMap: {} });
      return;
    }

    try {
      const entries = await Promise.all(
        exerciseIds.map(async (id) => {
          const level = todayPlan?.targets?.[id]?.level || 1;
          const res = await callCloud("method", { exerciseId: id, level });
          const levelName = res?.items?.[0]?.levelName || `第${level}式`;
          return [id, `第${level}式 · ${levelName}`];
        })
      );
      this.setData({ levelNameMap: Object.fromEntries(entries) });
    } catch (error) {
      this.setData({ levelNameMap: {} });
    }
  },

  onFormInputChange(e) {
    const exerciseId = e.currentTarget.dataset.exerciseId;
    const field = e.currentTarget.dataset.field;
    if (!exerciseId || !field) {
      return;
    }
    const value = e.detail.value || "";
    this.setData({ [`formByExercise.${exerciseId}.${field}`]: value }, () => {
      this.updatePrimaryActionText();
    });
  },

  onOtherTrainingInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) {
      return;
    }
    this.setData({ [field]: e.detail.value || "" }, () => {
      this.updatePrimaryActionText();
    });
  },


  async onPrimaryAction() {
    if (!this.data.hasActivePlan) {
      this.onResetPlan();
      return;
    }
    if (this.data.dayStatus === "rest") {
      wx.switchTab({ url: "/pages/progress/index" });
      return;
    }
    const hasInput = this.collectFilledEntries().length > 0 || Boolean(this.collectOtherTraining());
    if (hasInput) {
      await this.onSubmit();
      this.updatePrimaryActionText();
      return;
    }
    this.scrollToRecordCard();
    wx.showToast({ title: "先填写今日训练组次", icon: "none" });
  },
  onHistoryDateChange(e) {
    const nextDate = String(e?.detail?.value || "");
    if (!nextDate) {
      return;
    }
    this.setData({ historyRecordDate: nextDate });
    if (this.data.historyEditorVisible) {
      this.loadHistoryFormForDate(nextDate);
    }
  },

  async onHistoryPrimaryAction() {
    if (!this.data.historyEditorVisible) {
      this.setData({ historyEditorVisible: true });
      await this.loadHistoryFormForDate(this.data.historyRecordDate);
      this.scrollToHistoryRecordCard();
      return;
    }
    await this.onDiarySubmit();
  },

  getValidHistoryRecordDate() {
    const candidate = String(this.data.historyRecordDate || "").trim();
    const minDate = String(this.data.historyDateMin || "").trim();
    const maxDate = String(this.data.historyDateMax || "").trim();
    if (!candidate) {
      return "";
    }
    if ((minDate && candidate < minDate) || (maxDate && candidate > maxDate)) {
      return "";
    }
    return candidate;
  },

  collectFilledEntries() {
    return this.data.displayExercises
      .map((exerciseId) => {
        const form = this.data.formByExercise[exerciseId] || {};
        const sets = normalizePositiveInt(form.sets);
        const reps = normalizePositiveInt(form.reps);
        return { exerciseId, sets, reps };
      })
      .filter((item) => item.sets > 0 && item.reps > 0);
  },

  collectOtherTraining() {
    const activityName = String(this.data.otherTrainingName || "").trim();
    const duration = normalizePositiveInt(this.data.otherTrainingDuration);
    if (!activityName || !duration) {
      return null;
    }
    return { activityName, duration };
  },

  onHistoryFormInputChange(e) {
    const exerciseId = e.currentTarget.dataset.exerciseId;
    const field = e.currentTarget.dataset.field;
    if (!exerciseId || !field) {
      return;
    }
    const value = e.detail.value || "";
    this.setData({ [`historyFormByExercise.${exerciseId}.${field}`]: value });
  },

  onHistoryOtherTrainingInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) {
      return;
    }
    this.setData({ [field]: e.detail.value || "" }, () => {
      this.updatePrimaryActionText();
    });
  },

  collectHistoryFilledEntries() {
    return this.data.historyDisplayExercises
      .map((exerciseId) => {
        const form = this.data.historyFormByExercise[exerciseId] || {};
        const sets = normalizePositiveInt(form.sets);
        const reps = normalizePositiveInt(form.reps);
        return { exerciseId, sets, reps };
      })
      .filter((item) => item.sets > 0 && item.reps > 0);
  },

  collectHistoryOtherTraining() {
    const activityName = String(this.data.historyOtherTrainingName || "").trim();
    const duration = normalizePositiveInt(this.data.historyOtherTrainingDuration);
    if (!activityName || !duration) {
      return null;
    }
    return { activityName, duration };
  },

  async loadHistoryFormForDate(date) {
    const recordDate = String(date || "").trim();
    if (!recordDate) {
      return;
    }
    this.setData({ historyLoading: true });
    try {
      const currentPlan = await callCloud("plan", { action: "current" }).catch(() => null);
      const planId = currentPlan?.planId || this.data.todayPlan?.planId || "";
      let list = await getSchedules({ date: recordDate, ...(planId ? { planId } : {}) });
      if ((!Array.isArray(list) || !list.length) && planId) {
        const generated = await callCloud("workout", { action: "today", date: recordDate }).catch(
          () => null
        );
        if (generated && generated.date === recordDate) {
          list = [generated];
        }
      }
      const schedule = Array.isArray(list) && list.length ? list[0] : null;
      const rawExercises = Array.isArray(schedule?.exercises) ? schedule.exercises : [];
      const historyDisplayExercises = rawExercises.filter(
        (id) => !this.data.lockedExerciseIds.includes(id)
      );
      this.setData({
        historyDisplayExercises,
        historyFormByExercise: buildFormByExercise(
          historyDisplayExercises,
          this.data.historyFormByExercise
        ),
      });
    } catch (error) {
      this.setData({
        historyDisplayExercises: [],
        historyFormByExercise: {},
      });
    } finally {
      this.setData({ historyLoading: false });
    }
  },

  scrollToRecordCard() {
    const query = wx.createSelectorQuery();
    query.select("#record-card").boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      const cardRect = res && res[0];
      const viewport = res && res[1];
      if (!cardRect || !viewport) {
        return;
      }
      const targetTop = Math.max(0, Math.floor(viewport.scrollTop + cardRect.top - 16));
      wx.pageScrollTo({ scrollTop: targetTop, duration: 200 });
    });
  },

  scrollToHistoryRecordCard() {
    const query = wx.createSelectorQuery();
    query.select("#history-record-card").boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      const cardRect = res && res[0];
      const viewport = res && res[1];
      if (!cardRect || !viewport) {
        return;
      }
      const targetTop = Math.max(0, Math.floor(viewport.scrollTop + cardRect.top - 16));
      wx.pageScrollTo({ scrollTop: targetTop, duration: 200 });
    });
  },

  async onSubmit() {
    if (this.data.dayStatus === "rest") {
      wx.showToast({ title: "今日按计划休息，无需提交训练", icon: "none" });
      return;
    }

    const entries = this.collectFilledEntries();
    const otherTraining = this.collectOtherTraining();
    if (!entries.length && !otherTraining) {
      this.scrollToRecordCard();
      wx.showToast({ title: "请先在上方填写组次，或填写其他训练", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    try {
      const completion = entries.length >= this.data.displayExercises.length ? "full" : "partial";
      const tasks = entries.map((item) =>
        callCloud("workout", {
          action: "log",
          planId: this.data.todayPlan?.planId || "",
          exerciseId: item.exerciseId,
          exerciseName: this.data.exerciseNameMap[item.exerciseId] || item.exerciseId,
          completion,
          sets: item.sets,
          reps: item.reps,
        })
      );
      if (otherTraining) {
        tasks.push(
          callCloud("diary", {
            action: "logOther",
            date: this.data.todayPlan?.date || this.toDateString(new Date()),
            activityName: otherTraining.activityName,
            duration: otherTraining.duration,
          })
        );
      }
      await Promise.all(tasks);

      wx.showToast({ title: "今日训练已提交", icon: "success" });
      this.setData({
        formByExercise: buildFormByExercise(this.data.displayExercises),
        otherTrainingName: "",
        otherTrainingDuration: "",
      });
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onDiarySubmit() {
    const entries = this.collectHistoryFilledEntries();
    const otherTraining = this.collectHistoryOtherTraining();
    if (!entries.length && !otherTraining) {
      this.scrollToHistoryRecordCard();
      wx.showToast({ title: "请先填写补录动作组次，或补录其他训练", icon: "none" });
      return;
    }
    const recordDate = this.getValidHistoryRecordDate();
    if (!recordDate) {
      wx.showToast({ title: "请选择7天内的补录日期", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    try {
      const tasks = entries.map((item) =>
        callCloud("diary", {
          action: "log",
          date: recordDate,
          exerciseId: item.exerciseId,
          sets: item.sets,
          reps: item.reps,
        })
      );
      if (otherTraining) {
        tasks.push(
          callCloud("diary", {
            action: "logOther",
            date: recordDate,
            activityName: otherTraining.activityName,
            duration: otherTraining.duration,
          })
        );
      }
      await Promise.all(tasks);
      wx.showToast({ title: "历史训练补录成功", icon: "success" });
      this.setData({
        historyFormByExercise: buildFormByExercise(this.data.historyDisplayExercises),
        historyOtherTrainingName: "",
        historyOtherTrainingDuration: "",
        historyEditorVisible: false,
      });
    } catch (error) {
      wx.showToast({ title: error.message || "记录失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  toDateString(date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  async markTodayAsRest() {
    const today = this.data.todayPlan?.date || this.toDateString(new Date());
    let planId = this.data.todayPlan?.planId || "";
    if (!planId) {
      const current = await callCloud("plan", { action: "current" });
      planId = current?.planId || "";
    }
    if (!planId) {
      throw new Error("尚未创建计划，无法标记休息");
    }

    await callCloud("schedule", {
      action: "upsert",
      planId,
      schedules: [
        {
          date: today,
          exercises: this.data.todayPlan?.exercises || [],
          targets: this.data.todayPlan?.targets || {},
          status: "rest",
          swapped: false,
        },
      ],
    });

    await this.loadToday();
  },

  async onViewMethod(event) {
    const exerciseId = event.currentTarget.dataset.exerciseId;
    if (!exerciseId) {
      return;
    }

    const chapterNo = getMethodChapterNo(exerciseId);
    if (!chapterNo) {
      wx.showToast({ title: "暂无训练方法", icon: "none" });
      return;
    }
    const level = normalizeMethodLevel(this.data.todayPlan?.targets?.[exerciseId]?.level || 1);

    wx.navigateTo({
      url: `/pages/reader/index?bookId=${encodeURIComponent(
        METHOD_BOOK_ID
      )}&chapterNo=${chapterNo}&exerciseId=${exerciseId}&level=${level}&mode=method`,
    });
  },

  buildSharePayload() {
    const summary = String(this.data.heroSummaryText || "").trim();
    return {
      title: summary || DEFAULT_SHARE_TITLE,
      path: SHARE_PATH,
    };
  },

  onShareAppMessage() {
    return this.buildSharePayload();
  },

  onShareTimeline() {
    return {
      title: this.buildSharePayload().title,
    };
  },

  onResetPlan() {
    wx.removeStorageSync(PLAN_ID_KEY);
    wx.navigateTo({ url: "/pages/plan-setup/index" });
  },
});







