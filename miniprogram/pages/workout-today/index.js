const { convictStructure } = require("../../data/convict-structure");
const { callCloud, getTodayWorkout, getSchedules, swapSchedule } = require("../../services/api");

const PLAN_ID_KEY = "activePlanId";

function buildExerciseMap() {
  return convictStructure.reduce((acc, item) => {
    acc[item.id] = item.name;
    return acc;
  }, {});
}

Page({
  data: {
    exerciseOptions: [],
    exerciseIds: [],
    exerciseNameMap: {},
    selectedExerciseIndex: 0,
    form: {
      sets: "",
      reps: "",
      duration: "",
      rpe: "",
      notes: "",
    },
    submitting: false,
    todayPlan: null,
    aiRawText: "",
    aiResult: null,
    aiLoading: false,
  },

  onLoad() {
    const exerciseOptions = convictStructure.map((item) => item.name);
    const exerciseIds = convictStructure.map((item) => item.id);
    const exerciseNameMap = buildExerciseMap();
    this.setData({ exerciseOptions, exerciseIds, exerciseNameMap });
  },

  onShow() {
    this.loadToday();
  },

  async loadToday() {
    try {
      const todayPlan = await getTodayWorkout();
      if (todayPlan?.exercises?.length) {
        const exerciseIds = todayPlan.exercises;
        const exerciseOptions = exerciseIds.map(
          (id) => this.data.exerciseNameMap[id] || id
        );
        this.setData({
          todayPlan,
          exerciseIds,
          exerciseOptions,
          selectedExerciseIndex: 0,
        });
      } else {
        this.setData({ todayPlan: null });
      }
    } catch (error) {
      this.setData({ todayPlan: null });
    }
  },

  onExerciseChange(e) {
    this.setData({ selectedExerciseIndex: Number(e.detail.value) || 0 });
  },

  onInputChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value || "";
    this.setData({
      [`form.${field}`]: value,
    });
  },

  async onSubmit() {
    const { form, exerciseIds, selectedExerciseIndex } = this.data;
    if (!exerciseIds.length) {
      wx.showToast({ title: "未加载动作列表", icon: "none" });
      return;
    }

    if (!form.sets && !form.reps && !form.duration) {
      wx.showToast({ title: "请至少填写组数/次数/时长之一", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    try {
      await callCloud("workout", {
        action: "log",
        planId: this.data.todayPlan?.planId || "",
        exerciseId: exerciseIds[selectedExerciseIndex],
        sets: Number(form.sets) || 0,
        reps: Number(form.reps) || 0,
        duration: Number(form.duration) || 0,
        rpe: Number(form.rpe) || 0,
        notes: form.notes || "",
      });
      wx.showToast({ title: "记录已保存", icon: "success" });
      this.setData({
        form: { sets: "", reps: "", duration: "", rpe: "", notes: "" },
      });

      if (this.data.todayPlan?.generated) {
        await this.promptSwapSchedule();
      }
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onDiarySubmit() {
    const { form, exerciseIds, selectedExerciseIndex } = this.data;
    if (!exerciseIds.length) {
      wx.showToast({ title: "未加载动作列表", icon: "none" });
      return;
    }
    if (!form.sets && !form.reps && !form.duration) {
      wx.showToast({ title: "请至少填写组数/次数/时长之一", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    try {
      await callCloud("diary", {
        action: "log",
        exerciseId: exerciseIds[selectedExerciseIndex],
        sets: Number(form.sets) || 0,
        reps: Number(form.reps) || 0,
        duration: Number(form.duration) || 0,
        rpe: Number(form.rpe) || 0,
        notes: form.notes || "",
      });
      wx.showToast({ title: "训练日记已保存", icon: "success" });
      this.setData({
        form: { sets: "", reps: "", duration: "", rpe: "", notes: "" },
      });
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async promptSwapSchedule() {
    const planId = this.data.todayPlan?.planId;
    const today = this.data.todayPlan?.date;
    if (!planId || !today) {
      return;
    }

    try {
      const weekDates = this.getWeekRange(today);
      const schedules = await getSchedules({ planId, dateFrom: weekDates.start, dateTo: weekDates.end });
      const candidate = (schedules || [])
        .filter((item) => item.date !== today && item.status === "planned")
        .sort((a, b) => a.date.localeCompare(b.date))[0];

      if (!candidate) {
        return;
      }

      wx.showModal({
        title: "调整本周排期",
        content: `已在非计划日训练，是否与 ${candidate.date} 交换排期？`,
        confirmText: "交换",
        cancelText: "不交换",
        success: async (res) => {
          if (!res.confirm) {
            return;
          }
          try {
            await swapSchedule({ planId, fromDate: today, toDate: candidate.date });
            wx.showToast({ title: "排期已交换", icon: "success" });
            await this.loadToday();
          } catch (error) {
            wx.showToast({ title: error.message || "交换失败", icon: "none" });
          }
        },
      });
    } catch (error) {
      // ignore swap failure
    }
  },

  getWeekRange(dateString) {
    const date = new Date(`${dateString}T00:00:00`);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const start = new Date(date);
    start.setDate(date.getDate() + diff);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      start: this.toDateString(start),
      end: this.toDateString(end),
    };
  },

  toDateString(date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  onAiInputChange(e) {
    this.setData({ aiRawText: e.detail.value || "" });
  },

  async onAiParse() {
    if (!this.data.aiRawText.trim()) {
      wx.showToast({ title: "请先输入训练描述", icon: "none" });
      return;
    }
    this.setData({ aiLoading: true });
    try {
      const result = await callCloud("ai-parse", { rawText: this.data.aiRawText });
      const payload = result || {};
      this.setData({ aiResult: payload });
      await this.applyAiResult(payload);
    } catch (error) {
      wx.showToast({ title: error.message || "解析失败", icon: "none" });
    } finally {
      this.setData({ aiLoading: false });
    }
  },

  async applyAiResult(payload) {
    const confidence = Number(payload?.confidence) || 0;
    const exerciseId = payload?.exerciseId || "";
    const summary = `动作：${exerciseId || "未识别"}\n组数：${payload?.sets || "-"}\n次数：${payload?.reps || "-"}\n时长：${payload?.duration || "-"}\nRPE：${payload?.rpe || "-" }\n置信度：${confidence}`;

    return new Promise((resolve) => {
      wx.showModal({
        title: confidence < 0.6 ? "解析结果（需确认）" : "解析结果",
        content: summary,
        confirmText: "填入表单",
        cancelText: "取消",
        success: (res) => {
          if (res.confirm) {
            this.fillFormFromAi(payload);
          }
          resolve();
        },
      });
    });
  },

  fillFormFromAi(payload) {
    const exerciseId = payload?.exerciseId || "";
    let selectedExerciseIndex = this.data.selectedExerciseIndex;
    if (exerciseId) {
      const index = this.data.exerciseIds.indexOf(exerciseId);
      if (index >= 0) {
        selectedExerciseIndex = index;
      }
    }

    this.setData({
      selectedExerciseIndex,
      form: {
        sets: payload?.sets ? String(payload.sets) : "",
        reps: payload?.reps ? String(payload.reps) : "",
        duration: payload?.duration ? String(payload.duration) : "",
        rpe: payload?.rpe ? String(payload.rpe) : "",
        notes: payload?.notes || "",
      },
    });
  },

  onResetPlan() {
    wx.removeStorageSync(PLAN_ID_KEY);
    wx.navigateTo({ url: "/pages/plan-setup/index" });
  },
});
