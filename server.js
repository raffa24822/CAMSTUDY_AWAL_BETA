const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// Set CORS secara manual
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

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Gagal membaca data file:', e.message);
  }
  return { banks: [], exambanks: [] };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Gagal menyimpan data file:', e.message);
  }
}

let db = loadData();

function auth(req, res, next) {
  next();
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

app.post('/api/generate-questions', auth, async (req, res) => {
  const apiKey = String(process.env.OPENAI_API_KEY || '');
  if (!apiKey) return sendError(res, 503, 'AI belum dikonfigurasi. Admin perlu mengatur OPENAI_API_KEY pada Environment hosting.');
  const material = String(req.body && req.body.material || '').trim();
  const subject = String(req.body && req.body.subject || 'Umum').trim().slice(0, 120);
  const count = Math.max(1, Math.min(50, Number(req.body && req.body.count) || 10));
  if (material.length < 80) return sendError(res, 400, 'Materi terlalu singkat. Tempel materi yang lebih lengkap.');
  if (material.length > 30000) return sendError(res, 413, 'Materi terlalu panjang. Batas materi adalah 30.000 karakter.');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: 'Anda membantu guru SMA/SMK Indonesia membuat soal dalam format JSON hanya dari MATERI SUMBER. KETEPATAN KUNCI ADALAH PRIORITAS UTAMA. Untuk setiap soal pilihan: (1) tentukan jawaban benar berdasarkan materi terlebih dahulu, (2) susun empat opsi dengan tepat satu jawaban benar untuk tipe choice, (3) setelah urutan opsi final ditentukan, hitung ulang answer sebagai indeks 0-based dari opsi final: 0=opsi pertama/A, 1=opsi kedua/B, 2=opsi ketiga/C, 3=opsi keempat/D, (4) cek ulang bahwa opsi pada indeks answer benar-benar menjawab pertanyaan dan cocok dengan exp. Jangan pernah menulis huruf jawaban di answer; gunakan angka indeks. Pastikan exp menerangkan mengapa jawaban itu benar dan tidak bertentangan dengan opsi lain. Hindari pertanyaan ambigu, opsi yang sama-sama benar, dan fakta yang tidak ada di materi. Jika materi tidak cukup untuk membuat soal yang valid, jangan mengarang. Variasikan tipe: choice, multiple, essay. Untuk multiple, answer berupa array indeks benar dan minimal 2; semua jawaban yang dipilih harus benar. Untuk essay, answerText berisi kunci lengkap, rubric berisi konsep wajib/sinonim, options=[] dan answer=null. Kembalikan JSON valid {"questions":[{"type":"choice|multiple|essay","q":"...","options":[],"answer":null,"answerText":"...","rubric":"...","exp":"..."}]}. Buat soal kelas 10 yang jelas, tidak duplikat, dan tidak melebihi jumlah diminta. Sebelum mengirim, audit sekali lagi semua kunci dan pembahasan. Jangan sertakan markdown.'
          },
          {
            role: 'user',
            content: 'Mata pelajaran: ' + subject + '\nJumlah soal: ' + count + '\n\nMATERI SUMBER:\n' + material
          }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : 'Penyedia AI tidak dapat membuat soal.';
      console.error('OpenAI API error:', response.status, msg);
      return sendError(res, response.status === 429 ? 429 : 502, response.status === 429 ? 'Batas penggunaan AI tercapai. Coba lagi nanti.' : 'Layanan AI mengalami kendala.');
    }

    const output = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    let parsed;
    try { parsed = JSON.parse(output); } catch (_) { return sendError(res, 502, 'Jawaban AI tidak dapat dibaca.'); }
    if (!parsed || !Array.isArray(parsed.questions)) return sendError(res, 502, 'AI tidak mengembalikan daftar soal.');

    const questions = parsed.questions.slice(0, count).map(q => {
      const type = ['choice','multiple','essay'].includes(q.type) ? q.type : 'choice';
      const options = Array.isArray(q.options) ? q.options.slice(0, 4).map(v => String(v || '').trim()) : [];
      const answer = type === 'multiple' ? (Array.isArray(q.answer) ? q.answer.map(Number).filter(n => !isNaN(n)) : []) : (typeof q.answer === 'number' ? q.answer : null);
      return {
        type,
        q: String(q.q || '').trim().slice(0, 1200),
        options,
        answer,
        answerText: String(q.answerText || (type === 'essay' ? q.answer || '' : '')).trim().slice(0, 2000),
        rubric: String(q.rubric || '').trim().slice(0, 2500),
        exp: String(q.exp || '').trim().slice(0, 2000)
      };
    }).filter(q => q.q && (q.type === 'essay' ? q.answerText.length > 0 : q.options.length === 4 && q.answer !== null));

    if (!questions.length) return sendError(res, 502, 'AI tidak menghasilkan soal valid. Coba materi lain.');
    return res.json({ ok: true, questions });
  } catch (error) {
    console.error('Gagal menghubungi layanan AI:', error.message);
    return sendError(res, 500, 'Gagal terhubung ke layanan AI.');
  }
});

// Sajikan file statis dari folder public jika ada, jika tidak dari root
const publicPath = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
app.use(express.static(publicPath));

