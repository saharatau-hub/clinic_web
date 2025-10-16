// server.js (fixed)
// -----------------
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import cors from "cors";
import OpenAI from "openai";

const __dirname = process.cwd();
const PORT = process.env.PORT || 10000;

// ===== OpenAI =====
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,                   // ต้องตั้งค่าใน Render > Environment
  baseURL: process.env.OPENAI_BASE_URL || undefined,   // ถ้าใช้ proxy
});

// รุ่นแนะนำ
const STT_MODEL = process.env.STT_MODEL || "gpt-4o-mini-transcribe"; // STT
const SUMMARIZER_MODEL = process.env.SUMMARIZER_MODEL || "gpt-4.1";  // สรุปไทยละเอียด

// ===== Express =====
const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// เสิร์ฟไฟล์หน้าเว็บ
app.use(express.static(path.join(__dirname, "public")));

// ===== Multer (memory) =====
const upload = multer({ storage: multer.memoryStorage() });

// ===== Helpers =====
function extFromMime(mime) {
  // แม็ป mimetype -> นามสกุล
  const map = {
    "audio/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "mp4",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/oga": "oga",
    "audio/flac": "flac",
    "video/webm": "webm", // เผื่อ MediaRecorder ให้เป็น video/webm
    "video/mp4": "mp4",
  };
  return map[mime] || null;
}

function safeExtFromUpload(file) {
  // 1) ลองจาก mimetype
  let ext = file?.mimetype ? extFromMime(file.mimetype) : null;

  // 2) ถ้ายังไม่ได้ ให้เดาจากชื่อไฟล์
  if (!ext && file?.originalname) {
    const parts = file.originalname.split(".");
    if (parts.length > 1) ext = parts.pop().toLowerCase();
  }

  // 3) ถ้ายังไม่ได้อีก ให้ default เป็น webm (กรณี MediaRecorder)
  return ext || "webm";
}

function buildThaiPromptTemplate(templateName = "ทั่วไป") {
  // ปรับรูปแบบที่นี่ (เลือกจาก UI เป็นค่าที่ส่งมากับ body/query)
  // คุณสามารถเติมเทมเพลตเฉพาะทางเพิ่มไว้ได้เรื่อย ๆ
  const commonGuide = `
- ให้เรียบเรียงเป็นภาษาไทยทางการ อ่านง่าย สั้น กระชับ แต่ **ครบถ้วน**
- หลีกเลี่ยงการเดาข้อมูล ถ้าไม่พบให้ระบุว่า "ยังไม่มีข้อมูล"
- ใช้ bullet/หัวข้อชัดเจน
`;

  const templates = {
    "ทั่วไป": `
สรุปเป็น OPD Card ทั่วไป ด้วยหัวข้อ:
- Chief Complaint (CC)
- Present Illness (PI)
- Past History / Meds / Allergy / Risk
- Physical Examination / Vitals (ถ้ามี)
- Assessment (Dx/Ddx)
- Plan (Investigation / Treatment / Advice)
${commonGuide}
`,

    "อายุรแพทย์": `
สรุปแบบอายุรแพทย์ เป็นหัวข้อ:
- CC
- HPI (ลำดับเหตุการณ์, alarm sx, red flags)
- PMHx/Medications/Allergies/Risk
- PE/Vitals
- Lab/Imaging (ถ้ามี)
- Assessment: Dx หลัก และ Ddx พร้อมเหตุผลสั้น ๆ
- Plan: Investigation / Treatment / Disposition / Follow-up
${commonGuide}
`,

    "ปราสาทวิทยา": `
สรุปแบบประสาทวิทยา:
- CC
- HPI ละเอียด: onset/time course/associated symptoms
- Neurologic Exam: CN / Motor / Sensory / Cerebellar / Gait / Reflex
- Imaging/Labs (ถ้ามี)
- Assessment: localization + Dx/Ddx
- Plan: further workup/treatment/follow-up
${commonGuide}
`,

    "SOAP": `
สรุปแบบ SOAP:
S) Subjective
O) Objective (Vitals/PE/Key findings)
A) Assessment (Dx/Ddx+เหตุผล)
P) Plan (Investigation/Treatment/Disposition/Follow-up)
${commonGuide}
`,

    "คีนิกกายภาพ": `
สรุปแบบกายภาพบำบัด:
- CC/Functional problems
- History of present problem (onset, aggravating/relieving)
- Physical findings (ROM, MMT, Special tests)
- Assessment/Impairments
- PT Plan (modalities/exercise/education)
${commonGuide}
`,

    "ศัลยกรรมประสาท": `
สรุปแบบศัลยกรรมประสาท:
- CC
- HPI (neuro deficit, ICP/red flags)
- Neuro Exam เจาะจงจุด
- Imaging key findings
- Assessment (lesion/differential)
- Surgical Plan/Conservative Plan/Follow-up
${commonGuide}
`,

    "จักษุ": `
สรุปแบบจักษุ/ตา:
- CC
- Ocular Hx (laterality, onset, pain, photophobia, discharge)
- Visual acuity, EOM, Pupil, Slit-lamp, Fundus (ถ้ามี)
- Assessment: Dx/Ddx
- Plan: Rx/Procedure/Referral/Follow-up
${commonGuide}
`,
  };

  return templates[templateName] || templates["ทั่วไป"];
}

