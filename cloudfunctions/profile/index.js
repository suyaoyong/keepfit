const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const action = event?.action || "get";
  const profile = event?.profile || {};

  if (!openid) {
    return { ok: false, error: "无法获取用户身份" };
  }

  if (action === "set") {
    const now = db.serverDate();
    const data = {
      openid,
      abilityLevel: profile.abilityLevel || "",
      trainingFrequency: profile.trainingFrequency || "",
      sessionDuration: profile.sessionDuration || "",
      injuryNotes: profile.injuryNotes || "",
      updatedAt: now,
    };

    const existing = await db
      .collection("profile")
      .where({ openid })
      .limit(1)
      .get();

    if (existing.data.length) {
      await db.collection("profile").doc(existing.data[0]._id).update({ data });
      return { ok: true, data };
    }

    await db.collection("profile").add({
      data: {
        ...data,
        createdAt: now,
      },
    });
    return { ok: true, data };
  }

  const result = await db.collection("profile").where({ openid }).limit(1).get();
  return { ok: true, data: result.data[0] || null };
};
