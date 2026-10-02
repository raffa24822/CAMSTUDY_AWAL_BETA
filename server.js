const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// CORS Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    return res.status(200).json({});
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const DATA_FILE = path.join('/opt/render/project/src', 'asts-data.json');

// Buat data otomatis dengan password admin123
const defaultData = {
  banks: [],
  exambanks: [],
  users: [
    { id: 'admin', name: 'Administrator', role: 'admin', pin: 'admin123', accessCode: 'GURU2026' }
  ]
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Gagal membaca data file:', e.message);
  }
  return defaultData;
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Gagal menyimpan data file:', e.message);
  }
}

let db = loadData();

// Endpoint AI Generate Questions
app.post('/api/generate-questions', async (req, res) => {
  const apiKey = String(process.env.OPENAI_API_KEY || '');
  if (!apiKey) return res.status(503).json({ error: 'AI belum dikonfigurasi pada Environment.' });
  
  const material = String(req.body && req.body.material || '').trim();
  const subject = String(req.body && req.body.subject || 'Umum').trim().slice(0, 120);
  const count = Math.max(1, Math.min(50, Number(req.body && req.body.count) || 10));

  if (material.length < 80) return res.status(400).json({ error: 'Materi terlalu singkat.' });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Anda membantu guru membuat soal dalam format JSON valid.' },
          { role: 'user', content: 'Mata pelajaran: ' + subject + '\nJumlah: ' + count + '\n\nMATERI:\n' + material }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: 'Gagal dari penyedia AI.' });

    const output = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    const parsed = JSON.parse(output);

    return res.json({ ok: true, questions: parsed.questions || [] });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal terhubung ke layanan AI.' });
  }
});

// Melayani file statis
app.use(express.static(__dirname));

// Melayani file portal HTML utama
app.get('*', (req, res) => {
  const portalFile = path.join(__dirname, 'PORTAL_AYO_BELAJAR_FINAL.html');
  if (fs.existsSync(portalFile)) {
    return res.sendFile(portalFile);
  }
  
  try {
    const files = fs.readdirSync(__dirname);
    const htmlFile = files.find(f => f.endsWith('.html'));
    if (htmlFile) return res.sendFile(path.join(__dirname, htmlFile));
  } catch (e) {}

  res.status(404).send('File portal HTML tidak ditemukan.');
});

app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
