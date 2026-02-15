const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

const EXERCISE_SCOPE = {
  four: ["push", "leg", "pull", "squat"],
  six: ["push", "leg", "pull", "squat", "bridge", "hand"],
};

function toInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function sanitizeRepsPerSet(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => toInt(item)).filter((item) => item > 0);
}

function buildRepsPerSet(sets, reps, rawRepsPerSet) {
  const direct = sanitizeRepsPerSet(rawRepsPerSet);
  if (direct.length) {
    return direct;
  }
  const safeSets = toInt(sets);
  const safeReps = toInt(reps);
  if (!safeSets || !safeReps) {
    return [];
  }
  return Array.from({ length: safeSets }, () => safeReps);
}

function normalizeWorkoutRecord(record = {}) {
  const setsFromRecord = toInt(record.sets);
  const repsPerSet = buildRepsPerSet(record.sets, record.reps, record.repsPerSet);
  const normalizedSets = setsFromRecord || repsPerSet.length;
  const normalizedRepsPerSet = repsPerSet.slice(0, normalizedSets || repsPerSet.length);
  const finalSets = normalizedSets || normalizedRepsPerSet.length;

  return {
    ...record,
    sets: finalSets,
    repsPerSet: normalizedRepsPerSet,
  };
}

function normalizeLogInput(event = {}) {
  const sets = toInt(event.sets);
  const repsPerSet = buildRepsPerSet(event.sets, event.reps, event.repsPerSet);
  const resolvedSets = sets || repsPerSet.length;
  if (!resolvedSets || !repsPerSet.length) {
    return null;
  }

  return {
    sets: resolvedSets,
    repsPerSet: repsPerSet.slice(0, resolvedSets),
  };
}

function mergeWorkoutRecords(existing = {}, incoming = {}) {
  const current = normalizeWorkoutRecord(existing);
  const next = normalizeWorkoutRecord(incoming);
  const mergedRepsPerSet = current.repsPerSet.concat(next.repsPerSet);

  return {
    ...current,
    ...next,
    planId: next.planId || current.planId || "",
    workoutId: current.workoutId || next.workoutId,
    exerciseName: next.exerciseName || current.exerciseName || "",
    sets: current.sets + next.sets,
    repsPerSet: mergedRepsPerSet,
  };
}

function toDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayOfWeek(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function dayOfMonth(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return date.getDate();
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isRestStatus(status) {
  const normalized = normalizeStatus(status);
  return normalized === "rest" || normalized === "rested" || normalized === "休息";
}

function resolveDayStatus({ hasWorkout, hasDiary, scheduleStatus }) {
  if (hasWorkout || hasDiary) {
    return "trained";
  }
  if (isRestStatus(scheduleStatus)) {
    return "rest";
  }
  return "none";
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

function getExercisesForDate(plan, date) {
  const template = plan?.scheduleTemplate || null;
  if (!template) {
    return [];
  }
  if (template.exerciseSchedules && plan.scheduleType === "week") {
    const weekday = dayOfWeek(date);
    return Object.keys(template.exerciseSchedules).filter((exerciseId) => {
      const days = template.exerciseSchedules[exerciseId]?.daysOfWeek || [];
      return days.includes(weekday);
    });
  }
  if (template.exerciseSchedules && plan.scheduleType === "month") {
    const day = dayOfMonth(date);
    return Object.keys(template.exerciseSchedules).filter((exerciseId) => {
      const days = template.exerciseSchedules[exerciseId]?.daysOfMonth || [];
      return days.includes(day);
    });
  }
  if (plan.scheduleType === "week") {
    const weekday = dayOfWeek(date);
    return Array.isArray(template.daysOfWeek) && template.daysOfWeek.includes(weekday)
      ? template.exercises || []
      : [];
  }
  if (plan.scheduleType === "month") {
    const day = dayOfMonth(date);
    return Array.isArray(template.daysOfMonth) && template.daysOfMonth.includes(day)
      ? template.exercises || []
      : [];
  }
  return [];
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

  if (plan.scheduleType === "calendar") {
    return { ok: true, data: null };
  }

  const exerciseIds = getExercisesForDate(plan, date);
  if (!exerciseIds.length) {
    return { ok: true, data: null };
  }
  const exerciseList =
    exerciseIds && exerciseIds.length
      ? exerciseIds
      : EXERCISE_SCOPE[plan.exerciseScope] || EXERCISE_SCOPE.six;
  const targets = plan?.scheduleTemplate?.targets || buildFallbackTargets(plan, exerciseIds);

  const schedule = await upsertSchedule(openid, plan.planId, date, {
    exercises: exerciseList,
    targets: targets || buildFallbackTargets(plan, exerciseList),
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
  const normalizedInput = normalizeLogInput(event);
  if (!normalizedInput) {
    return { ok: false, error: "至少填写组数与每组次数" };
  }

  const baseRecord = {
    openid,
    date,
    planId,
    workoutId,
    exerciseId,
    exerciseName: event?.exerciseName || "",
    sets: normalizedInput.sets,
    repsPerSet: normalizedInput.repsPerSet,
    updatedAt: now,
  };

  const existing = await db
    .collection("workouts")
    .where({ openid, date, exerciseId })
    .limit(1)
    .get();

  let mergedRecord = baseRecord;
  if (existing.data.length) {
    mergedRecord = mergeWorkoutRecords(existing.data[0], baseRecord);
    await db.collection("workouts").doc(existing.data[0]._id).update({
      data: mergedRecord,
    });
  } else {
    await db.collection("workouts").add({
      data: {
        ...mergedRecord,
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
  return { ok: true, data: { ...mergedRecord, progress } };
}

async function handleHistory(openid) {
  const result = await db
    .collection("workouts")
    .where({ openid })
    .orderBy("date", "desc")
    .limit(50)
    .get();

  const normalized = result.data.map((item) => {
    const normalizedItem = normalizeWorkoutRecord(item);
    return {
      _id: normalizedItem._id,
      workoutId: normalizedItem.workoutId,
      date: normalizedItem.date,
      exerciseId: normalizedItem.exerciseId,
      exerciseName: normalizedItem.exerciseName || "",
      sets: normalizedItem.sets,
      repsPerSet: normalizedItem.repsPerSet,
      createdAt: normalizedItem.createdAt || null,
      updatedAt: normalizedItem.updatedAt || null,
    };
  });

  return { ok: true, data: normalized };
}

async function handleHistoryRange(openid, event) {
  const dateFrom = String(event?.dateFrom || "").trim();
  const dateTo = String(event?.dateTo || "").trim();
  if (!dateFrom || !dateTo) {
    return { ok: false, error: "缺少日期范围" };
  }

  const result = await db
    .collection("workouts")
    .where({ openid, date: _.gte(dateFrom).and(_.lte(dateTo)) })
    .orderBy("date", "desc")
    .limit(500)
    .get();

  const normalized = result.data.map((item) => {
    const normalizedItem = normalizeWorkoutRecord(item);
    return {
      _id: normalizedItem._id,
      workoutId: normalizedItem.workoutId,
      date: normalizedItem.date,
      exerciseId: normalizedItem.exerciseId,
      exerciseName: normalizedItem.exerciseName || "",
      sets: normalizedItem.sets,
      repsPerSet: normalizedItem.repsPerSet,
      createdAt: normalizedItem.createdAt || null,
      updatedAt: normalizedItem.updatedAt || null,
    };
  });

  return { ok: true, data: normalized };
}

async function findWorkoutForDelete(openid, event = {}) {
  const docId = event?._id || event?.recordId || "";
  if (docId) {
    try {
      const docResult = await db.collection("workouts").doc(docId).get();
      const record = docResult?.data || null;
      if (!record || record.openid !== openid) {
        return null;
      }
      return record;
    } catch (error) {
      return null;
    }
  }

  const date = event?.date || "";
  const exerciseId = event?.exerciseId || "";
  const workoutId = event?.workoutId || "";

  const condition = { openid };
  if (date) {
    condition.date = date;
  }
  if (exerciseId) {
    condition.exerciseId = exerciseId;
  }
  if (workoutId) {
    condition.workoutId = workoutId;
  }

  const result = await db
    .collection("workouts")
    .where(condition)
    .orderBy("updatedAt", "desc")
    .limit(1)
    .get();
  return result.data[0] || null;
}

async function getScheduleForRollback(openid, date, planId) {
  if (!date) {
    return null;
  }
  if (planId) {
    const linked = await getScheduleForDate(openid, planId, date);
    if (linked) {
      return linked;
    }
  }
  const result = await db.collection("schedules").where({ openid, date }).limit(1).get();
  return result.data[0] || null;
}

async function handleDelete(event, openid) {
  const target = await findWorkoutForDelete(openid, event);
  if (!target?._id) {
    return { ok: false, error: "未找到可删除的训练记录" };
  }

  await db.collection("workouts").doc(target._id).remove();

  const affectedDate = target.date || event?.date || "";
  if (!affectedDate) {
    return { ok: true, data: { deletedId: target._id } };
  }

  const [remainingWorkoutResult, diaryResult, schedule] = await Promise.all([
    db.collection("workouts").where({ openid, date: affectedDate }).limit(1).get(),
    db.collection("diaries").where({ openid, date: affectedDate }).limit(1).get(),
    getScheduleForRollback(openid, affectedDate, target.planId || event?.planId || ""),
  ]);

  const hasWorkout = remainingWorkoutResult.data.length > 0;
  const hasDiary = diaryResult.data.length > 0;
  let scheduleStatus = schedule?.status || "";

  // T074: 删除当日最后一条训练记录后，按“休息优先，否则无训练”回退。
  if (!hasWorkout && schedule && !isRestStatus(scheduleStatus)) {
    scheduleStatus = "planned";
    await db.collection("schedules").doc(schedule._id).update({
      data: { status: scheduleStatus, updatedAt: db.serverDate() },
    });
  }

  return {
    ok: true,
    data: {
      deletedId: target._id,
      date: affectedDate,
      status: resolveDayStatus({ hasWorkout, hasDiary, scheduleStatus }),
      hasWorkout,
      hasDiary,
      scheduleStatus: scheduleStatus || null,
    },
  };
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
  if (action === "historyRange") {
    return handleHistoryRange(openid, event);
  }
  if (action === "delete") {
    return handleDelete(event, openid);
  }

  return { ok: false, error: "不支持的操作" };
};
