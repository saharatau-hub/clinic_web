// server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const app = express();

// --- CORS ---
const allow = (process.env.ALLOW_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors(allow.length ? { origin: allow } : undefined));

// --- Body parsers ---
app.use(express.json({ limit: "12mb" }));

// --- Static web (./public/index.html) ---
app.use(express.static("public"));

// --- OpenAI client ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ใช้โมเดลที่เบาและไวสำหรับเว็บ
const CHAT_MODEL = "gpt-4o-mini";
const STT_MODEL  = "gpt-4o-mini-transcribe";

// --- Templates (ไทย) ---
const TEMPLATE_RULES = {
  "อายุรกรรม": {
    title: "แบบบันทึก OPD Card (อายุรกรรม)",
    sections: [
      "Chief Complaint (อาการสำคัญ)",
      "Present Illness (ลำดับเหตุการณ์/ลักษณะอาการ)",
      "Review of Systems (ถ้ามี)",
      "Past History / Meds / Allergy / Risk",
      "Physical Examination (สรุปสิ่งตรวจพบ)",
      "Assessment (วินิจฉัยหลัก/รอง พร้อมเหตุผลสั้นๆ)",
      "Plan (Investigation / Treatment / Advice-Follow-up)",
      "คำแนะนำผู้ป่วย",
      "บันทึกสำหรับแพทย์ (สิ่งที่ต้องติดตาม/ red flags / pending labs)"
    ],
    style: "กระชับ ชัดเจน ใช้ภาษาทางการของแพทย์ไทย ใส่ bullet ชัดเจน ไม่ใช้ภาษาพูด"
  },

  "ประสาทวิทยา": {
    title: "แบบบันทึก OPD Card (ประสาทวิทยา)",
    sections: [
      "Chief Complaint",
      "Onset & Time course (acute/subacute/chronic, trigger)",
      "Focal Neurologic Symptoms (motor/sensory/cerebellar/brainstem/cortex)",
      "Red flags (ถ้ามี)",
      "Neurologic Examination (CN / Motor / Sensory / Cerebellar / Gait / Meningeal)",
      "Impression (Localization + Syndromic Dx + DDX พร้อมเหตุผลสั้นๆ)",
      "Plan (MRI/CT/EEG/LP/labs, Rx/ปรับยา, Admission? / Refer?)",
      "คำแนะนำผู้ป่วย (warning signs, lifestyle, adherence)",
      "บันทึกสำหรับแพทย์ (follow-up target, scale/score ที่ใช้ติดตาม, pending results)"
    ],
    style: "ยึดโครง localization และ syndromic reasoning ให้เหตุผลสั้น กระชับ"
  },

  "SOAP-กายภาพ": {
    title: "บันทึกแบบ SOAP (เวชศาสตร์ฟื้นฟู/กายภาพบำบัด)",
    sections: [
      "S (Subjective): อาการ/ข้อจำกัดในการทำกิจวัตร, pain score, เป้าหมายผู้ป่วย",
      "O (Objective): ROM/แรงกล้ามเนื้อ, balance/gait, ชนิดการตรวจ, ค่าแบบทดสอบ",
      "A (Assessment): ปัญหาหลัก, impairment → activity/participation, ระดับความเสี่ยง",
      "P (Plan): โปรแกรม, ความถี่/ระยะเวลา, HEP, เฝ้าระวัง",
      "คำแนะนำผู้ป่วย (home program/precaution)",
      "บันทึกสำหรับแพทย์ (ตัวชี้วัดที่ติดตามครั้งหน้า)"
    ],
    style: "ภาษากายภาพบำบัด ชัดเจนต่อการติดตาม"
  },

  "ศัลยกรรมประสาท": {
    title: "แบบบันทึก OPD Card (ศัลยกรรมประสาท)",
    sections: [
      "Chief Complaint & Onset",
      "Neurologic deficits (ระดับความรุนแรง/การดำเนินโรค)",
      "Imaging summary (CT/MRI จุดเด่น/ข้าง/ระดับ, mass effect/shift/stenosis)",
      "Assessment (Dx/Stage/Indication for surgery; DDX)",
      "Plan (ผ่าตัด/เฝ้าระวัง/ยา/นัดภาพซ้ำ/consult)",
      "คำแนะนำผู้ป่วย (risk/benefit/เตรียมผ่าตัด/สัญญาณอันตราย)",
      "บันทึกสำหรับแพทย์ (checklist ก่อนผ่า/ labs/ consent/ clearance)"
    ],
    style: "โทนผ่าตัด เน้น imaging + indication + risk/benefit ชัดเจน"
  },

  "จักษุ": {
    title: "แบบบันทึก OPD Card (จักษุ)",
    sections: [
      "Chief Complaint",
      "History of present illness (laterality, onset, pain/photophobia, discharge, trauma)",
      "VA / Pinhole / Color vision / VF (ถ้ามี)",
      "Anterior segment / IOP / Fundus (สรุป)",
      "Assessment (Dx หลัก/รอง + เหตุผล)",
      "Plan (ยา/ขั้นตอน/นัด/ภาพถ่าย/ส่งต่อ)",
      "คำแนะนำผู้ป่วย (การหยอดยา, hygiene, warning signs)",
      "บันทึกสำหรับแพทย์ (target IOP/ค่า VA ที่คาดหวัง/ผลตรวจรอ)"
    ],
    style: "ใช้คำทดสอบตามมาตรฐานจักษุ ย่อได้แต่ครบ"
  },

  "ทั่วไป": {
    title: "แบบบันทึก OPD Card",
    sections: [
      "Chief Complaint",
      "Present Illness",
      "Past History / Meds / Allergy",
      "Examination",
      "Assessment",
      "Plan",
      "คำแนะนำผู้ป่วย",
      "บันทึกสำหรับแพทย์"
    ],
    style: "มาตรฐานทั่วไปของคลินิกไทย"
  }
};

