// server.js — Web API + Static Web สำหรับ Transkriptor → OPD Card
// ใช้ Node.js ES Modules (package.json ควรมี: { "type": "module" })
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import multer from "multer";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

// ======= ตั้งค่า =======
const PORT = process.env.PORT || 3001;
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// เพื่อความปลอดภัยเวลารันบนเว็บ: ใช้ shared secret เรียก API
const API_SHARED_SECRET = process.env.API_SHARED_SECRET || ""; // เช่น abc123
// =======================

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// CORS: ถ้าไม่ตั้ง ALLOW_ORIGINS จะอนุญาตทุก origin (เหมาะแค่ dev)
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || ALLOW_ORIGINS.length === 0) return cb(null, true);
      if (ALLOW_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked"), false);
    },
    credentials: false,
  })
);

// เสิร์ฟไฟล์หน้าเว็บจากโฟลเดอร์ public/
app.use(express.static(path.join(process.cwd(), "public")));

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ======= Middleware: ตรวจ Shared Secret =======
function requireSecret(req, res, next) {
  // ถ้ายังไม่ตั้งค่านี้ ปล่อยผ่าน (dev)
  if (!API_SHARED_SECRET) return next();
  const token =
    req.headers["x-api-secret"] ||
    req.query.secret ||
    (req.body && req.body.secret);
  if (token && token === API_SHARED_SECRET) return next();
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}

// ======= Utils =======
function ensureExtension(file) {
  const mt = (file.mimetype || "").toLowerCase();
  let ext = "";
  if (mt.includes("webm")) ext = ".webm";
  else if (mt.includes("wav")) ext = ".wav";
  else if (mt.includes("mpeg") || mt.includes("mp3") || mt.includes("mpga"))
    ext = ".mp3";
  else if (mt.includes("ogg") || mt.includes("oga")) ext = ".ogg";
  else if (mt.includes("m4a")) ext = ".m4a";

  if (!/\.[a-z0-9]+$/i.test(file.path) && ext) {
    const newPath = file.path + ext;
    fs.renameSync(file.path, newPath);
    return newPath;
  }
  return file.path;
}

// ======= Templates (ครบทุกสาขาที่ขอ) =======
function templatePrompt(kind) {
  switch ((kind || "").toLowerCase()) {
    case "internal":
      return `
คุณเป็นอายุรแพทย์ สรุปเป็น OPD Card ภาษาไทย กระชับ ชัดเจน
หัวข้อ:
- Chief Complaint
- History of Present Illness (ไทม์ไลน์สั้นๆ จุดสำคัญ)
- Past History / Meds / Allergy
- Physical Examination (รวม Vitals)
- Lab/Imaging (ถ้ามี)
- Assessment (Dx/Ddx พร้อมเหตุผลย่อ)
- Plan (Investigation / Treatment / Advice/Follow-up)

ใส่ "**คำแนะนำผู้ป่วย**" และ "**หมายเหตุแพทย์**" ต่อท้าย
ใช้ bullet/list เท่าที่จำเป็น ไม่ใส่คำบรรยายส่วนเกิน
`;
    case "neurology":
      return `
คุณเป็นแพทย์ประสาทวิทยา สรุปเป็น OPD Card ภาษาไทย
หัวข้อ:
- Chief Complaint
- Present Illness (ลำดับเวลา อาการทางระบบประสาท red flags)
- Past History / Meds / Allergy / Vascular risk
- Neurologic Examination: CN / Motor / Sensory / Cerebellar / Gait
- Assessment (Dx หลัก + Ddx พร้อมเหตุผลย่อ)
- Plan: Investigation (CT/MRI/EEG/EMG ตามความเหมาะสม) / Treatment / Advice-Follow-up

ใส่ "**คำแนะนำผู้ป่วย**" และ "**หมายเหตุแพทย์**"
`;
    case "soap":
      return `
สรุปเป็นบันทึกแบบ SOAP ภาษาไทย
- S (Subjective)
- O (Objective)
- A (Assessment)
- P (Plan)
ปิดท้ายด้วย "**คำแนะนำผู้ป่วย**" และ "**หมายเหตุแพทย์**"
เน้นกระชับ อ่านง่าย
`;
    case "pt":
    case "physicaltherapy":
      return `
คุณเป็นนักกายภาพบำบัด/คลินิกกายภาพ สรุปเป็น OPD ภาษาไทย
หัวข้อ:
- Reason for Referral / Chief Problem
- Subjective (pain scale, aggravating/easing, goals)
- Objective (posture, ROM, MMT, special tests, functional measure)
- Assessment (Impairments → Activity/Participation limitations)
- Plan (therapy plan, dosage, HEP, precautions)

ใส่ "**คำแนะนำผู้ป่วย**" (ท่าบริหารที่บ้าน, ข้อควรระวัง) และ "**หมายเหตุแพทย์**"
`;
    case "neurosurgery":
      return `
คุณเป็นศัลยแพทย์ระบบประสาท สรุปบันทึก OPD ภาษาไทย
หัวข้อ:
- Chief Complaint
- HPI (red flags, neuro deficits, ICP symptoms)
- Imaging Summary (CT/MRI key findings)
- Neuro Exam
- Assessment (เหตุผลที่พิจารณา ผ่าตัด vs รักษาแบบประคับประคอง)
- Plan (pre-op workup / op plan / risks-discussion / consent / follow-up)

ปิดท้าย "**คำแนะนำผู้ป่วย**" และ "**หมายเหตุแพทย์**"
`;
    case "ophthalmology":
    case "eye":
      return `
คุณเป็นจักษุแพทย์ สรุปบันทึกคลินิกตา ภาษาไทย
หัวข้อ:
- Chief Complaint
- HPI (laterality, onset, pain, discharge, vision change)
- Ocular Hx / Meds / Allergy / Systemic Hx
- Eye Exam: VA / IOP / EOM / Pupils / Slit-lamp (lid, conjunctiva, cornea, AC, iris, lens) / Fundus
- Assessment (Dx/Ddx ย่อ)
- Plan (Rx, procedure, imaging, follow-up)

ต่อท้าย "**คำแนะนำผู้ป่วย**" และ "**หมายเหตุแพทย์**"
`;
    default:
      return `
สรุปเป็น OPD Card ภาษาไทย กระชับ อ่านง่าย
หัวข้อหลัก: Chief Complaint / Present Illness / Past History & Meds / Examination / Assessment / Plan
ปิดท้าย "**คำแนะนำผู้ป่วย**" และ "**หมายเหตุแพทย์**"
ใช้ bullet/list เท่าที่จำเป็น
`;
  }
}

