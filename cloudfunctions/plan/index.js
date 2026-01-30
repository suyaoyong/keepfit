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

  const data = {
    openid,
    planId,
    planName: event?.planName || "训练计划",
    planType: event?.planType || "自建",
    planLevel: event?.planLevel || "",
    weeklySessions: Number(event?.weeklySessions) || 0,
    setsRange: event?.setsRange || "",
    exerciseScope: event?.exerciseScope || "six",
    scheduleType: event?.scheduleType || "week",
    status: "active",
    active: true,
    startLevels: event?.startLevels || {},
    recommendationId: event?.recommendationId || event?.recommendation?.recommendationId || "",
    createdAt: now,
    updatedAt: now,
  };

  await db.collection("plans").add({ data });
  const schedules = await upsertSchedules(openid, planId, event?.schedules || []);

  return {
    ok: true,
    data: {
      ...data,
      schedules,
    },
  };
};
