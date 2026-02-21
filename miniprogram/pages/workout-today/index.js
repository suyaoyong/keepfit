const { convictStructure } = require("../../data/convict-structure");
const {
  callCloud,
  ensureCloudInit,
  getTodayWorkout,
  getAuthProfile,
  getSchedules,
} = require("../../services/api");
const {
  METHOD_BOOK_ID,
  getMethodChapterNo,
  normalizeMethodLevel,
} = require("../../data/method-sections");

const PLAN_ID_KEY = "activePlanId";
const AI_ENTRY_MODE_KEY = "keepfit:ai-entry-mode";
const AI_ENTRY_MODE_AUTO = "auto";
const AI_ENTRY_MODE_CONFIRM = "confirm";
const AI_CONFIDENCE_THRESHOLD = 0.8;
const HISTORY_RECORD_MAX_DAYS = 7;
const STAGE_TO_LEVEL = {
  初试身手: 1,
  渐入佳境: 2,
  炉火纯青: 3,
  闭关修炼: 4,
};

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

function normalizeAiNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return Math.floor(num);
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

    aiRawText: "",
    aiResult: null,
    aiLoading: false,
    aiDraft: null,
    aiEntryMode: AI_ENTRY_MODE_AUTO,
    aiEntryModeOptions: [
      { label: "自动入账", value: AI_ENTRY_MODE_AUTO },
      { label: "先确认后入账", value: AI_ENTRY_MODE_CONFIRM },
    ],
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
    this.loadAiEntryMode();
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

  onAiInputChange(e) {
    this.setData({ aiRawText: e.detail.value || "" });
  },

  loadAiEntryMode() {
    const stored = wx.getStorageSync(AI_ENTRY_MODE_KEY);
    const mode =
      stored === AI_ENTRY_MODE_CONFIRM || stored === AI_ENTRY_MODE_AUTO
        ? stored
        : AI_ENTRY_MODE_AUTO;
    this.setData({ aiEntryMode: mode });
  },

  onAiModeChange(e) {
    const mode = e?.detail?.value;
    const value =
      mode === AI_ENTRY_MODE_CONFIRM || mode === AI_ENTRY_MODE_AUTO
        ? mode
        : AI_ENTRY_MODE_AUTO;
    wx.setStorageSync(AI_ENTRY_MODE_KEY, value);
    this.setData({ aiEntryMode: value });
  },

  async onAiParse() {
    if (!this.data.aiRawText.trim()) {
      wx.showToast({ title: "请先输入训练描述", icon: "none" });
      return;
    }
    const authorized = await this.ensureAiAuthorized();
    if (!authorized) {
      return;
    }
    this.setData({ aiLoading: true });
    try {
      const result = await this.runAiParse(this.data.aiRawText);
      const payload = result || {};
      this.setData({ aiResult: payload, aiDraft: null });
      await this.applyAiResult(payload);
    } catch (error) {
      const code = error?.errCode || error?.code || "";
      const message = error?.message || "解析失败";
      wx.showModal({
        title: "AI 解析失败",
        content: code ? `${message}（${code}）` : message,
        showCancel: false,
      });
    } finally {
      this.setData({ aiLoading: false });
    }
  },

  async ensureAiAuthorized() {
    const profile = await getAuthProfile();
    if (profile?.status === "authorized") {
      return true;
    }
    return new Promise((resolve) => {
      wx.showModal({
        title: "需要登录后使用 AI",
        content: "AI解析仅在登录后可用。手动记录不受影响，是否现在去登录？",
        confirmText: "去登录",
        cancelText: "稍后",
        success: (res) => {
          if (!res.confirm) {
            resolve(false);
            return;
          }
          wx.navigateTo({ url: "/pages/login/index" });
          resolve(false);
        },
        fail: () => resolve(false),
      });
    });
  },

  async runAiParse(rawText) {
    try {
      ensureCloudInit();
      const ai = wx.cloud?.extend?.AI;
      if (ai && typeof ai.createModel === "function") {
        const model = ai.createModel("deepseek");
        const res = await model.generateText({
          model: "deepseek-v3",
          messages: [
            {
              role: "system",
              content:
                "你是训练记录解析助手。只输出一个 JSON 对象，不要包含代码块或多余文本。输出格式：{\"items\":[{\"exerciseId\":\"push|squat|pull|leg|bridge|hand\",\"exerciseName\":\"动作中文名\",\"sets\":数字,\"reps\":数字,\"confidence\":0-1}] }。可同时解析多个动作；未提及动作不要输出。动作映射：俯卧撑=push，深蹲=squat，引体向上=pull，举腿=leg，桥=bridge，倒立撑=hand。",
            },
            { role: "user", content: rawText },
          ],
        });
        const content = res?.choices?.[0]?.message?.content || "{}";
        return this.normalizeAiPayload(this.safeParseAiContent(content));
      }
    } catch (error) {
      // fallback
    }

    const cloudPayload = await callCloud("ai-parse", { rawText });
    return this.normalizeAiPayload(cloudPayload);
  },

  safeParseAiContent(content) {
    const trimmed = (content || "").trim();
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (innerError) {
          return {};
        }
      }
      return {};
    }
  },

  normalizeAiPayload(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const fallbackSingle =
      source.exerciseId || source.exerciseName
        ? [
            {
              exerciseId: source.exerciseId,
              exerciseName: source.exerciseName,
              sets: source.sets,
              reps: source.reps,
              confidence: source.confidence,
            },
          ]
        : [];
    const rawItems = Array.isArray(source.items) ? source.items : fallbackSingle;

    const merged = {};
    rawItems.forEach((item) => {
      const id =
        this.mapExerciseId(item?.exerciseId) || this.mapExerciseId(item?.exerciseName) || "";
      if (!id) {
        return;
      }
      const sets = normalizeAiNumber(item?.sets);
      const reps = normalizeAiNumber(item?.reps);
      if (!sets || !reps) {
        return;
      }
      const confidence = Number(
        Math.min(1, Math.max(0, Number(item?.confidence) || 0)).toFixed(2)
      );
      const prev = merged[id];
      if (!prev) {
        merged[id] = { exerciseId: id, sets, reps, confidence };
        return;
      }
      if (confidence >= prev.confidence) {
        merged[id] = { exerciseId: id, sets, reps, confidence };
      }
    });

    return { items: Object.values(merged) };
  },

  buildAiSummary(items) {
    if (!items.length) {
      return "未识别到可录入动作，请改用手动录入。";
    }
    return items
      .map((item, idx) => {
        const name = this.data.exerciseNameMap[item.exerciseId] || item.exerciseId;
        return `${idx + 1}. ${name} ${item.sets}组 x ${item.reps}次（置信度 ${item.confidence.toFixed(
          2
        )}）`;
      })
      .join("\n");
  },

  async applyAiResult(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const validItems = items.filter((item) => this.data.displayExercises.includes(item.exerciseId));
    const summary = this.buildAiSummary(validItems);

    if (!validItems.length) {
      wx.showModal({
        title: "AI 解析结果",
        content: summary,
        showCancel: false,
      });
      return Promise.resolve();
    }

    const hasLowConfidence = validItems.some((item) => item.confidence < AI_CONFIDENCE_THRESHOLD);
    if (hasLowConfidence) {
      this.setData({ aiDraft: { items: validItems } });
      return new Promise((resolve) => {
        wx.showModal({
          title: "低置信度结果已存为草稿",
          content: `${summary}\n\n该结果不会自动入账，请手动确认后再填入表单。`,
          confirmText: "查看草稿",
          cancelText: "关闭",
          success: (res) => {
            if (res.confirm) {
              this.onApplyAiDraft();
            }
            resolve();
          },
        });
      });
    }

    if (this.data.aiEntryMode === AI_ENTRY_MODE_AUTO) {
      this.fillFormFromAi({ items: validItems });
      wx.showToast({ title: `已自动填入${validItems.length}项`, icon: "success" });
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      wx.showModal({
        title: "解析结果",
        content: summary,
        confirmText: "填入表单",
        cancelText: "取消",
        success: (res) => {
          if (res.confirm) {
            this.fillFormFromAi({ items: validItems });
          }
          resolve();
        },
      });
    });
  },

  onApplyAiDraft() {
    const draft = this.data.aiDraft;
    if (!draft) {
      wx.showToast({ title: "暂无草稿", icon: "none" });
      return;
    }
    this.fillFormFromAi(draft);
    this.setData({ aiDraft: null });
  },

  fillFormFromAi(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!items.length) {
      return;
    }
    const updates = {};
    items.forEach((item) => {
      const exerciseId = this.mapExerciseId(item?.exerciseId) || "";
      if (!exerciseId || !this.data.displayExercises.includes(exerciseId)) {
        return;
      }
      const sets = normalizeAiNumber(item?.sets);
      const reps = normalizeAiNumber(item?.reps);
      if (!sets || !reps) {
        return;
      }
      updates[`formByExercise.${exerciseId}.sets`] = String(sets);
      updates[`formByExercise.${exerciseId}.reps`] = String(reps);
    });
    if (Object.keys(updates).length) {
      this.setData(updates);
    }
  },

  mapExerciseId(value) {
    if (!value) {
      return "";
    }
    const normalized = String(value).trim();
    const mapping = {
      push: "push",
      squat: "squat",
      pull: "pull",
      leg: "leg",
      bridge: "bridge",
      hand: "hand",
      俯卧撑: "push",
      深蹲: "squat",
      引体向上: "pull",
      举腿: "leg",
      桥: "bridge",
      倒立撑: "hand",
    };
    return mapping[normalized] || "";
  },

  onResetPlan() {
    wx.removeStorageSync(PLAN_ID_KEY);
    wx.navigateTo({ url: "/pages/plan-setup/index" });
  },
});







