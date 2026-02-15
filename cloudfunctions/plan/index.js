const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

async function deactivatePlans(openid) {
  const now = db.serverDate();
  await db
    .collection("plans")
    .where({ openid, status: "active" })
    .update({ data: { status: "archived", active: false, updatedAt: now } });

  await db
    .collection("plans")
    .where({ openid, active: true })
    .update({ data: { status: "archived", active: false, updatedAt: now } });
}

async function getCurrentPlan(openid) {
  const byStatus = await db
    .collection("plans")
    .where({ openid, status: "active" })
    .limit(1)
    .get();
  if (byStatus.data.length) {
    return byStatus.data[0];
  }

  const byActive = await db.collection("plans").where({ openid, active: true }).limit(1).get();
  return byActive.data[0] || null;
}

function toDateString(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildTargets(startLevels, setsRange, exerciseIds) {
  return exerciseIds.reduce((acc, id) => {
    acc[id] = {
      level: Number(startLevels?.[id]) || 1,
      setsRange,
    };
    return acc;
  }, {});
}

function deriveTemplateFromSchedules(scheduleType, schedules = []) {
  if (!schedules.length) {
    return null;
  }
  if (scheduleType === "week") {
    const daysOfWeek = schedules
      .map((item) => {
        const date = new Date(`${item.date}T00:00:00`);
        const day = date.getDay();
        return day === 0 ? 7 : day;
      })
      .filter((item) => Number.isFinite(item));
    return { daysOfWeek: Array.from(new Set(daysOfWeek)) };
  }
  if (scheduleType === "month") {
    const daysOfMonth = schedules
      .map((item) => {
        const date = new Date(`${item.date}T00:00:00`);
        return date.getDate();
      })
      .filter((item) => Number.isFinite(item));
    return { daysOfMonth: Array.from(new Set(daysOfMonth)) };
  }
  return null;
}

async function upsertSchedules(openid, planId, schedules) {
  if (!Array.isArray(schedules) || !schedules.length) {
    return [];
  }

  const now = db.serverDate();
  const results = [];

  for (const item of schedules) {
    const date = item?.date;
    if (!date) {
      continue;
    }
    const scheduleId = item?.scheduleId || `sched_${planId}_${date}`;
    const data = {
      scheduleId,
      openid,
      planId,
      date,
      exercises: item?.exercises || [],
      targets: item?.targets || {},
      status: item?.status || "planned",
      swapped: Boolean(item?.swapped),
      updatedAt: now,
      generated: Boolean(item?.generated),
    };

    const existing = await db
      .collection("schedules")
      .where({ openid, planId, date })
      .limit(1)
      .get();
    if (existing.data.length) {
      await db.collection("schedules").doc(existing.data[0]._id).update({ data });
    } else {
      await db.collection("schedules").add({ data: { ...data, createdAt: now } });
    }

    results.push(data);
  }

  return results;
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { ok: false, error: "无法获取用户身份" };
  }

  const action = event?.action || "create";

  if (action === "current") {
    const plan = await getCurrentPlan(openid);
    if (!plan) {
      return { ok: false, error: "未创建计划" };
    }
    return { ok: true, data: plan };
  }

  if (action === "reset") {
    await deactivatePlans(openid);
    return { ok: true, data: { reset: true } };
  }

  if (action !== "create") {
    return { ok: false, error: "不支持的操作" };
  }

  await deactivatePlans(openid);

  const now = db.serverDate();
  const planId = event?.planId || `plan_${Date.now()}`;
  const scheduleType = event?.scheduleType || "week";

  const schedules = Array.isArray(event?.schedules) ? event.schedules : [];
  const templateFromSchedules = deriveTemplateFromSchedules(scheduleType, schedules);
  const templateExercises = schedules[0]?.exercises || event?.exercises || [];
  const templateTargets =
    schedules[0]?.targets || buildTargets(event?.startLevels || {}, event?.setsRange || "", templateExercises);
  const scheduleTemplate =
    event?.scheduleTemplate ||
    (scheduleType === "calendar"
      ? null
      : {
          type: scheduleType,
          ...templateFromSchedules,
          exercises: templateExercises,
          targets: templateTargets,
        });

  const data = {
    openid,
    planId,
    planName: event?.planName || "训练计划",
    planType: event?.planType || "自建",
    planLevel: event?.planLevel || "",
    weeklySessions: Number(event?.weeklySessions) || 0,
    setsRange: event?.setsRange || "",
    exerciseScope: event?.exerciseScope || "six",
    scheduleType,
    scheduleTemplate,
    status: "active",
    active: true,
    startLevels: event?.startLevels || {},
    recommendationId: event?.recommendationId || event?.recommendation?.recommendationId || "",
    createdAt: now,
    updatedAt: now,
  };

  await db.collection("plans").add({ data });

  let savedSchedules = [];
  if (scheduleType === "calendar" && schedules.length) {
    savedSchedules = await upsertSchedules(openid, planId, schedules);
  }

  return {
    ok: true,
    data: {
      ...data,
      schedules: savedSchedules,
    },
  };
};
