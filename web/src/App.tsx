import React, { useEffect, useState } from "react";
import { copyText } from "./lib/clipboard";

/** アプリ名（ここを書き換えるだけでH1とブラウザタイトルが変わります） */
const APP_NAME = "Gemini実装ナビ";

/** 見積前提（必要に応じて調整） */
const HOURS_PER_CP = 0.1;  // 1CP = 0.1時間 (=6分)
const RATE_MIN = 5000;     // 時給(円) 下限
const RATE_MAX = 10000;    // 時給(円) 上限

/** 日本語誤訳の正規化（"壊す"→"内訳" など） */
const normalizeJaDeep = (x: any): any => {
  const fix = (s: string) => s.replace(/壊す/g, "内訳");
  if (typeof x === "string") return fix(x);
  if (Array.isArray(x)) return x.map(normalizeJaDeep);
  if (x && typeof x === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(x)) out[fix(k)] = normalizeJaDeep(v);
    return out;
  }
  return x;
};

// 表示用フォーマッタ
const formatInt = (n: any) =>
  Number.isFinite(Number(n)) ? Number(n).toLocaleString("ja-JP") : String(n ?? "");
const formatYen = (n: any) =>
  Number.isFinite(Number(n)) ? `￥${Number(n).toLocaleString("ja-JP")}` : "";

// TSV組み立て（スプシ/Excel貼り付け用。工程に費用列を追加）
function makeTsv(result: any): string {
  const rows: string[] = [];

  // 内訳
  rows.push(["カテゴリ", "項目/説明", "CP", "メモ"].join("\t"));
  const bd = Array.isArray(result?.breakdown) ? result.breakdown : [];
  for (const b of bd) {
    const items = Array.isArray(b?.items) ? b.items : [];
    for (const it of items) {
      rows.push([b?.category ?? "", it?.name ?? "", String(it?.cp ?? ""), ""].join("\t"));
    }
  }

  // 工程
  rows.push("");
  rows.push(["工程", "詳細", "見積(時間)", "費用(最小)", "費用(最大)"].join("\t"));
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  for (const s of steps) {
    const h = Number(s?.estimateHours ?? 0);
    const cMin = h ? Math.round(h * RATE_MIN) : "";
    const cMax = h ? Math.round(h * RATE_MAX) : "";
    rows.push([
      s?.title ?? "",
      s?.detail ?? "",
      h ? String(h) : "",
      cMin === "" ? "" : `￥${Number(cMin).toLocaleString("ja-JP")}`,
      cMax === "" ? "" : `￥${Number(cMax).toLocaleString("ja-JP")}`,
    ].join("\t"));
  }

  // まとめ
  const overall = result?.overall ?? {};
  rows.push("");
  rows.push(["まとめ", "", "", "", ""].join("\t"));
  rows.push(["⭐", `${overall.stars ?? ""} / 5`, "", "", ""].join("\t"));
  rows.push(["総CP", String(overall.cpTotal ?? ""), "", "", ""].join("\t"));
  rows.push(["工数", String(overall.hours ?? ""), "時間", "", ""].join("\t"));
  rows.push(["費用(最小)", formatYen(overall.costJpyMin), "", "", ""].join("\t"));
  rows.push(["費用(最大)", formatYen(overall.costJpyMax), "", "", ""].join("\t"));

  return rows.join("\n");
}

