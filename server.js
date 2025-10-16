// -------------------------------
// Clinic Web Server - Final Version
// -------------------------------
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import fs from "fs";
import OpenAI from "openai";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ dest: "uploads/" });
const port = process.env.PORT || 10000;
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error("❌ Missing OPENAI_API_KEY");
  process.exit(1);
}

const client = new OpenAI({ apiKey });
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===============================
// ROUTE: root
// ===============================
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===============================
// ROUTE: summarize-from-text
// ===============================
app.post("/summarize-from-text", async (req, res) => {
  try {
    const { text, template = "neurology" } = req.body;
    if (!text) return res.json({ ok: false, error: "missing text" });

    const prompt = `สรุปข้อความต่อไปนี้ให้อยู่ในรูปแบบ OPD Card (${template}):
${text}`;
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const summary = completion.choices[0].message.content;
    res.json({ ok: true, summary });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, error: err.message });
  }
});

// ===============================
// ROUTE: upload-audio-and-summarize
// ===============================
app.post(
  "/upload-audio-and-summarize",
  upload.single("audio"),
  async (req, res) => {
    try {
      if (!req.file) return res.json({ ok: false, error: "missing file" });

      const template = req.query.template || "internal";
      const audioPath = path.resolve(req.file.path);

      const transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "gpt-4o-mini-transcribe",
      });

      const text = transcription.text || "(ไม่สามารถถอดเสียงได้)";
      const prompt = `สรุปข้อความให้อยู่ในรูปแบบ OPD Card (${template}): ${text}`;

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      });

      const summary = completion.choices[0].message.content;
      res.json({ ok: true, summary });
    } catch (err) {
      console.error(err);
      res.json({ ok: false, error: err.message });
    } finally {
      if (req.file) fs.unlinkSync(req.file.path);
    }
  }
);

// ===============================
// START SERVER
// ===============================
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