async function summarizeThai(rawText, templateName = "ทั่วไป") {
  const system = `คุณเป็นแพทย์เวรที่สรุป OPD Card ภาษาไทยอย่างเป็นระบบและแม่นยำ`;
  const user = `
ข้อความถอดเสียง/ข้อความคนไข้/แพทย์:
"""
${rawText}
"""

รูปแบบที่ต้องการ:
${buildThaiPromptTemplate(templateName)}

**แสดงผลเป็นภาษาไทยอย่างเดียว**`;

  const resp = await openai.chat.completions.create({
    model: SUMMARIZER_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  });

  return resp.choices?.[0]?.message?.content?.trim() || "";
}

// ===== Routes =====

// ตรวจสุขภาพ
app.get("/health", (_, res) => res.json({ ok: true }));

// อัปโหลดเสียง + ถอดเสียง + สรุป (FormData: audio=Blob|File)
app.post(
  "/upload-audio-and-summarize",
  upload.single("audio"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: "ไม่มีไฟล์เสียง" });
      }

      const template = String(req.query.template || "ทั่วไป");

      // ตั้งนามสกุลไฟล์ตามชนิด
      const ext = safeExtFromUpload(req.file);
      const tempPath = path.join(__dirname, `temp_${Date.now()}.${ext}`);
      fs.writeFileSync(tempPath, req.file.buffer);

      console.log("📦 Received:", req.file.originalname, req.file.mimetype, req.file.size, "->", tempPath);

      // ส่งเข้า STT
      const transcriptText = await transcribeFileToText(tempPath);

      // ลบไฟล์ชั่วคราว
      fs.unlink(tempPath, () => {});

      // สรุปไทย
      const summary = await summarizeThai(transcriptText, template);
      return res.json({ ok: true, transcript: transcriptText, summary });
    } catch (err) {
      console.error("❌ upload-audio-and-summarize:", err);
      return res.status(400).json({ ok: false, error: err.message });
    }
  }
);

// สรุปจากข้อความล้วน
app.post("/summarize-from-text", async (req, res) => {
  try {
    const text = String(req.body.text || "").trim();
    const template = String(req.body.template || req.query.template || "ทั่วไป");

    if (!text) return res.status(400).json({ ok: false, error: "กรุณาใส่ข้อความ" });

    const summary = await summarizeThai(text, template);
    return res.json({ ok: true, summary });
  } catch (err) {
    console.error("❌ summarize-from-text:", err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// เสิร์ฟ index.html ถ้ามี
app.get("/", (req, res) => {
  const p = path.join(__dirname, "public", "index.html");
  if (fs.existsSync(p)) return res.sendFile(p);
  res.type("text/html").send("<h3>✅ Clinic Web Server is running!</h3>");
});

// ===== STT helper =====
async function transcribeFileToText(filePath) {
  // ใช้ audio.transcriptions API (รองรับไฟล์ .webm/.m4a/.wav/... ตามที่เราตั้งชื่อไว้)
  const stt = await openai.audio.transcriptions.create({
    model: STT_MODEL,
    file: fs.createReadStream(filePath),
    response_format: "text",
  });
  return String(stt || "").trim();
}

// ===== Start =====
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});