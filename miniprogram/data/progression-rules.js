const progressionRules = {
  idempotency: "overwrite",
  rpeMaxForUpgrade: 8,
  fourToSixGate: {
    requiredExercises: ["push", "leg", "pull", "squat"],
    requiredLevel: 6,
    unlockExercises: ["bridge", "hand"],
  },
  defaultUnlockCondition: "完成升级标准且 RPE 不超过 8",
};

module.exports = {
  progressionRules,
};
