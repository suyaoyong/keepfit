const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadProfileWithMock(mockCloud) {
  const modulePath = require.resolve("./index.js");
  const originalLoad = Module._load;

  delete require.cache[modulePath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "wx-server-sdk") {
      return mockCloud;
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function createMockDb(state = {}) {
  const collections = {
    profile: [],
    ...state,
  };

  function collection(name) {
    const docs = collections[name] || [];
    return {
      where(query = {}) {
        const matches = docs.filter((doc) =>
          Object.entries(query).every(([key, value]) => doc[key] === value)
        );
        return {
          limit(count) {
            return {
              async get() {
                return { data: matches.slice(0, count).map((item) => ({ ...item })) };
              },
            };
          },
        };
      },
      doc(id) {
        return {
          async update({ data }) {
            const index = docs.findIndex((item) => item._id === id);
            if (index >= 0) {
              docs[index] = { ...docs[index], ...data };
            }
            return { stats: { updated: index >= 0 ? 1 : 0 } };
          },
        };
      },
      async add({ data }) {
        const next = { _id: `${name}-${docs.length + 1}`, ...data };
        docs.push(next);
        return { _id: next._id };
      },
    };
  }

  return {
    serverDate() {
      return new Date("2026-06-12T00:00:00.000Z");
    },
    collection,
  };
}

function createMockCloud(state = {}) {
  return {
    init() {},
    database() {
      return createMockDb(state);
    },
    getWXContext() {
      return { OPENID: "test-openid" };
    },
  };
}

test("profile set persists AI required profile fields and get returns them", async () => {
  const state = { profile: [] };
  const profile = loadProfileWithMock(createMockCloud(state));

  const saved = await profile.main(
    {
      action: "set",
      profile: {
        abilityLevel: "beginner",
        heightCm: "175",
        weightKg: "70",
        weeklyTrainingDays: "3-4天",
      },
    },
    {}
  );
  const loaded = await profile.main({ action: "get" }, {});

  assert.equal(saved.ok, true);
  assert.equal(saved.data.heightCm, "175");
  assert.equal(saved.data.weightKg, "70");
  assert.equal(saved.data.weeklyTrainingDays, "3-4天");
  assert.equal(loaded.data.heightCm, "175");
  assert.equal(loaded.data.weightKg, "70");
  assert.equal(loaded.data.weeklyTrainingDays, "3-4天");
});

test("profile set preserves existing fields when saving AI required fields only", async () => {
  const state = {
    profile: [
      {
        _id: "profile-1",
        openid: "test-openid",
        abilityLevel: "beginner",
        trainingFrequency: "weekly",
        sessionDuration: "30",
      },
    ],
  };
  const profile = loadProfileWithMock(createMockCloud(state));

  const saved = await profile.main(
    {
      action: "set",
      profile: {
        heightCm: "180",
        weightKg: "75",
        weeklyTrainingDays: "5天及以上",
      },
    },
    {}
  );

  assert.equal(saved.ok, true);
  assert.equal(saved.data.abilityLevel, "beginner");
  assert.equal(saved.data.trainingFrequency, "weekly");
  assert.equal(saved.data.sessionDuration, "30");
  assert.equal(saved.data.heightCm, "180");
  assert.equal(saved.data.weightKg, "75");
  assert.equal(saved.data.weeklyTrainingDays, "5天及以上");
});
