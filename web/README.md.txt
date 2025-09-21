# Gemini実装ナビ
要件定義を貼るだけで、**難易度(⭐)/CP/工数/費用/工程**を自動算出。TSVでスプレッドシート貼り付け可。

## デモ
- Cloud Run: <後でURLを入れる>
- 3分動画: <後でYouTube URLを入れる>

## ローカル実行
```bash
# Frontend
cd web && npm i && npm run dev
# Backend
cd ../api && npm i
# PowerShell で
$env:GEMINI_API_KEY = "AIzaSyDfBbvuMCmt7qnBk7rZQMz4QDn36NeZJN8"
npm run dev
