# PORTAL AYO BELAJAR FINAL — perbaikan kunci AI

Isi paket:
- `PORTAL_AYO_BELAJAR_FINAL.html`: halaman portal.
- `server.js`: server API.
- `package.json`: dependensi.
- `render.yaml`: contoh konfigurasi Render.

## Perbaikan
- Instruksi AI diperketat agar menentukan jawaban dari materi, menghitung indeks opsi final, dan mencocokkan kunci dengan pembahasan.
- Pesan di halaman guru menegaskan pemeriksaan kunci sebelum soal dibagikan.
- Menghapus alert sukses ganda yang merujuk variabel tidak ada.

## Penting
AI tetap dapat membuat kesalahan. Guru wajib meninjau kunci dan pembahasan sebelum soal dipakai untuk penilaian. Uji di salinan/deployment staging terlebih dahulu dan cadangkan data sebelum mengganti file produksi. Jangan masukkan API key ke file HTML; simpan sebagai Environment Variable `OPENAI_API_KEY` di server.
