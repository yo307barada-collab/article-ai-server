import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function normalizeText(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function trimToSentence(text = "") {
  const t = normalizeText(text);
  const match = t.match(/^(.+?[。！？!?])/);
  return match ? match[1].trim() : t;
}

function trimToLength(text = "", max = 40) {
  const t = normalizeText(text);
  return t.length <= max ? t : t.slice(0, max).trim() + "…";
}

function articleLabel(articleType = "auto") {
  const map = {
    report: "活動報告",
    class: "授業紹介",
    event: "イベント告知",
    auto: "学校活動"
  };
  return map[articleType] || "学校活動";
}

function normalizeTitle(title = "", articleType = "auto") {
  let t = normalizeText(title);

  if (!t) {
    return `【${articleLabel(articleType)}】学校活動をご紹介します！`;
  }

  t = t.replace(/^【[^】]+】\s*/, "");
  t = t.replace(/[|｜]/g, "｜");
  t = t.replace(/『/g, "「").replace(/』/g, "」");
  t = t.replace(/。$/, "");

  if (t.length > 36) {
    t = t.slice(0, 36).trim();
  }

  return `【${articleLabel(articleType)}】${t}`;
}

function normalizeLead(lead = "", title = "") {
  let t = normalizeText(lead);
  const core = normalizeText(String(title).replace(/^【[^】]+】/, ""));

  if (!t) {
    return `${core || "今回の取り組み"}をご紹介します！`;
  }

  t = trimToSentence(t).replace(/。$/, "");

  if (/ご紹介します|とは！？|とは？|注目です|お届けします/.test(t)) {
    return /[。！？!?]$/.test(t) ? t : `${t}！`;
  }

  return `${t}。今回は${core || "その取り組み"}をご紹介します！`;
}

function normalizeSummaryPoints(points = []) {
  const arr = Array.isArray(points) ? points : [];

  const normalized = arr
    .slice(0, 3)
    .map((point) => trimToLength(trimToSentence(point), 40))
    .filter(Boolean);

  while (normalized.length < 3) {
    normalized.push("取り組みのポイントをご紹介します。");
  }

  return normalized;
}

function normalizeSections(sections = []) {
  const arr = Array.isArray(sections) ? sections : [];

  const normalized = arr
    .slice(0, 4)
    .map((sec, idx) => ({
      h2: normalizeText(sec?.h2) || `見出し${idx + 1}`,
      body: normalizeText(sec?.body) || "今回の取り組みの内容を整理してご紹介します。"
    }))
    .filter((sec) => sec.h2 && sec.body);

  while (normalized.length < 3) {
    normalized.push({
      h2: `活動のポイント ${normalized.length + 1}`,
      body: "今回の取り組みの魅力が伝わるよう、内容を整理してご紹介します。"
    });
  }

  return normalized;
}

// 動作確認用
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index-clean.html"));
});

app.get("/index-clean.html", (req, res) => {
  res.sendFile(path.join(__dirname, "index-clean.html"));
});

app.post("/api/format-article-clean", async (req, res) => {
  try {
    const { text, articleType = "report" } = req.body;

    if (!text || !String(text).trim()) {
      return res.status(400).json({
        ok: false,
        error: "原文が空です。"
      });
    }

    const systemPrompt = `
あなたは学校公式サイトの広報記事アシスタントです。
教員が書いた原稿をもとに、学校HP向けの明るく読みやすい記事下書きを作成してください。

【最重要ルール】
- 原文に書かれている事実だけを使う
- 推測・補完・創作をしない
- 原文にない日時、人数、成果、感想を足さない
- 明るく前向きな文調にする
- 必要に応じて「！」を使ってよい
- 不自然に大げさにしない

【タイトル】
- タイトルは1つだけ
- 学校HPの記事として、自然で読みたくなる表現にする
- 【】は不要

【導入文】
- 2文以内
- 要約ではなく、読者が読みたくなる導入にする
- 「〜をご紹介します！」のような表現も可

【30秒要約】
- 必ず3つ
- 1つにつき1文
- 短く簡潔にする
- 長い説明は禁止

【見出しと本文】
- 見出しは3〜4個
- 見出しは説明的すぎず、活動の魅力が伝わる表現にする
- 本文は読みやすい自然な日本語

以下のJSONだけを返してください。
{
  "title": "string",
  "lead": "string",
  "summary_points": ["string", "string", "string"],
  "sections": [
    { "h2": "string", "body": "string" }
  ],
  "warnings": ["string"]
}
`.trim();

    const userPrompt = `
以下の教員原稿を整形してください。

【記事タイプ】
${articleType}

【原稿】
${text}
`.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "school_article_format",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              lead: { type: "string" },
              summary_points: {
                type: "array",
                items: { type: "string" },
                minItems: 3,
                maxItems: 3
              },
              sections: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    h2: { type: "string" },
                    body: { type: "string" }
                  },
                  required: ["h2", "body"]
                },
                minItems: 3,
                maxItems: 4
              },
              warnings: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["title", "lead", "summary_points", "sections", "warnings"]
          }
        }
      }
    });

    const output = JSON.parse(response.output_text);

    const cleaned = {
      title: normalizeTitle(output.title, articleType),
      lead: normalizeLead(output.lead, output.title),
      summary_points: normalizeSummaryPoints(output.summary_points),
      sections: normalizeSections(output.sections),
      warnings: Array.isArray(output.warnings) ? output.warnings : []
    };

    res.json({
      ok: true,
      data: cleaned
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: "記事整形に失敗しました。"
    });
  }
});

const port = 3001;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});