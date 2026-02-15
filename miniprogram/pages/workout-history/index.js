const { callCloud } = require("../../services/api");
const { convictStructure } = require("../../data/convict-structure");

function buildExerciseMap() {
  return convictStructure.reduce((acc, item) => {
    acc[item.id] = item.name;
    return acc;
  }, {});
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

function normalizeWorkoutItem(item, exerciseNameMap) {
  const repsPerSet = normalizeRepsPerSet(item);
  return {
    date: item?.date || "",
    recordType: "exercise",
    exerciseName: exerciseNameMap[item?.exerciseId] || item?.exerciseName || item?.exerciseId || "",
    sets: Number(item?.sets) || repsPerSet.length,
    repsPerSetText: repsPerSet.join(" / "),
  };
}

function normalizeDiaryItem(item, exerciseNameMap) {
  if (item?.recordType === "other") {
    const duration = Number(item?.duration) || 0;
    return {
      date: item?.date || "",
      recordType: "other",
      exerciseName: item?.activityName || "其他训练",
      sets: 0,
      repsPerSetText: duration ? `${duration}分钟` : "",
    };
  }

  const repsPerSet = normalizeRepsPerSet(item);
  return {
    date: item?.date || "",
    recordType: "exercise",
    exerciseName: exerciseNameMap[item?.exerciseId] || item?.exerciseName || item?.exerciseId || "",
    sets: Number(item?.sets) || repsPerSet.length,
    repsPerSetText: repsPerSet.join(" / "),
  };
}

function aggregateDaily(records) {
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

  return Object.keys(grouped)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((date) => {
      const items = grouped[date];
      const summaryText = items
        .map((item) =>
          item.recordType === "other"
            ? `${item.exerciseName}${item.repsPerSetText ? ` ${item.repsPerSetText}` : ""}`
            : `${item.exerciseName} ${item.sets}组×${item.repsPerSetText || "-"}`
        )
        .join("；");
      return {
        date,
        count: items.length,
        summaryText,
      };
    });
}

Page({
  data: {
    records: [],
    loading: false,
    errorMessage: "",
    exerciseNameMap: {},
  },

  onShow() {
    this.setData({ exerciseNameMap: buildExerciseMap() });
    this.loadHistory();
  },

  async loadHistory() {
    this.setData({ loading: true, errorMessage: "" });
    try {
      const exerciseNameMap = this.data.exerciseNameMap;
      const workoutData = await callCloud("workout", { action: "history" });
      const normalizedWorkout = (workoutData || []).map((item) =>
        normalizeWorkoutItem(item, exerciseNameMap)
      );
      this.setData({
        records: aggregateDaily(normalizedWorkout),
        loading: false,
      });

      const diaryData = await callCloud("diary", { action: "history", limit: 500 });
      const normalizedDiary = (diaryData || []).map((item) => normalizeDiaryItem(item, exerciseNameMap));
      this.setData({
        records: aggregateDaily(normalizedWorkout.concat(normalizedDiary)),
      });
    } catch (error) {
      const message = error.message || "加载失败，请稍后重试";
      this.setData({ errorMessage: message });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