async function summarizeToOPD(text, kind) {
  const role = templatePrompt(kind);
  const prompt = `
${role}

ข้อมูลดิบ (ถอดเสียง/ข้อความ):
${text}

รูปแบบเอาต์พุต: ใช้หัวข้อที่กำหนดไว้เรียงลำดับ ชัดเจน กระชับ ใช้ bullet/list เท่าที่จำเป็น ไม่ใส่คำบรรยายส่วนเกิน
`;
  const r = await client.chat.completions.create({
    model: "gpt-4.1",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  });
  return r.choices[0].message.content.trim();
}

// ======= Routes =======

// สำหรับ health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// สรุปจากข้อความตรงๆ
app.post("/summarize-from-text", requireSecret, async (req, res) => {
  try {
    const text = (req.body.text || "").trim();
    const template = (req.body.template || "").trim();
    if (!text) return res.json({ ok: false, error: "ไม่มีข้อความสำหรับสรุป" });

    const summary = await summarizeToOPD(text, template);
    res.json({ ok: true, summary });
  } catch (e) {
    console.error("[summarize-from-text]", e);
    res.json({ ok: false, error: e.message });
  }
});

// อัปโหลดเสียง → ถอดเสียง (Whisper) → สรุป OPD ตาม template
app.post(
  "/upload-audio-and-summarize",
  requireSecret,
  upload.single("audio"),
  async (req, res) => {
    try {
      if (!req.file) return res.json({ ok: false, error: "ไม่พบไฟล์เสียง" });

      const template = (req.body.template || req.query.template || "").trim();
      const fixedPath = ensureExtension(req.file);

      const transcript = await client.audio.transcriptions.create({
        file: fs.createReadStream(fixedPath),
        model: "whisper-1",
        language: "th",
      });

      // ลบไฟล์ชั่วคราว
      try {
        fs.unlinkSync(fixedPath);
      } catch {}

      const summary = await summarizeToOPD(transcript.text || "", template);
      res.json({ ok: true, transcript: transcript.text, summary });
    } catch (e) {
      console.error("[upload-audio-and-summarize]", e);
      res.status(400).json({ ok: false, error: e.message });
    }
  }
);

// สำหรับ SPA routes อื่น ๆ ให้กลับไป index.html
app.get("*", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

// Start
app.listen(PORT, () => console.log(`✅ Web backend & static ready on :${PORT}`));
