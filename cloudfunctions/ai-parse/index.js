const cloud = require("wx-server-sdk");
const tcb = require("@cloudbase/node-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const app = tcb.init({
  env: process.env.TCB_ENV || process.env.SCF_NAMESPACE || process.env.CLOUDBASE_ENV || cloud.DYNAMIC_CURRENT_ENV,
});

const EXERCISE_IDS = ["push", "squat", "pull", "leg", "bridge", "hand"];
const ANALYSIS_FIELDS = [
  "summary",
  "consistency",
  "volumeTrend",
  "strengthFocus",
  "extraTrainingInsight",
  "planFocus",
];
const BLOCKED_PATTERNS = [
  /医疗/i,
  /诊断/i,
  /处方/i,
  /药物/i,
  /康复治疗/i,
  /手术/i,
  /病症/i,
  /你患有/i,
  /必须停止训练/i,
  /超出计划/i,
  /替代你的训练计划/i,
  /医疗建议/i,
];

function buildParseSystemPrompt() {
  return `浣犳槸璁粌璁板綍瑙ｆ瀽鍔╂墜銆傚彧杈撳嚭涓€涓?JSON 瀵硅薄锛屼笉瑕佸寘鍚唬鐮佸潡鎴栧浣欐枃鏈€?
杈撳嚭鏍煎紡锛圝SON key 蹇呴』浣跨敤鑻辨枃锛夛細
{
  "items": [
    {
      "exerciseId": "push|squat|pull|leg|bridge|hand",
      "exerciseName": "鍔ㄤ綔涓枃鍚?,
      "sets": 鏁板瓧,
      "reps": 鏁板瓧,
      "confidence": 0~1鏁板瓧
    }
  ]
}

瑙勫垯锛?1) 鏀寔涓€娆¤В鏋愬涓姩浣滐紱鏈彁鍙婄殑鍔ㄤ綔涓嶈杈撳嚭銆?2) 浠呬繚鐣欌€滃姩浣溿€佺粍鏁般€佹鏁扳€濈浉鍏冲瓧娈碉紝绂佹杈撳嚭鍏朵粬瀛楁銆?3) 缁勬暟涓庢鏁板繀椤绘槸姝ｆ暣鏁般€?4) 鍚屼竴鍔ㄤ綔鑻ュ湪鏂囨湰涓噸澶嶅嚭鐜帮紝璇峰厛鑱氬悎涓轰竴鏉″啀杈撳嚭銆?
鍔ㄤ綔ID鏄犲皠锛氫刊鍗ф拺=push锛屾繁韫?squat锛屽紩浣撳悜涓?pull锛屼妇鑵?leg锛屾ˉ=bridge锛屽€掔珛鎾?hand銆?
绀轰緥杈撳嚭锛?{"items":[{"exerciseId":"leg","exerciseName":"涓捐吙","sets":3,"reps":12,"confidence":0.87},{"exerciseId":"squat","exerciseName":"娣辫共","sets":2,"reps":20,"confidence":0.90}]}`;
}

function buildProgressAnalysisPrompt(recordsText, profileContext) {
  const safeProfileContext = String(profileContext || "").trim() || "未提供";
  return `你是训练记录总结助手。你的任务是基于用户“已有训练计划”和“训练记录”生成结构化总结。
【输出格式】
- 只允许输出一个 JSON 对象
- 不允许 Markdown、不允许代码块、不允许额外解释
- 仅允许以下 6 个字段，且必须全部返回：summary, consistency, volumeTrend, strengthFocus, extraTrainingInsight, planFocus
【字段要求】
- summary：近期训练总览（40-90字）
- consistency：训练连续性观察（40-90字）
- volumeTrend：训练量变化趋势（40-90字）
- strengthFocus：六艺动作表现（40-90字）
- extraTrainingInsight：其他训练观察（40-90字）
- planFocus：下一步关注点（40-90字，最多2条可执行建议）
【分析边界】
- 仅基于提供的数据，不得臆测未提供信息
- 数据不足时必须明确写“样本不足”或“波动较大”，不得下强结论
- 禁止输出医疗建议、诊断、处方、康复/手术建议
- 禁止输出营养处方、补剂方案、疼痛处置方案
- 禁止输出超出用户既有计划的训练指导
- 禁止使用“保证/一定/必须”等承诺式表述
【个性化优先级】
优先参考：训练目标、每周可训练天数、疲劳等级、伤痛限制
次级参考：身高、体重、性别、年龄段
【写作要求】
- 使用简洁中文，避免空话
- 每个字段尽量包含可验证依据（如频次、组次、动作完成情况）
- 与用户动作名称保持一致（如俯卧撑、深蹲、引体向上、举腿、桥、倒立撑）
【输入数据】
用户资料：
${safeProfileContext}
训练记录（时间窗口：最近30天，最多20条）：
${recordsText}`;
}

function extractText(res) {
  return (
    res?.text ||
    res?.data?.text ||
    res?.data?.choices?.[0]?.message?.content ||
    res?.choices?.[0]?.message?.content ||
    res?.data?.output?.text ||
    res?.result?.content ||
    ""
  );
}

