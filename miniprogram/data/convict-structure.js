const EXERCISES = [
  { id: "push", name: "俯卧撑" },
  { id: "squat", name: "深蹲" },
  { id: "pull", name: "引体向上" },
  { id: "leg", name: "举腿" },
  { id: "bridge", name: "桥" },
  { id: "hand", name: "倒立撑" },
];

function makeDefaultSteps() {
  return Array.from({ length: 10 }, (_, idx) => ({
    level: idx + 1,
    levelName: `第${idx + 1}式`,
  }));
}

const convictStructure = EXERCISES.map((item) => ({
  ...item,
  steps: makeDefaultSteps(),
}));

const planRules = [
  {
    planId: "starter",
    planName: "初试身手",
    weeklySessions: 2,
    exerciseScope: "four",
    exercises: ["push", "leg", "pull", "squat"],
    setsRange: "2-3",
  },
  {
    planId: "improving",
    planName: "渐入佳境",
    weeklySessions: 3,
    exerciseScope: "six",
    exercises: ["push", "leg", "pull", "squat", "bridge", "hand"],
    setsRange: "2-3",
  },
  {
    planId: "advanced",
    planName: "炉火纯青",
    weeklySessions: 6,
    exerciseScope: "six",
    exercises: ["push", "leg", "pull", "squat", "bridge", "hand"],
    setsRange: "2-3",
  },
  {
    planId: "intensive",
    planName: "闭关修炼",
    weeklySessions: 6,
    exerciseScope: "six",
    exercises: ["push", "leg", "pull", "squat", "bridge", "hand"],
    setsRange: "3-5",
  },
  {
    planId: "endurance",
    planName: "登峰造极",
    weeklySessions: 6,
    exerciseScope: "six",
    exercises: ["push", "leg", "pull", "squat", "bridge", "hand"],
    setsRange: "10-50",
  },
];

module.exports = {
  convictStructure,
  planRules,
  EXERCISES,
};
