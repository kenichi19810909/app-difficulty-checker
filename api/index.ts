import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/analyze", async (req, res) => {
  try {
    const text = (req.body?.requirements || "").toString().trim();
    if (!text) return res.status(400).json({ error: "requirements required" });
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(500).json({ error: "GEMINI_API_KEY not set" });

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const sys = `Return JSON only with:
{overall:{stars,cpTotal,hours,costJpyMin,costJpyMax,rationale},
 steps:[{title,detail,estimateHours}],
 breakdown:[{category,items:[{name,cp}]}],
 learning:[{title,url}], tsv:string}.`;
    const user = `[REQUIREMENTS]\n${text}`;

    const resp = await model.generateContent([{ role: "user", parts: [{ text: sys + "\n" + user }] }]);
    res.json(JSON.parse(resp.response.text()));
  } catch (e:any) {
    res.status(500).json({ error: e.message ?? "internal" });
  }
});

app.listen(8080, () => console.log("API on :8080"));

cd /d C:\dev\app-difficulty-checker\api
mkdir src 2>NUL
dir src

