const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

function maskOpenId(openid) {
  const text = String(openid || "");
  if (text.length <= 6) {
    return text || "unknown";
  }
  return `***${text.slice(-6)}`;
}

function buildFeedbackId() {
  return `F${Date.now()}`;
}

async function loadNickName(openid) {
  try {
    const auth = await db.collection("auth").where({ openid }).limit(1).get();
    return auth?.data?.[0]?.nickName || "";
  } catch (error) {
    return "";
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const action = event?.action || "submit";

  if (!openid) {
    return { ok: false, error: "无法获取用户身份" };
  }

  if (action !== "submit") {
    return { ok: false, error: "不支持的操作" };
  }

  const content = String(event?.content || "").trim();
  const contact = String(event?.contact || "").trim();
  const source = String(event?.source || "mine-feedback-modal").trim();

  if (!content || content.length < 10) {
    return { ok: false, error: "请至少输入10字问题描述" };
  }

  const feedbackId = buildFeedbackId();
  const nickName = await loadNickName(openid);

  await db.collection("feedback").add({
    data: {
      feedbackId,
      openid,
      openidMasked: maskOpenId(openid),
      nickName,
      content,
      contact,
      source,
      status: "new",
      notifyStatus: "disabled",
      notifyError: "企业微信通知已停用",
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });

  return {
    ok: true,
    data: {
      feedbackId,
      pushed: false,
      pushError: "企业微信通知已停用",
    },
  };
};
