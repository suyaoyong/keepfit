const https = require("https");
const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const FEISHU_DEFAULT_BASE_URL = "https://open.feishu.cn";

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

function formatDateTime(date = new Date()) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  const ss = `${date.getSeconds()}`.padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function normalizeBaseUrl(rawUrl) {
  const text = String(rawUrl || FEISHU_DEFAULT_BASE_URL).trim();
  return text.replace(/\/+$/, "");
}

function requestJson({ method = "GET", url, headers = {}, body, timeoutMs = 12000 }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        Accept: "application/json",
        ...headers,
      },
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      let chunks = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        chunks += chunk;
      });
      res.on("end", () => {
        let parsedBody = null;
        if (chunks) {
          try {
            parsedBody = JSON.parse(chunks);
          } catch (error) {
            parsedBody = null;
          }
        }
        resolve({
          statusCode: res.statusCode || 0,
          body: parsedBody,
          rawBody: chunks,
        });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", (error) => reject(error));

    if (body !== undefined && body !== null) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function getFeishuConfig() {
  const appId = String(process.env.FEISHU_APP_ID || "").trim();
  const appSecret = String(process.env.FEISHU_APP_SECRET || "").trim();
  const receiveId = String(process.env.FEISHU_RECEIVE_ID || "").trim();
  const receiveIdType = String(process.env.FEISHU_RECEIVE_ID_TYPE || "chat_id").trim();
  const baseUrl = normalizeBaseUrl(process.env.FEISHU_BASE_URL);
  return { appId, appSecret, receiveId, receiveIdType, baseUrl };
}

function buildFeishuTextMessage(payload) {
  const nick = payload.nickName ? `${payload.nickName}` : "未填写昵称";
  const contact = payload.contact ? payload.contact : "未填写";
  const content = String(payload.content || "").trim();
  return [
    "【KeepFit 小程序问题反馈】",
    `反馈ID: ${payload.feedbackId}`,
    `时间: ${formatDateTime()}`,
    `昵称: ${nick}`,
    `用户: ${payload.openidMasked}`,
    `联系方式: ${contact}`,
    `来源: ${payload.source || "mine-feedback-modal"}`,
    "",
    "反馈内容:",
    content,
  ].join("\n");
}

async function fetchTenantAccessToken(config) {
  const authUrl = `${config.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`;
  const resp = await requestJson({
    method: "POST",
    url: authUrl,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: {
      app_id: config.appId,
      app_secret: config.appSecret,
    },
  });

  const code = Number(resp?.body?.code);
  if (resp.statusCode !== 200 || code !== 0 || !resp?.body?.tenant_access_token) {
    throw new Error(
      `飞书鉴权失败: status=${resp.statusCode}, code=${resp?.body?.code || ""}, msg=${resp?.body?.msg || ""}`
    );
  }
  return resp.body.tenant_access_token;
}

async function sendToFeishu(config, messageText) {
  if (!config.appId || !config.appSecret || !config.receiveId) {
    return {
      pushed: false,
      skipped: true,
      error: "未配置 FEISHU_APP_ID/FEISHU_APP_SECRET/FEISHU_RECEIVE_ID",
    };
  }

  const tenantToken = await fetchTenantAccessToken(config);
  const sendUrl = `${config.baseUrl}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(
    config.receiveIdType
  )}`;
  const resp = await requestJson({
    method: "POST",
    url: sendUrl,
    headers: {
      Authorization: `Bearer ${tenantToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: {
      receive_id: config.receiveId,
      msg_type: "text",
      content: JSON.stringify({ text: messageText }),
    },
  });

  const code = Number(resp?.body?.code);
  if (resp.statusCode !== 200 || code !== 0) {
    return {
      pushed: false,
      skipped: false,
      error: `飞书发送失败: status=${resp.statusCode}, code=${resp?.body?.code || ""}, msg=${
        resp?.body?.msg || ""
      }`,
    };
  }

  return {
    pushed: true,
    skipped: false,
    messageId: resp?.body?.data?.message_id || "",
    error: "",
  };
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
  const openidMasked = maskOpenId(openid);

  const addRes = await db.collection("feedback").add({
    data: {
      feedbackId,
      openid,
      openidMasked,
      nickName,
      content,
      contact,
      source,
      status: "new",
      notifyStatus: "pending",
      notifyError: "",
      notifyMessageId: "",
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });

  const feishuConfig = getFeishuConfig();
  let pushResult = {
    pushed: false,
    skipped: true,
    error: "未执行推送",
    messageId: "",
  };

  try {
    pushResult = await sendToFeishu(
      feishuConfig,
      buildFeishuTextMessage({
        feedbackId,
        nickName,
        openidMasked,
        content,
        contact,
        source,
      })
    );
  } catch (error) {
    pushResult = {
      pushed: false,
      skipped: false,
      error: `飞书推送异常: ${error?.message || error}`,
      messageId: "",
    };
  }

  const nextNotifyStatus = pushResult.pushed ? "pushed" : pushResult.skipped ? "skipped" : "failed";
  await db.collection("feedback").doc(addRes._id).update({
    data: {
      notifyStatus: nextNotifyStatus,
      notifyError: pushResult.error || "",
      notifyMessageId: pushResult.messageId || "",
      updatedAt: db.serverDate(),
    },
  });

  return {
    ok: true,
    data: {
      feedbackId,
      pushed: Boolean(pushResult.pushed),
      pushError: pushResult.error || "",
      notifyStatus: nextNotifyStatus,
      notifyMessageId: pushResult.messageId || "",
    },
  };
};
