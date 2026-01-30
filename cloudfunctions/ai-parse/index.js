const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event, context) => {
  const rawText = event?.rawText || "";
  if (!rawText) {
    return { ok: false, error: "缺少训练描述内容" };
  }

  return {
    ok: true,
    data: {
      exerciseId: "",
      sets: 0,
      reps: 0,
      duration: 0,
      rpe: 0,
      notes: rawText,
      confidence: 0,
    },
  };
};
