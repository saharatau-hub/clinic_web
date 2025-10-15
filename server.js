import express from "express";
import multer from "multer";
import fs from "fs";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(cors());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "YOUR_API_KEY_HERE",
});

const upload = multer({ dest: "uploads/" });

// 🧩 Template: ฟังก์ชันสร้างข้อความสรุปตามหมวด
function generateTemplate(text, templateType) {
  const templates = {
    neurology: `
**OPD Neurology Note**
- Chief Complaint: ${text}
- History: ประเมิน neurological deficit, reflex, sensory, motor function
- Assessment: วินิจฉัยตามข้อมูลทางระบบประสาท
- Plan: สั่งตรวจ MRI/CT ถ้าสงสัย lesion, ให้ยาตามอาการ, นัดติดตาม
- Advice: แจ้งอาการ red flag เช่น แขนขาอ่อนแรงทันที
    `,
    internal: `
**OPD Internal Medicine Note**
- Chief Complaint: ${text}
- History: ทบทวนระบบหัวใจ ปอด ไต ตับ
- Assessment: พิจารณาโรคทั่วไป เช่น ความดัน เบาหวาน
- Plan: ตรวจ CBC, LFT, Electrolyte
- Advice: ปรับพฤติกรรมการกิน ออกกำลังกาย
    `,
    physical: `
**Rehabilitation/Physical Therapy Note**
- Chief Complaint: ${text}
- Observation: ตรวจ range of motion, balance
- Treatment: กายภาพบำบัด, ยืดเหยียด, ฝึกเดิน
- Advice: ทำ exercise ต่อเนื่องที่บ้าน
    `,
    neurosurgery: `
**Neurosurgery Note**
- Chief Complaint: ${text}
- History: ประวัติ trauma, mass effect, intracranial lesion
- Plan: พิจารณาผ่าตัดหรือส่งต่อประสาทศัลยกรรม
- Advice: ติดตามผลภาพถ่ายรังสีและอาการทาง motor
    `,
    ophthalmology: `
**Ophthalmology Note**
- Chief Complaint: ${text}
- Examination: ตรวจ visual acuity, fundus, intraocular pressure
- Assessment: พิจารณา optic neuritis, glaucoma, cataract
- Plan: ให้ยาหยอดตา, นัด follow-up
    `
  };

  return templates[templateType] || templates["internal"];
}

// 🧾 สรุปจากข้อความโดยตรง
app.post("/summarize-from-text", async (req, res) => {
  try {
    const { text, template } = req.body;
    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a Thai medical summarization assistant." },
        { role: "user", content: `สรุปข้อความต่อไปนี้เป็น OPD card ภาษาไทย:\n${generateTemplate(text, template)}` }
      ],
    });

    const result = completion.choices[0].message.content;
    res.json({ ok: true, summary: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 🎙️ อัปโหลดเสียงและสรุปอัตโนมัติ
app.post("/upload-audio-and-summarize", upload.single("audio"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const { template } = req.query;

    const transcript = await client.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "gpt-4o-mini-transcribe",
      language: "th",
    });

    const summary = generateTemplate(transcript.text, template);
    fs.unlinkSync(filePath);
    res.json({ ok: true, transcript: transcript.text, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("✅ Clinic Web Server is running!");
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
