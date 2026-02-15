const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

const EXERCISES = [
  { id: "push", name: "俯卧撑" },
  { id: "squat", name: "深蹲" },
  { id: "pull", name: "引体向上" },
  { id: "leg", name: "举腿" },
  { id: "bridge", name: "桥" },
  { id: "hand", name: "倒立撑" },
];
const EXERCISE_NAME_MAP = EXERCISES.reduce((acc, item) => {
  acc[item.id] = item.name;
  return acc;
}, {});

const BASIC_EXERCISES = ["push", "leg", "pull", "squat"];
const STAGES = ["初试身手", "渐入佳境", "炉火纯青", "闭关修炼"];

function normalizeStageName(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (STAGES.includes(raw)) {
    return raw;
  }
  if (raw.includes("闭")) {
    return "闭关修炼";
  }
  if (raw.includes("炉")) {
    return "炉火纯青";
  }
  if (raw.includes("渐") || raw.includes("中")) {
    return "渐入佳境";
  }
  return "初试身手";
}

function resolveStageName(planLevel, profileAbilityLevel, gatePassed) {
  const fromPlan = normalizeStageName(planLevel);
  if (fromPlan) {
    return fromPlan;
  }
  const fromProfile = normalizeStageName(profileAbilityLevel);
  if (fromProfile) {
    return fromProfile;
  }
  return gatePassed ? "渐入佳境" : "初试身手";
}

