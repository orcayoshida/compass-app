const Anthropic = require("@anthropic-ai/sdk");

// In-memory rate limiting (resets on cold start)
const rateLimitMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > RATE_WINDOW_MS) {
    entry.count = 1;
    entry.windowStart = now;
  } else {
    entry.count++;
  }

  rateLimitMap.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

function validateBody(body) {
  if (!body || typeof body !== "object") return false;
  const { type, company, industry, qa } = body;
  if (!["generate_questions", "generate_results"].includes(type)) return false;
  if (typeof company !== "string" || company.length === 0 || company.length > 100) return false;
  if (typeof industry !== "string" || industry.length === 0 || industry.length > 100) return false;
  if (type === "generate_results") {
    if (!Array.isArray(qa) || qa.length !== 5) return false;
  }
  return true;
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Rate limiting
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      error: "リクエストが多すぎます。1時間後に再度お試しください。",
    });
  }

  // Validate
  const body = req.body;
  if (!validateBody(body)) {
    return res.status(400).json({ error: "リクエストの形式が正しくありません。" });
  }

  const { type, company, industry, qa } = body;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    if (type === "generate_questions") {
      const prompt = `あなたは現役OB・OGの本音データをもとに就活生をサポートするキャリアアドバイザーです。
業界・企業の綺麗事ではないリアルを踏まえた上で、就活生が自分自身と向き合うための本質的な問いを5つ生成してください。

対象企業: ${company}
対象業界: ${industry}

【ルール】
- 質問は1つの問いに絞ること
- 「〜に当てはまりますか？」形式にすること
- 答えるのが少し怖くなるくらい核心を突いた質問にすること
- 5つの評価軸（価値観一致度・成長環境適合度・働き方適合度・動機の純度・ストレス耐性）にそれぞれ対応させること
- 業界・企業のリアルな特徴（例：長時間労働、年功序列、激務、数字プレッシャーなど）を反映させること

JSON形式で出力してください（コードブロックなし）:
{"questions": ["質問1", "質問2", "質問3", "質問4", "質問5"]}`;

      const message = await client.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].text.trim();
      const parsed = JSON.parse(text);

      if (!Array.isArray(parsed.questions) || parsed.questions.length !== 5) {
        throw new Error("Invalid response structure");
      }

      return res.status(200).json(parsed);
    }

    if (type === "generate_results") {
      const qaText = qa
        .map((item, i) => `Q${i + 1}: ${item.question}\nA: ${item.answer}（スコア: ${item.score}/4）`)
        .join("\n\n");

      const prompt = `あなたは現役OB・OGの本音データをもとに就活生をサポートするキャリアアドバイザーです。

対象企業: ${company}
対象業界: ${industry}

【回答内容】
${qaText}

以下の5つの軸でマッチ度を0〜100で採点し、結果を生成してください。
- 価値観一致度
- 成長環境適合度
- 働き方適合度
- 動機の純度
- ストレス耐性

【OBコメントのルール】
- 綺麗事なし、ネガティブ含む本音
- 現実の厳しさを伝えつつ、就活生への誠実なアドバイスを含める
- 200〜300文字程度
- 敬語・丁寧語で

【あなたの軸3選のルール】
- 回答から読み取れるその就活生の価値観・優先事項をラベル（10文字以内）と説明文（50〜80文字）で3つ

JSON形式で出力してください（コードブロックなし）:
{
  "scores": [数値, 数値, 数値, 数値, 数値],
  "totalScore": 数値,
  "verdict": "5年後も活躍できているかの判定文（1〜2文）",
  "obComment": "OBからの本音コメント",
  "userAxes": [
    {"label": "ラベル", "description": "説明"},
    {"label": "ラベル", "description": "説明"},
    {"label": "ラベル", "description": "説明"}
  ]
}`;

      const message = await client.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].text.trim();
      const parsed = JSON.parse(text);

      // Validate structure
      if (
        !Array.isArray(parsed.scores) ||
        parsed.scores.length !== 5 ||
        typeof parsed.totalScore !== "number" ||
        typeof parsed.obComment !== "string" ||
        !Array.isArray(parsed.userAxes) ||
        parsed.userAxes.length !== 3
      ) {
        throw new Error("Invalid result structure");
      }

      return res.status(200).json(parsed);
    }
  } catch (e) {
    console.error("API error:", e);
    if (e instanceof SyntaxError) {
      return res.status(500).json({ error: "AIの応答の解析に失敗しました。もう一度お試しください。" });
    }
    return res.status(500).json({ error: "APIエラーが発生しました。しばらくしてからお試しください。" });
  }
};
