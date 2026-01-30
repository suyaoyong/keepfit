const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

async function resolveVersion(requestedVersion) {
  if (requestedVersion) {
    return requestedVersion;
  }

  const latest = await db.collection("methods").orderBy("updatedAt", "desc").limit(1).get();
  return latest.data[0]?.version || "";
}

exports.main = async (event, context) => {
  const version = await resolveVersion(event?.version);
  if (!version) {
    return { ok: true, data: { version: "", items: [] } };
  }

  const condition = { version };
  if (event?.exerciseId) {
    condition.exerciseId = event.exerciseId;
  }
  if (event?.level) {
    condition.level = Number(event.level);
  }

  const result = await db
    .collection("methods")
    .where(condition)
    .orderBy("exerciseId", "asc")
    .orderBy("level", "asc")
    .limit(200)
    .get();

  return {
    ok: true,
    data: {
      version,
      items: result.data,
    },
  };
};
