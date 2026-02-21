const { callCloud } = require("../../services/api");
const {
  EXERCISE_NAME_MAP,
  getMethodChapterNo,
  normalizeMethodLevel,
} = require("../../data/method-sections");

const METHOD_EXERCISE_ORDER = ["push", "squat", "pull", "leg", "bridge", "hand"];

function buildMethodExerciseList() {
  return METHOD_EXERCISE_ORDER.map((exerciseId) => ({
    exerciseId,
    exerciseName: EXERCISE_NAME_MAP[exerciseId] || exerciseId,
    chapterNo: getMethodChapterNo(exerciseId),
  })).filter((item) => item.chapterNo > 0);
}

Page({
  data: {
    bookId: "",
    loading: false,
    errorMessage: "",
    book: null,
    chapters: [],
    progress: null,
    methodExercises: buildMethodExerciseList(),
  },

  onLoad(query) {
    this.setData({ bookId: String(query?.bookId || "") });
  },

  onShow() {
    this.loadDetail();
  },

  async loadDetail() {
    const bookId = this.data.bookId;
    if (!bookId) {
      this.setData({ errorMessage: "缺少 bookId" });
      return;
    }

    this.setData({ loading: true, errorMessage: "" });
    try {
      const result = await callCloud("library", { action: "getBookDetail", bookId });
      this.setData({
        book: result?.book || null,
        chapters: result?.chapters || [],
        progress: result?.progress || null,
      });
    } catch (error) {
      this.setData({ errorMessage: error?.message || "加载目录失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onOpenChapter(event) {
    const chapterNo = Number(event?.currentTarget?.dataset?.no);
    if (!Number.isFinite(chapterNo) || chapterNo <= 0) {
      return;
    }
    wx.navigateTo({ url: `/pages/reader/index?bookId=${encodeURIComponent(this.data.bookId)}&chapterNo=${chapterNo}` });
  },

  onContinueRead() {
    const chapterNo = Number(this.data.progress?.chapterNo) || 1;
    wx.navigateTo({ url: `/pages/reader/index?bookId=${encodeURIComponent(this.data.bookId)}&chapterNo=${chapterNo}` });
  },

  onOpenMethod(event) {
    const exerciseId = String(event?.currentTarget?.dataset?.exerciseId || "");
    const chapterNo = getMethodChapterNo(exerciseId);
    if (!chapterNo) {
      return;
    }
    const level = normalizeMethodLevel(event?.currentTarget?.dataset?.level || 1);
    wx.navigateTo({
      url: `/pages/reader/index?bookId=${encodeURIComponent(
        this.data.bookId
      )}&chapterNo=${chapterNo}&exerciseId=${exerciseId}&level=${level}&mode=method`,
    });
  },
});
