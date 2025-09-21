# Gemini実装ナビ
要件定義を貼るだけで **難易度(⭐)/CP/工数/費用/工程/学習リンク** を自動算出。TSVでスプレッドシート貼り付け可。

## デモ
- Cloud Run: <あなたのCloud Run URL>
- 3分動画: <YouTube URL>
- Zenn 記事: <ZennのURL>

## 使い方（ローカル）
```bash
# 1) Frontend
cd web
npm i
npm run dev   # http://localhost:5173

# 2) Backend（PowerShell）
cd ../api
npm i
$env:GEMINI_API_KEY = "<あなたのGemini APIキー>"
npm run dev     # http://localhost:8080
