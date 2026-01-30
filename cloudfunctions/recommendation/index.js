const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

const DEFAULT_RULES = [
  {
    ruleId: "rule_basic",
    planName: "初试身手",
    weeklySessions: 2,
    exerciseScope: "four",
    exercises: ["push", "leg", "pull", "squat"],
    setsRange: "2-3",
  },
  {
    ruleId: "rule_progress",
    planName: "渐入佳境",
    weeklySessions: 3,
    exerciseScope: "six",
    exercises: ["push", "leg", "pull", "squat", "bridge", "hand"],
    setsRange: "2-3",
  },
  {
    ruleId: "rule_mastery",
    planName: "炉火纯青",
    weeklySessions: 6,
    exerciseScope: "six",
    exercises: ["push", "leg", "pull", "squat", "bridge", "hand"],
    setsRange: "2-3",
  },
  {
    ruleId: "rule_retreat",
    planName: "闭关修炼",
    weeklySessions: 6,
    exerciseScope: "six",
    exercises: ["push", "leg", "pull", "squat", "bridge", "hand"],
    setsRange: "3-5",
  },
  {
    ruleId: "rule_peak",
    planName: "登峰造极",
    weeklySessions: 6,
    exerciseScope: "six",
    exercises: ["push", "leg", "pull", "squat", "bridge", "hand"],
    setsRange: "10-50",
  },
];

function parseWeeklySessions(value) {
  if (typeof value === "number") {
    return value;
  }
  if (!value) {
    return 0;
  }
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : 0;
}

async function loadRules() {
  const rules = await db.collection("plan_rules").orderBy("updatedAt", "desc").limit(50).get();
  if (!rules.data.length) {
    return { version: "local", rules: DEFAULT_RULES };
  }
  const version = rules.data[0]?.version || "unknown";
  const filtered = rules.data.filter((item) => item.version === version);
  return { version, rules: filtered.length ? filtered : rules.data };
}

function pickRule(rules, event, profile) {
  if (event?.planName) {
    const byName = rules.find((rule) => rule.planName === event.planName);
    if (byName) {
      return byName;
    }
  }

  const weeklySessions = parseWeeklySessions(event?.weeklySessions || profile?.trainingFrequency);
  if (weeklySessions) {
    const byFrequency = rules.find((rule) => rule.weeklySessions === weeklySessions);
    if (byFrequency) {
      return byFrequency;
    }
  }

  return rules.find((rule) => rule.planName === "渐入佳境") || rules[0];
}

exports.main = async (event, context) => {
  const profile = event?.profile || {};
  const startLevels = event?.startLevels || {};

  const { version, rules } = await loadRules();
  const rule = pickRule(rules, event, profile);

  return {
    ok: true,
    data: {
      recommendationId: `rec_${Date.now()}`,
      ruleVersion: version,
      planName: rule.planName,
      weeklySessions: rule.weeklySessions,
      exerciseScope: rule.exerciseScope,
      exercises: rule.exercises,
      setsRange: rule.setsRange,
      startLevels,
      profileSnapshot: {
        abilityLevel: profile.abilityLevel || "",
        trainingFrequency: profile.trainingFrequency || "",
        sessionDuration: profile.sessionDuration || "",
        injuryNotes: profile.injuryNotes || "",
      },
    },
  };
};
