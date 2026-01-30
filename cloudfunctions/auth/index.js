const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { ok: false, error: "无法获取用户身份" };
  }

  const action = event?.action || "login";
  const now = db.serverDate();

  if (action === "profile") {
    const existing = await db.collection("auth").where({ openid }).limit(1).get();
    return {
      ok: true,
      data:
        existing.data[0] || {
          openid,
          status: "guest",
        },
    };
  }

  if (action !== "login") {
    return { ok: false, error: "不支持的操作" };
  }

  const profile = event?.profile || {};
  const data = {
    openid,
    nickName: profile.nickName || event?.nickName || "",
    avatarUrl: profile.avatarUrl || event?.avatarUrl || "",
    scope: event?.scope || profile.scope || "basic",
    status: event?.status || "authorized",
    updatedAt: now,
  };

  const existing = await db.collection("auth").where({ openid }).limit(1).get();
  if (existing.data.length) {
    await db.collection("auth").doc(existing.data[0]._id).update({ data });
  } else {
    await db.collection("auth").add({ data: { ...data, createdAt: now } });
  }

  return {
    ok: true,
    data: {
      ...data,
      appid: wxContext.APPID,
      unionid: wxContext.UNIONID,
    },
  };
};