// ---------- Prompt builder ----------
function buildThaiPrompt(text, templateKey = "ทั่วไป") {
  const t = TEMPLATE_RULES[templateKey] || TEMPLATE_RULES["ทั่วไป"];
  return `
คุณเป็นแพทย์เวรคลินิก ให้สรุปข้อความต่อไปนี้เป็นภาษาไทยล้วน
รูปแบบ: "${t.title}"
สำนวน: ${t.style}

ข้อบังคับ:
- ห้ามใส่ข้อมูลเท็จ ถ้าไม่ทราบให้เว้นหรือเขียนว่า "ยังไม่ระบุ"
- จัดหัวข้อเป็นบรรทัดชัดเจนตามลำดับด้านล่าง
- ใช้ bullet สั้น ๆ อ่านเร็ว, ขึ้นบรรทัดใหม่เมื่อเปลี่ยนประเด็น
- ปิดท้ายด้วย "คำแนะนำผู้ป่วย" และ "บันทึกสำหรับแพทย์" ทุกครั้ง

หัวข้อที่ต้องมี ตามลำดับ:
${t.sections.map((s,i)=>`${i+1}. ${s}`).join("\n")}

=== ข้อความเพื่อสรุป ===
${text}
`.trim();
}

async function summarizeThai(text, templateKey) {
  const messages = [
    { role: "system", content: "คุณคือแพทย์ที่สรุปเวชระเบียนเป็นภาษาไทยแบบมืออาชีพและปลอดภัย" },
    { role: "user", content: buildThaiPrompt(text, templateKey) }
  ];

  const resp = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    temperature: 0.2
  });

  return resp.choices?.[0]?.message?.content?.trim() || "";
}

// ---------- Upload endpoint (multer memory) ----------
const upload = multer({ storage: multer.memoryStorage() });

app.post("/upload-audio-and-summarize", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "ไม่มีไฟล์เสียง" });

    const template = String(req.query.template || "ทั่วไป");

    // เขียนเป็นไฟล์ชั่วคราว (บาง SDK ต้องการ path/stream)
    const tempPath = path.join(process.cwd(), `temp_${Date.now()}.bin`);
    fs.writeFileSync(tempPath, req.file.buffer);

    // Speech-to-Text (ไทย)
    const transcript = await openai.audio.transcriptions.create({
      model: STT_MODEL,
      file: fs.createReadStream(tempPath),
      response_format: "text"
    });

    fs.unlink(tempPath, () => {});

    const summary = await summarizeThai(transcript, template);
    return res.json({ ok: true, transcript, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Summarize-from-text ----------
app.post("/summarize-from-text", async (req, res) => {
  try {
    const { text = "", template = "ทั่วไป" } = req.body || {};
    if (!text.trim()) return res.status(400).json({ ok: false, error: "ไม่มีข้อความ" });
    const summary = await summarizeThai(text, template);
    res.json({ ok: true, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Health / Root ----------
app.get("/healthz", (_, res) => res.json({ ok: true }));
app.get("/", (req, res) => {
  const p = path.join(process.cwd(), "public", "index.html");
  if (fs.existsSync(p)) return res.sendFile(p);
  res.type("html").send(`<p>✅ Clinic Web Server is running!</p>`);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));