function safeParse(content) {
  const trimmed = (content || "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerError) {
        return null;
      }
    }
    return null;
  }
}

function containsBlockedContent(text) {
  const content = String(text || "");
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(content));
}

function sanitizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function mapExerciseId(rawId, rawName) {
  const mapping = {
    push: "push",
    squat: "squat",
    pull: "pull",
    leg: "leg",
    bridge: "bridge",
    hand: "hand",
    俯卧撑: "push",
    深蹲: "squat",
    引体向上: "pull",
    举腿: "leg",
    桥: "bridge",
    倒立撑: "hand",
  };
  const fromId = String(rawId || "").trim();
  if (mapping[fromId]) {
    return mapping[fromId];
  }
  const fromName = String(rawName || "").trim();
  return mapping[fromName] || "";
}

function normalizeParseResult(raw, rawText) {
  const payload = raw && typeof raw === "object" ? raw : {};
  const fallbackSingle =
    payload.exerciseId || payload.exerciseName
      ? [
          {
            exerciseId: payload.exerciseId,
            exerciseName: payload.exerciseName,
            sets: payload.sets,
            reps: payload.reps,
            confidence: payload.confidence,
          },
        ]
      : [];
  const sourceItems = Array.isArray(payload.items) ? payload.items : fallbackSingle;
  const merged = {};

  sourceItems.forEach((item) => {
    const normalizedExerciseId = mapExerciseId(item?.exerciseId, item?.exerciseName);
    if (!normalizedExerciseId || !EXERCISE_IDS.includes(normalizedExerciseId)) {
      return;
    }
    const sets = Math.max(0, Math.floor(sanitizeNumber(item?.sets, 0)));
    const reps = Math.max(0, Math.floor(sanitizeNumber(item?.reps, 0)));
    if (!sets || !reps) {
      return;
    }
    const confidence = Number(
      Math.min(1, Math.max(0, sanitizeNumber(item?.confidence, 0))).toFixed(2)
    );
    const prev = merged[normalizedExerciseId];
    if (!prev || confidence >= prev.confidence) {
      merged[normalizedExerciseId] = {
        exerciseId: normalizedExerciseId,
        exerciseName: String(item?.exerciseName || "").trim(),
        sets,
        reps,
        confidence,
      };
    }
  });

  const items = Object.values(merged);
  if (!items.length && rawText) {
    return { items: [] };
  }
  return { items };
}

function normalizeAnalysisResult(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const normalized = {};
  ANALYSIS_FIELDS.forEach((field) => {
    normalized[field] = String(source[field] || "").trim();
  });
  return normalized;
}

async function generateByModel(systemPrompt, userText) {
  const ai = app.ai();
  const model = ai.createModel("hunyuan-exp");
  const res = await model.generateText({
    model: "hunyuan-turbos-latest",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
    temperature: 0.2,
    maxTokens: 512,
  });
  return extractText(res);
}

async function handleParseWorkout(event, debugId) {
  const rawText = String(event?.rawText || "").trim();
  if (!rawText) {
    return { ok: false, error: `缺少训练描述内容（${debugId}）`, debugId };
  }

  const content = await generateByModel(buildParseSystemPrompt(), rawText);
  const parsed = safeParse(content);
  const normalized = normalizeParseResult(parsed, rawText);
  return { ok: true, data: normalized, debugId };
}

async function handleAnalyzeProgress(event, debugId) {
  const recordsText = String(event?.recordsText || "").trim();
  const profileContext = String(event?.profileContext || "").trim();
  if (!recordsText) {
    return { ok: false, error: `缺少训练记录内容（${debugId}）`, code: "EMPTY_RECORDS", debugId };
  }

  const prompt = buildProgressAnalysisPrompt(recordsText, profileContext);
  const content = await generateByModel("你必须严格输出 JSON。", prompt);
  const parsed = safeParse(content);
  const normalized = normalizeAnalysisResult(parsed);
  const textToCheck = ANALYSIS_FIELDS.map((key) => normalized[key]).join("\n");

  if (containsBlockedContent(textToCheck)) {
    return {
      ok: false,
      error: `检测到越界内容，已拦截（${debugId}）`,
      code: "BOUNDARY_BLOCKED",
      debugId,
    };
  }

  if (!textToCheck.trim()) {
    return {
      ok: false,
      error: `AI 未返回有效模板内容（${debugId}）`,
      code: "TEMPLATE_EMPTY",
      debugId,
    };
  }

  return { ok: true, data: normalized, debugId };
}

exports.main = async (event) => {
  const debugId = `ai_${Date.now()}`;
  const action = event?.action || "parseWorkout";

  try {
    if (action === "analyzeProgress") {
      return await handleAnalyzeProgress(event, debugId);
    }
    return await handleParseWorkout(event, debugId);
  } catch (error) {
    return {
      ok: false,
      error: `${error?.message || "AI 解析失败"}（${debugId}）`,
      code: error?.code || error?.errCode || "",
      debugId,
    };
  }
};

