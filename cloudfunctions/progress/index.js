const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

const EXERCISES = [
  { id: "push", name: "俯卧撑" },
  { id: "squat", name: "深蹲" },
  { id: "pull", name: "引体向上" },
  { id: "leg", name: "举腿" },
  { id: "bridge", name: "桥" },
  { id: "hand", name: "倒立撑" },
];

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { ok: false, error: "无法获取用户身份" };
  }

  const progress = await db.collection("progress").where({ openid }).get();
  const progressMap = new Map(progress.data.map((item) => [item.exerciseId, item]));

  const items = EXERCISES.map((exercise) => {
    const record = progressMap.get(exercise.id);
    const currentLevel = record?.currentStage?.level || 1;
    const nextLevel = record?.nextStage?.level || currentLevel + 1;

    return {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      currentStage: record?.currentStage || { name: `第${currentLevel}式`, level: currentLevel },
      nextStage: record?.nextStage || { name: `第${nextLevel}式`, level: nextLevel },
      unlockCondition: record?.unlockCondition || "完成升级标准",
      updatedAt: record?.updatedAt || null,
    };
  });

  return {
    ok: true,
    data: {
      items,
    },
  };
};
