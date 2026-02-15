const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const KNOWN_EXERCISE_IDS = ["push", "squat", "pull", "leg", "bridge", "hand"];

function toDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function updateProgress(openid, exerciseId) {
  const progress = await db
    .collection("progress")
    .where({ openid, exerciseId })
    .limit(1)
    .get();

  const current = progress.data[0] || null;
  const currentLevel = current?.currentStage?.level || 1;
  const nextLevel = currentLevel + 1;
  const now = db.serverDate();

  const data = {
    openid,
    exerciseId,
    currentStage: { name: `第${currentLevel}式`, level: currentLevel },
    nextStage: { name: `第${nextLevel}式`, level: nextLevel },
    updatedAt: now,
  };

  if (current) {
    await db.collection("progress").doc(current._id).update({ data });
  } else {
    await db.collection("progress").add({ data });
  }

  return data;
}

async function handleLog(openid, event) {
  const exerciseId = event?.exerciseId || "";
  if (!exerciseId) {
    return { ok: false, error: "缺少动作信息" };
  }

  const date = event?.date || toDateString();
  const now = db.serverDate();
  const diaryId = event?.diaryId || `diary_${Date.now()}`;

  const record = {
    diaryId,
    openid,
    date,
    exerciseId,
    sets: Number(event?.sets) || 0,
    reps: Number(event?.reps) || 0,
    duration: Number(event?.duration) || 0,
    rpe: Number(event?.rpe) || 0,
    notes: event?.notes || "",
    createdAt: now,
  };

  if (!record.sets && !record.reps && !record.duration) {
    return { ok: false, error: "至少填写组数/次数/时长之一" };
  }

  await db.collection("diaries").add({ data: record });
  const shouldUpdateProgress = KNOWN_EXERCISE_IDS.includes(exerciseId);
  const progress = shouldUpdateProgress ? await updateProgress(openid, exerciseId) : null;

  return { ok: true, data: { ...record, progress: progress || undefined } };
}

async function handleHistory(openid, event) {
  const limit = Number(event?.limit) || 50;
  const result = await db
    .collection("diaries")
    .where({ openid })
    .orderBy("date", "desc")
    .limit(limit)
    .get();

  return { ok: true, data: result.data };
}

async function handleLogOther(openid, event) {
  const date = event?.date || toDateString();
  const activityName = String(event?.activityName || "").trim();
  const duration = Number(event?.duration) || 0;
  const notes = String(event?.notes || "").trim();

  if (!activityName) {
    return { ok: false, error: "缺少其他训练项目名称" };
  }
  if (!duration || duration <= 0) {
    return { ok: false, error: "其他训练时长需大于0" };
  }

  const now = db.serverDate();
  const diaryId = event?.diaryId || `diary_other_${Date.now()}`;
  const record = {
    diaryId,
    openid,
    date,
    recordType: "other",
    activityName,
    duration: Math.floor(duration),
    notes,
    createdAt: now,
  };

  await db.collection("diaries").add({ data: record });
  return { ok: true, data: record };
}

async function handleHistoryRange(openid, event) {
  const dateFrom = String(event?.dateFrom || "").trim();
  const dateTo = String(event?.dateTo || "").trim();
  if (!dateFrom || !dateTo) {
    return { ok: false, error: "缺少日期范围" };
  }

  const result = await db
    .collection("diaries")
    .where({ openid, date: db.command.gte(dateFrom).and(db.command.lte(dateTo)) })
    .orderBy("date", "desc")
    .limit(500)
    .get();
  return { ok: true, data: result.data };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { ok: false, error: "无法获取用户身份" };
  }

  const action = event?.action || "log";
  if (action === "log") {
    return handleLog(openid, event);
  }
  if (action === "history") {
    return handleHistory(openid, event);
  }
  if (action === "logOther") {
    return handleLogOther(openid, event);
  }
  if (action === "historyRange") {
    return handleHistoryRange(openid, event);
  }

  return { ok: false, error: "不支持的操作" };
};
