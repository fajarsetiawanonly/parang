# KDKMP PARANG — Dashboard Penjualan, Stok & Logistik

Sistem Informasi Terpadu Single Page Application (SPA) modern dan serverless untuk **Koperasi / Usaha Dagang KDKMP Parang**. Aplikasi ini dirancang khusus untuk di-hosting di **GitHub Pages** dan menggunakan **Google Spreadsheet + Google Apps Script + Google Drive** sebagai database dan penyimpanan file tanpa biaya lisensi (100% Free & Open).

---

## 🚀 Fitur Utama

1. **Ringkasan Penjualan (`overview`)**:
   - 4 KPI Real-Time: Total Pendapatan (Omset), Total Kuantitas Terjual, Produk Aktif Terjual, dan Rata-rata Omset Harian.
   - Filter Periode Global: Semua, Bulan Ini, Minggu Ini, Hari Ini.
   - 4 Visualisasi Interaktif Chart.js:
     - Tren Pendapatan Penjualan (Line Chart dengan gradient fill).
     - Top 5 Produk Terlaris (Doughnut Chart).
     - Pendapatan per Produsen/Supplier (Horizontal Bar Chart).
     - Tren Volume Kuantitas Terjual (Bar Chart).

2. **Daftar Produk (`products`)**:
   - Pencarian real-time nama produk atau produsen.
   - Filter berdasarkan produsen dan pengurutan (Omset terbesar/terkecil, Qty, Nama A-Z, Harga).
   - Indikator bar pendapatan visual pada setiap baris.
   - Fitur ekspor tabel ke format **CSV**.

3. **Analisis Produsen (`producers`)**:
   - Grafik perbandingan omset rupiah vs volume distribusi per brand.
   - Grafik pangsa omset (*market share*).
   - Tabel kontribusi persentase omset per produsen.

4. **Stok Opname (`stock`)**:
   - Pilihan tanggal stok opname dinamis (otomatis membaca sheet tanggal di Excel/Google Sheet).
   - 4 KPI Inventori: Produk Tersedia, Estimasi Nilai Stok (Unit × Harga), Alert Stok Menipis (stok $\le$ 5 pcs), dan Tanggal Opname Terpilih.
   - Rincian stok toko (groceries), stok gudang (warehouse), total stok, nilai inventori, dan badge pergerakan stok otomatis dibanding tanggal opname sebelumnya.

5. **Penerimaan Barang & Faktur Logistik (`logistics`)**:
   - **Form Input Faktur Baru**:
     - No. PO, No. DO, Tanggal Diterima, Pengirim, Nopol Kendaraan, Nama Sopir, dan No. HP.
     - Upload Bukti Foto STB (Surat Terima Barang) dengan preview.
     - Upload Bukti Foto Dokumen Lainnya (multi-upload dengan galeri thumbnail dan tombol hapus).
     - **Kompresi Gambar Otomatis di Browser**: Gambar dikompresi via HTML5 Canvas sebelum dikirim ke Google Drive agar hemat kuota dan tidak timeout.
     - **Daftar Barang Dinamis**: Input baris barang tanpa batas dengan *autocomplete* nama produk dari daftar harga, input qty, dan expired date.
   - **Riwayat Faktur & Monitoring Kedaluwarsa**:
     - Alert otomatis untuk barang mendekati kedaluwarsa ($\le$ 30 hari atau sudah lewat) dengan badge warna mencolok.
     - Modal Detail Faktur dengan metadata lengkap, rincian barang, status expired, dan **Lightbox / Galeri Foto Dokumen**.

6. **Sentralisasi "Core App", Hardcoded Defaults & Override Sub-Database**:
   - Terintegrasi dengan **IndexedDB** (`kdkmp_dashboard_db`) sehingga dashboard dapat dibuka kembali secara instan meski tanpa koneksi internet.
   - **Link Core App dan Apps Script sudah tertanam secara hardcode** di sistem sehingga aplikasi langsung siap pakai tanpa perlu konfigurasi ulang.
   - Di menu Pengaturan, Admin dapat:
     - Mengubah **Link / ID Folder Google Drive** untuk penyimpanan foto.
     - Mengubah/menimpa (*override*) link masing-masing sub-database secara mandiri (`stock_opname`, `daftar_harga`, `faktur_logistik`).
     - Mengembalikan link ke bawaan Core App dengan 1 klik.