app.get('*', (req, res) => {
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  const rootIndex = path.join(__dirname, 'index.html');
  
  if (fs.existsSync(publicIndex)) {
    res.sendFile(publicPenyebab utamanya terlihat jelas dari log Render di screenshot kedua:

`Error: ENOENT: no such file or directory, stat '/opt/render/project/src/public/index.html'`

Artinya, server berhasil berjalan, tetapi ketika pengunjung membuka web, server mencari file `index.html` langsung di luar (root), padahal di kode `server.js` kita menyuruh server mencarinya di folder `public` (`/public/index.html`).

---

### Solusi Cepat (Perbaiki `server.js`)

Cukup perbarui file `server.js` agar bisa mencari file web utama (seperti `index.html`) langsung di folder utama repository maupun folder `public`.

Berikut kode **`server.js`** yang sudah disesuaikan:

```javascript
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// Set CORS manual
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

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Gagal membaca data file:', e.message);
  }
  return { banks: [], exambanks: [] };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Gagal menyimpan data file:', e.message);
  }
}

let db = loadData();

function auth(req, res, next) {
  next();
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

app.post('/api/generate-questions', auth, async (req, res) => {
  const apiKey = String(process.env.OPENAI_API_KEY || '');
  if (!apiKey) return sendError(res, 503, 'AI belum dikonfigurasi. Admin perlu mengatur OPENAI_API_KEY pada Environment hosting.');
  const material = String(req.body && req.body.material || '').trim();
  const subject = String(req.body && req.body.subject || 'Umum').trim().slice(0, 120);
  const count = Math.max(1, Math.min(50, Number(req.body && req.body.count) || 10));
  if (material.length < 80) return sendError(res, 400, 'Materi terlalu singkat. Tempel materi yang lebih lengkap.');
  if (material.length > 30000) return sendError(res, 413, 'Materi terlalu panjang. Batas materi adalah 30.000 karakter.');

  try {
    const response = await fetch('[https://api.openai.com/v1/chat/completions](https://api.openai.com/v1/chat/completions)', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: 'Anda membantu guru SMA/SMK Indonesia membuat soal dalam format JSON hanya dari MATERI SUMBER. KETEPATAN KUNCI ADALAH PRIORITAS UTAMA. Untuk setiap soal pilihan: (1) tentukan jawaban benar berdasarkan materi terlebih dahulu, (2) susun empat opsi dengan tepat satu jawaban benar untuk tipe choice, (3) setelah urutan opsi final ditentukan, hitung ulang answer sebagai indeks 0-based dari opsi final: 0=opsi pertama/A, 1=opsi kedua/B, 2=opsi ketiga/C, 3=opsi keempat/D, (4) cek ulang bahwa opsi pada indeks answer benar-benar menjawab pertanyaan dan cocok dengan exp. Jangan pernah menulis huruf jawaban di answer; gunakan angka indeks. Pastikan exp menerangkan mengapa jawaban itu benar dan tidak bertentangan dengan opsi lain. Hindari pertanyaan ambigu, opsi yang sama-sama benar, dan fakta yang tidak ada di materi. Jika materi tidak cukup untuk membuat soal yang valid, jangan mengarang. Variasikan tipe: choice, multiple, essay. Untuk multiple, answer berupa array indeks benar dan minimal 2; semua jawaban yang dipilih harus benar. Untuk essay, answerText berisi kunci lengkap, rubric berisi konsep wajib/sinonim, options=[] dan answer=null. Kembalikan JSON valid {"questions":[{"type":"choice|multiple|essay","q":"...","options":[],"answer":null,"answerText":"...","rubric":"...","exp":"..."}]}. Buat soal kelas 10 yang jelas, tidak duplikat, dan tidak melebihi jumlah diminta. Sebelum mengirim, audit sekali lagi semua kunci dan pembahasan. Jangan sertakan markdown.'
          },
          {
            role: 'user',
            content: 'Mata pelajaran: ' + subject + '\nJumlah soal: ' + count + '\n\nMATERI SUMBER:\n' + material
          }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : 'Penyedia AI tidak dapat membuat soal.';
      console.error('OpenAI API error:', response.status, msg);
      return sendError(res, response.status === 429 ? 429 : 502, response.status === 429 ? 'Batas penggunaan AI tercapai. Coba lagi nanti.' : 'Layanan AI mengalami kendala.');
    }

    const output = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    let parsed;
    try { parsed = JSON.parse(output); } catch (_) { return sendError(res, 502, 'Jawaban AI tidak dapat dibaca.'); }
    if (!parsed || !Array.isArray(parsed.questions)) return sendError(res, 502, 'AI tidak mengembalikan daftar soal.');

    const questions = parsed.questions.slice(0, count).map(q => {
      const type = ['choice','multiple','essay'].includes(q.type) ? q.type : 'choice';
      const options = Array.isArray(q.options) ? q.options.slice(0, 4).map(v => String(v || '').trim()) : [];
      const answer = type === 'multiple' ? (Array.isArray(q.answer) ? q.answer.map(Number).filter(n => !isNaN(n)) : []) : (typeof q.answer === 'number' ? q.answer : null);
      return {
        type,
        q: String(q.q || '').trim().slice(0, 1200),
        options,
        answer,
        answerText: String(q.answerText || (type === 'essay' ? q.answer || '' : '')).trim().slice(0, 2000),
        rubric: String(q.rubric || '').trim().slice(0, 2500),
        exp: String(q.exp || '').trim().slice(0, 2000)
      };
    }).filter(q => q.q && (q.type === 'essay' ? q.answerText.length > 0 : q.options.length === 4 && q.answer !== null));

    if (!questions.length) return sendError(res, 502, 'AI tidak menghasilkan soal valid. Coba materi lain.');
    return res.json({ ok: true, questions });
  } catch (error) {
    console.error('G