export default function App() {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "ng">("idle");

  // ブラウザタイトルをAPP_NAMEに
  useEffect(() => { document.title = APP_NAME; }, []);

  const analyze = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const base =
        (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, "") ||
        "http://localhost:8080";

      const res = await fetch(`${base}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements: text }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);

      // 正規化
      const data = await res.json();
      const dataNorm = normalizeJaDeep(data);

      // ===== 欠損補完（CP→工数→費用） =====
      const sumCp =
        dataNorm?.overall?.cpTotal ??
        (Array.isArray(dataNorm?.breakdown)
          ? dataNorm.breakdown
              .flatMap((b: any) => b?.items ?? [])
              .map((it: any) => Number(it?.cp ?? 0))
              .reduce((a: number, b: number) => a + b, 0)
          : 0);

      const hours =
        Number(dataNorm?.overall?.hours) ||
        Math.round(sumCp * HOURS_PER_CP);

      const costMin =
        Number(dataNorm?.overall?.costJpyMin) || Math.round(hours * RATE_MIN);

      const costMax =
        Number(dataNorm?.overall?.costJpyMax) || Math.round(hours * RATE_MAX);

      dataNorm.overall = {
        ...(dataNorm.overall ?? {}),
        cpTotal: sumCp,
        hours,
        costJpyMin: costMin,
        costJpyMax: costMax,
      };
      // =====================================

      setResult(dataNorm);
    } catch (e: any) {
      setError(e?.message ?? "unknown error");
    } finally {
      setLoading(false);
    }
  };

  const onCopyTsv = async () => {
    try {
      await copyText(makeTsv(result));
      setCopied("ok");
      setTimeout(() => setCopied("idle"), 2000);
    } catch {
      setCopied("ng");
      setTimeout(() => setCopied("idle"), 4000);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 16 }}>
      <h1 style={{ fontSize: 40, fontWeight: 800, marginBottom: 16 }}>
        {APP_NAME}
      </h1>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="ここに要件定義を貼り付けてください"
        style={{ width: "100%", height: 220, padding: 12, fontSize: 16 }}
      />

      <div style={{ marginTop: 12 }}>
        <button
          onClick={analyze}
          disabled={loading || !text.trim()}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            fontWeight: 600,
            cursor: loading || !text.trim() ? "not-allowed" : "pointer",
          }}
          title={!text.trim() ? "先に要件を入力してください" : "解析を実行"}
        >
          {loading ? "解析中…" : "分析する"}
        </button>
      </div>

      {error && (
        <div style={{ color: "#b91c1c", marginTop: 16, whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 24 }}>
          {/* まとめ */}
          {result.overall && (
            <section style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                まとめ
              </h2>
              <div>
                ⭐ {result.overall.stars ?? ""} / 5｜CP{formatInt(result.overall.cpTotal)}｜
                {formatInt(result.overall.hours)}時間｜
                {formatYen(result.overall.costJpyMin)} 〜 {formatYen(result.overall.costJpyMax)}
              </div>
              <p style={{ marginTop: 6 }}>{result.overall.rationale}</p>
            </section>
          )}

          {/* 内訳 */}
          {Array.isArray(result.breakdown) && result.breakdown.length > 0 && (
            <section style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                内訳
              </h2>
              <ul>
                {result.breakdown.map((b: any, i: number) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    <strong>{b?.category}</strong>
                    {Array.isArray(b?.items) && b.items.length > 0 && (
                      <ul style={{ marginLeft: 16 }}>
                        {b.items.map((it: any, j: number) => (
                          <li key={j}>
                            {it?.name}（CP:{formatInt(it?.cp)}）
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 手順 */}
          {Array.isArray(result.steps) && result.steps.length > 0 && (
            <section style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                手順
              </h2>
              <ol>
                {result.steps.map((s: any, i: number) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    <strong>{s?.title}</strong>
                    {s?.estimateHours != null && <>（~{formatInt(s?.estimateHours)}時間）</>}
                    <br />
                    <span>{s?.detail}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* スプレッドシート出力 */}
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
              スプレッドシート
            </h2>
            <button
              onClick={onCopyTsv}
              disabled={!result}
              style={{
                padding: "8px 12px",
                border: "1px solid #ccc",
                borderRadius: 8,
                cursor: result ? "pointer" : "not-allowed",
              }}
            >
              TSVをコピー
            </button>
            <div style={{ height: 18, fontSize: 12, marginTop: 4 }}>
              {copied === "ok" && <span style={{ color: "#059669" }}>コピーしました</span>}
              {copied === "ng" && (
                <span style={{ color: "#b91c1c" }}>
                  コピーに失敗しました（ページをリロードして再試行／ブラウザのクリップボード許可を確認）
                </span>
              )}
            </div>
          </section>

          {/* デバッグ：正規化後のJSON */}
          <details style={{ marginTop: 12 }}>
            <summary>JSON（正規化後）を表示</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
