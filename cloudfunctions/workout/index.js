const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

const EXERCISE_SCOPE = {
  four: ["push", "leg", "pull", "squat"],
  six: ["push", "leg", "pull", "squat", "bridge", "hand"],
};

function toDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getActivePlan(openid) {
  const byStatus = await db.collection("plans").where({ openid, status: "active" }).limit(1).get();
  if (byStatus.data.length) {
    return byStatus.data[0];
  }
  const byActive = await db.collection("plans").where({ openid, active: true }).limit(1).get();
  return byActive.data[0] || null;
}

async function getScheduleForDate(openid, planId, date) {
  const condition = { openid, date };
  if (planId) {
    condition.planId = planId;
  }
  const result = await db.collection("schedules").where(condition).limit(1).get();
  return result.data[0] || null;
}

async function upsertSchedule(openid, planId, date, payload) {
  const now = db.serverDate();
  const scheduleId = payload?.scheduleId || `sched_${planId || "plan"}_${date}`;
  const data = {
    scheduleId,
    openid,
    planId,
    date,
    exercises: payload?.exercises || [],
    targets: payload?.targets || {},
    status: payload?.status || "planned",
    swapped: Boolean(payload?.swapped),
    updatedAt: now,
    generated: Boolean(payload?.generated),
  };

  const condition = { openid, date };
  if (planId) {
    condition.planId = planId;
  }

  const existing = await db.collection("schedules").where(condition).limit(1).get();
  if (existing.data.length) {
    await db.collection("schedules").doc(existing.data[0]._id).update({ data });
  } else {
    await db.collection("schedules").add({ data: { ...data, createdAt: now } });
  }

  return data;
}

function buildFallbackTargets(plan, exerciseIds) {
  const startLevels = plan?.startLevels || {};
  return exerciseIds.reduce((acc, exerciseId) => {
    acc[exerciseId] = {
      level: Number(startLevels[exerciseId]) || 1,
      setsRange: plan?.setsRange || "",
    };
    return acc;
  }, {});
}

async function handleToday(openid, event) {
  const date = event?.date || toDateString();
  const plan = await getActivePlan(openid);
  if (!plan) {
    return { ok: false, error: "未创建计划" };
  }

  const existing = await getScheduleForDate(openid, plan.planId, date);
  if (existing) {
    return { ok: true, data: existing };
  }

  const exerciseIds = EXERCISE_SCOPE[plan.exerciseScope] || EXERCISE_SCOPE.six;
  const targets = buildFallbackTargets(plan, exerciseIds);
  const schedule = await upsertSchedule(openid, plan.planId, date, {
    exercises: exerciseIds,
    targets,
    status: "planned",
    generated: true,
  });

  return { ok: true, data: schedule };
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

async function handleLog(event, openid) {
  const exerciseId = event?.exerciseId || "";
  if (!exerciseId) {
    return { ok: false, error: "缺少动作信息" };
  }

  const date = event?.date || toDateString();
  const now = db.serverDate();
  const planId = event?.planId || "";
  const workoutId = event?.workoutId || `workout_${Date.now()}`;

  const record = {
    openid,
    date,
    planId,
    workoutId,
    exerciseId,
    sets: Number(event?.sets) || 0,
    reps: Number(event?.reps) || 0,
    duration: Number(event?.duration) || 0,
    rpe: Number(event?.rpe) || 0,
    notes: event?.notes || "",
    updatedAt: now,
  };

  if (!record.sets && !record.reps && !record.duration) {
    return { ok: false, error: "至少填写组数/次数/时长之一" };
  }

  const existing = await db
    .collection("workouts")
    .where({ openid, date, exerciseId })
    .limit(1)
    .get();

  if (existing.data.length) {
    await db.collection("workouts").doc(existing.data[0]._id).update({
      data: record,
    });
  } else {
    await db.collection("workouts").add({
      data: {
        ...record,
        createdAt: now,
      },
    });
  }

  const schedule = planId ? await getScheduleForDate(openid, planId, date) : null;
  if (schedule && schedule.status !== "completed") {
    await db.collection("schedules").doc(schedule._id).update({
      data: { status: "completed", updatedAt: now },
    });
  }

  const progress = await updateProgress(openid, exerciseId);
  return { ok: true, data: { ...record, progress } };
}

async function handleHistory(openid) {
  const result = await db
    .collection("workouts")
    .where({ openid })
    .orderBy("date", "desc")
    .limit(50)
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
  if (action === "today") {
    return handleToday(openid, event);
  }
  if (action === "log") {
    return handleLog(event, openid);
  }
  if (action === "history") {
    return handleHistory(openid);
  }

  return { ok: false, error: "不支持的操作" };
};