7. **Sistem Multi-Pengguna & Otoritas (RBAC - Role Based Access Control)**:
   - **Akun Admin (`admin` / `admin123`)**:
     - Akses penuh ke seluruh menu: Ringkasan Penjualan, Daftar Produk, Analisis Produsen, Stok Opname, Faktur Logistik, dan Pengaturan Database.
   - **Akun Asmen (`asmen` / `asmen123`)**:
     - Otoritas operasional: **Hanya dapat mengakses menu Stok Opname dan Faktur & Logistik**.
     - Menu Ringkasan Penjualan, Daftar Produk, Analisis Produsen, serta tombol Pengaturan Database otomatis disembunyikan.
     - Setiap transaksi faktur mencatat nama operator yang sedang aktif (`Petugas Input`).

---

## 📁 Struktur File Proyek

```text
├── index.html            # Struktur HTML5 SPA, modal, dan dynamic form
├── style.css             # Tema GitHub Dark, glassmorphism, responsive mobile
├── app.js                # Engine kalkulasi, IndexedDB, parser SheetJS, Chart.js
├── Kode_Apps_Script.gs   # Backend Google Apps Script (Drive & Sheets API)
└── README.md             # Panduan instalasi dan dokumentasi teknis
```

---

## 🛠️ Panduan Pemasangan Google Apps Script & Google Drive

Agar aplikasi dapat menyimpan faktur dan mengunggah foto ke Google Drive, ikuti langkah mudah berikut:

1. Buat Google Spreadsheet baru di Google Drive Anda.
2. Klik menu **Ekstensi (Extensions)** > **Apps Script**.
3. Hapus isi file `Code.gs` default, lalu salin dan tempelkan seluruh isi file [`Kode_Apps_Script.gs`](Kode_Apps_Script.gs).
4. Di bagian atas editor Apps Script, pilih fungsi `initDatabaseStructure` lalu klik **Jalankan (Run)**.
   - Ini akan otomatis membuat sheet `Core_App`, `Faktur_Header`, dan `Faktur_Detail` lengkap dengan header berwarna.
5. Klik tombol biru **Terapkan (Deploy)** > **Penerapan Baru (New Deployment)**.
6. Konfigurasi:
   - Jenis: **Aplikasi Web (Web App)**.
   - Jalankan sebagai: **Saya (Me / Akun Google Anda)**.
   - Siapa yang memiliki akses: **Siapa saja (Anyone)** *(Penting agar browser dapat mengakses API)*.
7. Klik **Terapkan (Deploy)** dan setujui izin otorisasi Google.
8. Salin **URL Aplikasi Web** yang berakhiran `/exec`.
9. Buka Dashboard KDKMP Parang, klik ikon **Pengaturan (Gear)** di sidebar, lalu tempelkan URL tersebut ke kolom **URL Web App Google Apps Script**.

---

## 🌐 Cara Hosting di GitHub Pages

1. Buat repositori baru di GitHub (misal: `kdkmp-parang`).
2. Unggah seluruh file (`index.html`, `style.css`, `app.js`, `Kode_Apps_Script.gs`, `README.md`) ke repositori tersebut:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - KDKMP Parang Dashboard"
   git branch -M main
   git remote add origin https://github.com/USERNAME/kdkmp-parang.git
   git push -u origin main
   ```
3. Di GitHub, buka tab **Settings** > **Pages**.
4. Pada bagian **Build and deployment** > **Source**, pilih **Deploy from a branch**.
5. Pilih branch **main** dan folder **/(root)**, lalu klik **Save**.
6. Dalam 1-2 menit, situs Anda akan aktif di:
   `https://USERNAME.github.io/kdkmp-parang/`

---

## 🎨 Palet Warna & Desain UI

- **Background:** `#0d1117` (GitHub Dark)
- **Cards & Surfaces:** `#161b22`, `#21262d`
- **Borders:** `#30363d`
- **Text Main:** `#e6edf3`, `#7d8590`
- **Accent Blue:** `#58a6ff`
- **Status Green:** `#3fb950`
- **Alert Red:** `#f85149`
- **Warning Yellow:** `#d29922`
- **Special Purple:** `#bc8cff`

---

Dibuat dengan ❤️ untuk kemajuan manajemen logistik & perdagangan KDKMP Parang.
