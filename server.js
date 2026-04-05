import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    article_type: { type: "string" },
    lead: { type: "string" },
    summary_points: {
      type: "array",
      items: { type: "string" },
      minItems: 3,
      maxItems: 3
    },
    sections: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          h2: { type: "string" },
          body: { type: "string" },
          source_quotes: {
            type: "array",
            items: { type: "string" },
            minItems: 2
          }
        },
        required: ["h2", "body", "source_quotes"]
      }
    },
    seo: {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    meta_description: { type: "string" }
  },
  required: ["title", "meta_description"]
},
    warnings: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "article_type",
    "lead",
    "summary_points",
    "sections",
    "seo",
    "warnings"
  ]
};

function trimToSentence(text = "") {
  const t = String(text).trim();
  const match = t.match(/^(.+?[。！？!?])/);
  return match ? match[1].trim() : t;
}

function trimToLength(text = "", max = 40) {
  const t = String(text).trim();
  return t.length <= max ? t : t.slice(0, max).trim() + "…";
}

function normalizeTitle(title = "", articleType = "auto") {
  let t = String(title).trim();

  if (!t) return "";

  t = t.replace(/^【[^】]+】\s*/, "");
  t = t.replace(/[|｜]/g, "｜");
  t = t.replace(/\s+/g, " ");
  t = t.replace(/　+/g, " ");
  t = t.replace(/と優秀賞/g, "・優秀賞");
  t = t.replace(/『/g, "「").replace(/』/g, "」");

  // 長すぎるときは少し切る
  if (t.length > 34) {
    t = t.slice(0, 34).trim();
  }

  const labelMap = {
    report: "活動報告",
    class: "授業紹介",
    event: "イベント告知",
    auto: "学校活動"
  };

  const label = labelMap[articleType] || "学校活動";
  return `【${label}】${t}`;
}

function normalizeLead(lead = "") {
  let t = String(lead).trim();
  if (!t) return "";

  t = t.replace(/\s+/g, " ");
  t = t.replace(/「([^」]+)」チームが/, "チーム「$1」が");

  // 要約っぽい無機質な書き出しを少し柔らかくする
  if (!/ご紹介します|注目です|とは！？|とは？|挑戦しました|輝きました|お届けします/.test(t)) {
    t = t.replace(/。+$/g, "");
    t += "。その取り組みをご紹介します！";
  }

  return t;
}
function trimToSentence(text = "") {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const match = t.match(/^(.+?[。！？!?])/);
  return match ? match[1].trim() : t;
}

function trimToLength(text = "", max = 40) {
  const t = String(text || "").trim();
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
  let t = String(title || "").trim();

  if (!t) return `【${articleLabel(articleType)}】学校活動をご紹介します！`;

  t = t.replace(/^【[^】]+】\s*/, "");
  t = t.replace(/[|｜]/g, "｜");
  t = t.replace(/\s+/g, " ");
  t = t.replace(/　+/g, " ");
  t = t.replace(/。$/, "");
  t = t.replace(/と優秀賞/g, "・優秀賞");
  t = t.replace(/『/g, "「").replace(/』/g, "」");

  if (t.length > 34) {
    t = t.slice(0, 34).trim();
  }

  return `【${articleLabel(articleType)}】${t}`;
}

