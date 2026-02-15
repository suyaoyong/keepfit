const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

function buildDateRangeCondition(dateFrom, dateTo) {
  if (dateFrom && dateTo) {
    return _.gte(dateFrom).and(_.lte(dateTo));
  }
  if (dateFrom) {
    return _.gte(dateFrom);
  }
  if (dateTo) {
    return _.lte(dateTo);
  }
  return null;
}

async function getSchedules(openid, event) {
  const planId = event?.planId || "";
  const date = event?.date || "";
  const dateFrom = event?.dateFrom || "";
  const dateTo = event?.dateTo || "";

  const condition = { openid };
  if (planId) {
    condition.planId = planId;
  }

  if (date) {
    condition.date = date;
  } else {
    const dateRange = buildDateRangeCondition(dateFrom, dateTo);
    if (dateRange) {
      condition.date = dateRange;
    }
  }

  const result = await db
    .collection("schedules")
    .where(condition)
    .orderBy("date", "asc")
    .limit(200)
    .get();

  return { ok: true, data: result.data };
}

async function upsertSchedules(openid, event) {
  const schedules = Array.isArray(event?.schedules) ? event.schedules : [];
  const planId = event?.planId || "";
  const now = db.serverDate();

  if (!schedules.length) {
    return { ok: false, error: "缺少排期数据" };
  }

  const results = [];

  for (const item of schedules) {
    const date = item?.date;
    if (!date) {
      results.push({ ok: false, error: "排期缺少日期" });
      continue;
    }

    const scheduleId = item?.scheduleId || `sched_${planId || "plan"}_${date}`;
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
    };

    const query = { openid, date };
    if (planId) {
      query.planId = planId;
    }

    const existing = await db.collection("schedules").where(query).limit(1).get();
    if (existing.data.length) {
      await db.collection("schedules").doc(existing.data[0]._id).update({ data });
    } else {
      await db.collection("schedules").add({ data: { ...data, createdAt: now } });
    }

    results.push({ ok: true, data });
  }

  return { ok: true, data: results };
}

async function swapSchedules(openid, event) {
  const planId = event?.planId || "";
  const fromDate = event?.fromDate || "";
  const toDate = event?.toDate || "";

  if (!fromDate || !toDate) {
    return { ok: false, error: "缺少交换日期" };
  }

  const condition = { openid };
  if (planId) {
    condition.planId = planId;
  }

  const list = await db
    .collection("schedules")
    .where({ ...condition, date: _.in([fromDate, toDate]) })
    .get();

  const fromItem = list.data.find((item) => item.date === fromDate);
  const toItem = list.data.find((item) => item.date === toDate);

  if (!fromItem || !toItem) {
    return { ok: false, error: "交换日期排期不存在" };
  }

  const now = db.serverDate();
  const baseFrom = {
    scheduleId: `sched_${planId || "plan"}_${fromDate}`,
    openid,
    planId,
    date: fromDate,
    exercises: toItem.exercises || [],
    targets: toItem.targets || {},
    status: toItem.status || "planned",
    swapped: true,
    updatedAt: now,
    generated: Boolean(toItem.generated),
  };

  const baseTo = {
    scheduleId: `sched_${planId || "plan"}_${toDate}`,
    openid,
    planId,
    date: toDate,
    exercises: fromItem.exercises || [],
    targets: fromItem.targets || {},
    status: fromItem.status || "planned",
    swapped: true,
    updatedAt: now,
    generated: Boolean(fromItem.generated),
  };

  await db.collection("schedules").doc(fromItem._id).update({ data: baseFrom });
  await db.collection("schedules").doc(toItem._id).update({ data: baseTo });

  return { ok: true, data: { from: baseFrom, to: baseTo } };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { ok: false, error: "无法获取用户身份" };
  }

  const action = event?.action || "get";
  if (action === "get") {
    return getSchedules(openid, event);
  }
  if (action === "upsert") {
    return upsertSchedules(openid, event);
  }
  if (action === "swap") {
    return swapSchedules(openid, event);
  }

  return { ok: false, error: "不支持的操作" };
};
