const METHOD_BOOK_ID = "qiutujianshen";
const MAX_METHOD_LEVEL = 10;

const EXERCISE_METHOD_CHAPTER_MAP = {
  push: 8,
  squat: 9,
  pull: 10,
  leg: 11,
  bridge: 12,
  hand: 13,
};

const EXERCISE_NAME_MAP = {
  push: "俯卧撑",
  squat: "深蹲",
  pull: "引体向上",
  leg: "举腿",
  bridge: "桥",
  hand: "倒立撑",
};

function normalizeMethodLevel(level) {
  const parsed = Number(level);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.min(MAX_METHOD_LEVEL, Math.floor(parsed));
}

function getMethodChapterNo(exerciseId) {
  return EXERCISE_METHOD_CHAPTER_MAP[exerciseId] || 0;
}

function buildMethodQuickList() {
  const exerciseIds = Object.keys(EXERCISE_METHOD_CHAPTER_MAP);
  const list = [];
  exerciseIds.forEach((exerciseId) => {
    const chapterNo = getMethodChapterNo(exerciseId);
    const exerciseName = EXERCISE_NAME_MAP[exerciseId] || exerciseId;
    for (let level = 1; level <= MAX_METHOD_LEVEL; level += 1) {
      list.push({
        id: `${exerciseId}-${level}`,
        exerciseId,
        exerciseName,
        chapterNo,
        level,
        levelLabel: `第${level}式`,
      });
    }
  });
  return list;
}

module.exports = {
  METHOD_BOOK_ID,
  MAX_METHOD_LEVEL,
  EXERCISE_METHOD_CHAPTER_MAP,
  EXERCISE_NAME_MAP,
  normalizeMethodLevel,
  getMethodChapterNo,
  buildMethodQuickList,
};