function toMonthString(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
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

function isValidMonth(month) {
  return /^\d{4}-\d{2}$/.test(month || "");
}

function getMonthRange(month) {
  const target = isValidMonth(month) ? month : toMonthString();
  const [yearText, monthText] = target.split("-");
  const year = Number(yearText);
  const monthNum = Number(monthText);
  const lastDay = new Date(year, monthNum, 0).getDate();
  return {
    month: target,
    startDate: `${target}-01`,
    endDate: `${target}-${`${lastDay}`.padStart(2, "0")}`,
    dayCount: lastDay,
  };
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isRestStatus(status) {
  const normalized = normalizeStatus(status);
  return normalized === "rest" || normalized === "rested" || normalized === "休息";
}

function normalizePlanType(schedule) {
  if (!schedule) {
    return "none";
  }
  if (isRestStatus(schedule.status)) {
    return "rest";
  }
  if (Array.isArray(schedule.exercises) && schedule.exercises.length) {
    return "planned";
  }
  return "none";
}

function pickCalendarStatus(planType, hasTraining) {
  if (planType === "rest") {
    return "rest";
  }
  if (planType === "planned") {
    return hasTraining ? "trained" : "planned";
  }
  return hasTraining ? "extra" : "none";
}

function normalizePlannedExercises(schedule) {
  const exercises = Array.isArray(schedule?.exercises) ? schedule.exercises : [];
  return exercises.map((id) => ({
    exerciseId: id,
    exerciseName: EXERCISE_NAME_MAP[id] || id,
  }));
}

function getTemplateExercisesForDate(plan, date) {
  const template = plan?.scheduleTemplate || null;
  if (!template) {
    return [];
  }

  if (template.exerciseSchedules && plan?.scheduleType === "week") {
    const weekday = dayOfWeek(date);
    return Object.keys(template.exerciseSchedules).filter((exerciseId) => {
      const days = template.exerciseSchedules[exerciseId]?.daysOfWeek || [];
      return days.includes(weekday);
    });
  }

  if (template.exerciseSchedules && plan?.scheduleType === "month") {
    const day = dayOfMonth(date);
    return Object.keys(template.exerciseSchedules).filter((exerciseId) => {
      const days = template.exerciseSchedules[exerciseId]?.daysOfMonth || [];
      return days.includes(day);
    });
  }

  if (plan?.scheduleType === "week") {
    const weekday = dayOfWeek(date);
    return Array.isArray(template.daysOfWeek) && template.daysOfWeek.includes(weekday)
      ? template.exercises || []
      : [];
  }

  if (plan?.scheduleType === "month") {
    const day = dayOfMonth(date);
    return Array.isArray(template.daysOfMonth) && template.daysOfMonth.includes(day)
      ? template.exercises || []
      : [];
  }

  return [];
}

function buildPlanDetailFromTemplate(plan, date) {
  if (!plan) {
    return { planType: "none", plannedExercises: [] };
  }
  if (plan.scheduleType === "calendar") {
    return { planType: "none", plannedExercises: [] };
  }

  const exerciseIds = getTemplateExercisesForDate(plan, date);
  if (!exerciseIds.length) {
    return { planType: "rest", plannedExercises: [] };
  }

  return {
    planType: "planned",
    plannedExercises: exerciseIds.map((id) => ({
      exerciseId: id,
      exerciseName: EXERCISE_NAME_MAP[id] || id,
    })),
  };
}

async function buildCalendarStatusMap(openid, monthText, plan) {
  const monthRange = getMonthRange(monthText);
  const { startDate, endDate, dayCount } = monthRange;

  const [workoutsResult, diariesResult, schedulesResult] = await Promise.all([
    db
      .collection("workouts")
      .where({ openid, date: _.gte(startDate).and(_.lte(endDate)) })
      .limit(500)
      .get(),
    db
      .collection("diaries")
      .where({ openid, date: _.gte(startDate).and(_.lte(endDate)) })
      .limit(500)
      .get(),
    db
      .collection("schedules")
      .where({ openid, date: _.gte(startDate).and(_.lte(endDate)) })
      .limit(500)
      .get(),
  ]);

  const trainedDateSet = new Set();
  (workoutsResult.data || []).forEach((item) => {
    if (item?.date) {
      trainedDateSet.add(item.date);
    }
  });
  (diariesResult.data || []).forEach((item) => {
    if (item?.date) {
      trainedDateSet.add(item.date);
    }
  });

  const scheduleByDate = new Map();
  (schedulesResult.data || []).forEach((item) => {
    if (item?.date) {
      scheduleByDate.set(item.date, item);
    }
  });

  const statusMap = {};
  const detailMap = {};
  for (let day = 1; day <= dayCount; day += 1) {
    const date = `${monthRange.month}-${`${day}`.padStart(2, "0")}`;
    const schedule = scheduleByDate.get(date) || null;
    const templateDetail = buildPlanDetailFromTemplate(plan, date);
    const planType = schedule ? normalizePlanType(schedule) : templateDetail.planType;
    const hasTraining = trainedDateSet.has(date);
    statusMap[date] = pickCalendarStatus(planType, hasTraining);
    detailMap[date] = {
      date,
      planType,
      hasTraining,
      scheduleStatus: schedule?.status || "",
      plannedExercises: schedule
        ? normalizePlannedExercises(schedule)
        : templateDetail.plannedExercises,
    };
  }

  return {
    month: monthRange.month,
    calendarStatusMap: statusMap,
    calendarDetailMap: detailMap,
    priority: ["trained", "planned", "rest", "extra", "none"],
  };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { ok: false, error: "无法获取用户身份" };
  }

  const planResult = await db
    .collection("plans")
    .where({ openid, status: "active" })
    .limit(1)
    .get();
  const plan = planResult.data[0] || null;
  const profileResult = await db.collection("profile").where({ openid }).limit(1).get();
  const profile = profileResult.data[0] || null;

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

  const gatePassed = BASIC_EXERCISES.every((id) => {
    const record = progressMap.get(id);
    return (record?.currentStage?.level || 1) >= 6;
  });
  const stageName = resolveStageName(
    plan?.planLevel || "",
    profile?.abilityLevel || "",
    gatePassed
  );
  const lockedExerciseIds = stageName === "初试身手" ? ["bridge", "hand"] : [];
  const calendar = await buildCalendarStatusMap(openid, event?.month || "", plan);

  return {
    ok: true,
    data: {
      items,
      stageName,
      lockedExerciseIds,
      month: calendar.month,
      calendarStatusMap: calendar.calendarStatusMap,
      calendarDetailMap: calendar.calendarDetailMap,
      calendarStatusPriority: calendar.priority,
    },
  };
};

