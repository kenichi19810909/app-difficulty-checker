import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* =========================
   環境変数と定数
   ========================= */
const PORT = Number(process.env.PORT || 8080);

// 予防的にサーバ側でも見積を補完（フロント側にも入れているが保険として）
const HOURS_PER_CP = Number(process.env.HOURS_PER_CP || 0.1);  // 1CP=0.1h
const RATE_MIN = Number(process.env.RATE_MIN || 5000);         // 円/時
const RATE_MAX = Number(process.env.RATE_MAX || 10000);        // 円/時

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.warn("[WARN] GEMINI_API_KEY が設定されていません。/analyze は失敗します。");
}

/* =========================
   Zod スキーマ（モデル出力の検証）
   ========================= */
const ItemSchema = z.object({
  name: z.string(),
  cp: z.number().finite().nonnegative().default(0),
});

const BreakdownSchema = z.object({
  category: z.string(),
  items: z.array(ItemSchema).default([]),
});

const StepSchema = z.object({
  title: z.string(),
  detail: z.string().default(""),
  estimateHours: z.number().optional().nullable()
    .transform((v) => (v == null ? 0 : Number(v))),
});

const LearningSchema = z.object({
  title: z.string(),
  url: z.string().url(),
});

const OverallSchema = z.object({
  stars: z.number().min(0).max(5).optional().default(0),
  cpTotal: z.number().optional().default(0),
  hours: z.number().optional().default(0),
  costJpyMin: z.number().optional().default(0),
  costJpyMax: z.number().optional().default(0),
  rationale: z.string().optional().default(""),
});

const AnalysisSchema = z.object({
  overall: OverallSchema,
  breakdown: z.array(BreakdownSchema).default([]),
  steps: z.array(StepSchema).default([]),
  learning: z.array(LearningSchema).default([]).optional().default([]),
  tsv: z.string().optional().nullable(),
});

type AnalysisResult = z.infer<typeof AnalysisSchema>;

/* =========================
   日本語固定のシステム指示
   ========================= */
const sys = `あなたは日本語のテクニカルライターです。以降の応答は **日本語(ja-JP)** で出力し、返す内容は **JSONのみ** とします。
構造は以下に固定し、数値は数値型で返してください。固有名詞・製品名・API名（例: Cloud Run, Firebase, WebSocket, CRDT）は英語表記のままで構いません。

JSON schema:
{
  "overall": {
    "stars": number,                // 1..5
    "cpTotal": number,              // 合計CP
    "hours": number,                // 合計工数(時間)
    "costJpyMin": number,           // 最小見積(円)
    "costJpyMax": number,           // 最大見積(円)
    "rationale": string             // 評価理由（日本語）
  },
  "breakdown": [
    {
      "category": string,           // 日本語（例: フロントエンド, バックエンド, AI連携）
      "items": [
        {"name": string, "cp": number}
      ]
    }
  ],
  "steps": [
    {"title": string, "detail": string, "estimateHours": number}
  ],
  "learning": [
    {"title": string, "url": string}
  ],
  "tsv": string | null
}

必ず以下を守ること：
- すべての文字列フィールド（overall.rationale, breakdown[].category, breakdown[].items[].name, steps[].title, steps[].detail, learning[].title）は **日本語** で書く。
- JSON以外の文字（前後の説明文、コードブロック記号\`\`\` など）は出力しない。
- 値は現実的なレンジに調整する。`;

/* =========================
   JSON 安全パース（モデルが崩しても救出）
   ========================= */
function safeJsonParse(raw: string): any {
  if (!raw) throw new Error("Empty response");
  // コードフェンス除去
  let txt = raw.trim().replace(/^```(json)?/i, "").replace(/```$/i, "").trim();

  // 先頭の { ～ 対応 } を強引に抽出
  const first = txt.indexOf("{");
  const last = txt.lastIndexOf("}");
  if (first >= 0 && last >= 0 && last > first) {
    txt = txt.slice(first, last + 1);
  }
  return JSON.parse(txt);
}

/* =========================
   見積の欠損を補完（CP→工数→費用）
   ========================= */
function completeEstimation(r: AnalysisResult): AnalysisResult {
  const cpFromItems = (r.breakdown ?? [])
    .flatMap((b) => b.items ?? [])
    .map((it) => Number(it.cp || 0))
    .reduce((a, b) => a + b, 0);

  const cpTotal = r.overall.cpTotal || cpFromItems;
  const hours = r.overall.hours || Math.round(cpTotal * HOURS_PER_CP);
  const costJpyMin = r.overall.costJpyMin || Math.round(hours * RATE_MIN);
  const costJpyMax = r.overall.costJpyMax || Math.round(hours * RATE_MAX);

  return {
    ...r,
    overall: {
      ...r.overall,
      cpTotal,
      hours,
      costJpyMin,
      costJpyMax,
    },
  };
}

/* =========================
   サーバ初期化
   ========================= */
const app = express();
app.use(cors()); // 必要に応じて { origin: ["http://localhost:5173", ...] } に限定
app.use(express.json({ limit: "1mb" }));

/* healthz */
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));

/* 解析エンドポイント */
app.post("/analyze", async (req, res) => {
  try {
    const requirements = String(req.body?.requirements ?? "").trim();
    if (!requirements) {
      return res.status(400).json({ error: "requirements が空です。" });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY が未設定です。" });
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        // JSONのみを返すよう強制
        responseMimeType: "application/json",
      },
    });

    const userPrompt = `
# 目的
上記の JSON schema に厳密に従い、下記の要件定義を評価・分解・見積してください。
- 返答は日本語。JSON以外は出力しないこと。

# 入力（要件定義）
${requirements}
    `.trim();

    const resp = await model.generateContent([
      { role: "user", parts: [{ text: sys }] },
      { role: "user", parts: [{ text: userPrompt }] },
    ]);

    const text = resp.response.text();
    let json = safeJsonParse(text);

    // Zod で検証・補正
    const parsed = AnalysisSchema.safeParse(json);
    if (!parsed.success) {
      // もし number が string で来るなど軽微な崩れは、再パーストライ
      // 追加の緩和処理が必要ならここに追記
      return res.status(502).json({
        error: "モデル出力のパースに失敗しました。",
        issues: parsed.error.issues,
        raw: text,
      });
    }

    // サーバ側の保険で見積補完
    const completed = completeEstimation(parsed.data);
    return res.json(completed);
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "internal error" });
  }
});

/* =========================
   静的ファイル配信（単一サーバ）
   ========================= */
// ルート(プロジェクト直下)から web/dist を探す（Docker/ローカル両対応）
const publicDir = path.resolve(process.cwd(), "web", "dist");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA ルーティング対応：API以外は index.html
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/analyze") || req.path.startsWith("/healthz")) {
      return next();
    }
    res.sendFile(path.join(publicDir, "index.html"));
  });
} else {
  console.warn(`[WARN] 静的配信ディレクトリが見つかりません: ${publicDir}`);
}

/* =========================
   起動
   ========================= */
app.listen(PORT, () => {
  console.log(`API on :${PORT}`);
});