function normalizeLead(lead = "", title = "") {
  let t = String(lead || "").replace(/\s+/g, " ").trim();

  if (!t) {
    const core = String(title || "").replace(/^【[^】]+】/, "").trim();
    return `${core || "今回の取り組み"}をご紹介します！`;
  }

  t = trimToSentence(t);
  t = t.replace(/。$/, "");

  const core = String(title || "").replace(/^【[^】]+】/, "").trim();

  if (/ご紹介します|とは！？|とは？|注目です|お届けします/.test(t)) {
    return t.endsWith("！") || t.endsWith("。") ? t : `${t}！`;
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

function postValidate(output, sourceText) {
  const warnings = Array.isArray(output.warnings) ? [...output.warnings] : [];

  if (!output.lead || output.lead.length < 10) {
    warnings.push("導入文が短すぎる可能性があります。");
  }

  if (!Array.isArray(output.summary_points) || output.summary_points.length !== 3) {
    warnings.push("30秒要約が3点になっていません。");
  }

  if (Array.isArray(output.sections)) {
    output.sections.forEach((section, idx) => {
      if (!section.h2 || !section.body) {
        warnings.push(`section ${idx + 1} に不足があります。`);
      }

      if (Array.isArray(section.source_quotes)) {
        section.source_quotes.forEach((quote) => {
          if (!containsExactQuote(sourceText, quote)) {
            warnings.push(`根拠文が原文と完全一致しない可能性があります: ${quote}`);
          }
        });
      } else {
        warnings.push(`section ${idx + 1} の根拠文が不足しています。`);
      }
    });
  }

  output.warnings = warnings;
  return output;
}
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/api/format-article", async (req, res) => {
  try {
    const { text, articleType = "auto", strictMode = true } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "原文が空です。"
      });
    }

    const systemPrompt = `
あなたは学校公式サイトの記事整形アシスタントです。
目的は、教員が書いた原文をもとに、WordPress掲載用の記事構成データを作ることです。

最重要ルール:
- 原文に書かれている事実だけを使うこと
- 推測・補完・脚色・創作をしないこと
- 日時、場所、人数、制度名、成果、感想を勝手に足さないこと
- 原文に根拠のない表現は出力しないこと
- 不明な情報は補わず warnings に記載すること
- 各 section には source_quotes を必ず2件以上つけること
- summary_points は1文ずつにすること
- lead は2文までにすること
- sections は3〜5個にすること
- H2は自然な日本語にし、誇張表現を避けること
- SEOを意識しつつも、不自然なキーワード詰め込みは禁止
- 出力は必ず指定JSONスキーマに従うこと

【タイトルルール】
・タイトルは1つだけ出力する
・必ず【】から始める
・学校HPの記事タイトルとして、読みたくなる自然な言い回しにする
・報告書のような硬すぎるタイトルは禁止
・タイトルの長さは40字前後を目安にする
・タイトルはニュース見出しではなく、学校HPの活動紹介として自然な言い回しにする
・「〜と優秀賞」よりも「〜・優秀賞」「〜が優秀賞」など自然な形を優先する

【文体ルール】
・学校HPの広報記事として、やわらかく読みやすい日本語にする
・「〜を行いました。」の連続を避ける
・読者が活動の魅力を感じられる表現にする
・原文が短い場合は文章量を広げても構わないが、長すぎることのないように気をつける
・学校広報記事として、明るく前向きなトーンで書く
・必要に応じて「！」を使ってよい
・活動の魅力や楽しさが伝わる文章にする
・読み手が「面白そう」「読んでみたい」と感じる表現にする

【導入文ルール】
・最初の1〜2文で活動の魅力や学びが伝わるようにする
・報告書の書き出しではなく、読みたくなる導入にする
・最初の1〜2文で読者の興味を引く
・要約ではなく「読みたくなる導入」にする
・「をご紹介します」「とは！？」「が行われました！」などの表現を使ってよい
・活動の魅力やワクワク感が伝わる書き出しにする
・ただし原文にない事実は追加しない
・導入文の最後は「ご紹介します！」など、読者を本文へ誘う表現で締めてもよい
・導入文は要約ではなく、記事の入口として機能させる

【30秒要約ルール】
・summary_points は必ず3つ
・各要約は1文だけ
・各要約は40文字以内
・すべて同じくらいの長さにする
・説明文や複数文は禁止

【見出しルール】
・説明的すぎる見出しではなく、内容が気になる見出しにする
・硬すぎる表現は避ける
`;

    const userPrompt = `
以下の教員原稿を整形してください。

【記事タイプ】
${articleType}

【厳格モード】
${strictMode ? "ON" : "OFF"}

【原文】
${text}
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "article_format",
          schema
        }
      }
    });

    const output = JSON.parse(response.output_text);

// seo を必ず作る
if (!output.seo) output.seo = {};

// タイトル元を拾う（新旧両対応）
const rawTitle =
  output.seo.title ||
  output.seo.title_candidates?.[0] ||
  output.sections?.[0]?.h2 ||
  output.lead ||
  "";

// タイトルを強制整形
output.seo.title = normalizeTitle(rawTitle, articleType);

// 導入文を強制整形
output.lead = normalizeLead(output.lead || output.sections?.[0]?.body || "", output.seo.title);

// 30秒要約を強制整形
output.summary_points = normalizeSummaryPoints(output.summary_points);

// 古い title_candidates は以後使わないように消す
delete output.seo.title_candidates;

const checked = postValidate(output, text);


    res.json({
      ok: true,
      data: checked
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: "AI整形に失敗しました。"
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
