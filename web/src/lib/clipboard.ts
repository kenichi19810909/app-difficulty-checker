/**
 * clipboard.ts
 * スプレッドシート/Excelに貼りやすいように改行を CRLF に正規化しつつ、
 * できるだけ確実にクリップボードへコピーします。
 *
 * 使い方：
 *   import { copyText } from "./lib/clipboard";
 *   await copyText("タブ区切りや複数行のテキスト");
 */

/** 非同期クリップボードAPIが使えるか（https/localhost などのセキュアコンテキスト前提） */
export function canUseAsyncClipboard(): boolean {
  try {
    return !!(navigator?.clipboard && (window as any).isSecureContext);
  } catch {
    return false;
  }
}

/** テキストをクリップボードへコピー（失敗時は例外を投げます） */
export async function copyText(text: string): Promise<void> {
  // Excel / Google スプレッドシートは CRLF の方が崩れにくい
  const normalized = String(text ?? "").replace(/\r?\n/g, "\r\n");

  // 1) 使えるならモダンAPI
  if (canUseAsyncClipboard()) {
    await navigator.clipboard.writeText(normalized);
    return;
  }

  // 2) フォールバック：一時的に非表示textareaを作って execCommand("copy")
  const ta = document.createElement("textarea");
  ta.value = normalized;

  // iOS/Safari 対策：画面外に固定配置 & 読み取り専用
  ta.setAttribute("readonly", "true");
  ta.style.position = "fixed";
  ta.style.top = "-10000px";
  ta.style.left = "-10000px";
  ta.style.zIndex = "-1";

  document.body.appendChild(ta);

  // 選択→コピー
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(ta);
  }

  if (!ok) {
    // 3) どうしてもダメな場合はエラーを投げて呼び出し側で通知
    throw new Error("Failed to copy to clipboard");
  }
}

/** 失敗時にリトライ（例：権限ダイアログ後）したい場合に使えるヘルパー */
export async function tryCopyText(text: string, retryMs = 250): Promise<boolean> {
  try {
    await copyText(text);
    return true;
  } catch {
    // 少し待って1回だけリトライ
    await new Promise((r) => setTimeout(r, retryMs));
    try {
      await copyText(text);
      return true;
    } catch {
      return false;
    }
  }
}
