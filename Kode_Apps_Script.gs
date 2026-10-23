/**
 * ============================================================================
 * KDKMP PARANG — BACKEND GOOGLE APPS SCRIPT (SERVERLESS API)
 * Sistem Database Spreadsheet & Penyimpanan Foto Dokumen di Google Drive
 * ============================================================================
 * 
 * PANDUAN PEMASANGAN (DEVOPS SETUP):
 * ----------------------------------------------------------------------------
 * 1. Buka Google Spreadsheet baru Anda (atau spreadsheet Core App).
 * 2. Klik menu "Ekstensi" (Extensions) > "Apps Script".
 * 3. Hapus semua kode default, lalu tempelkan seluruh kode ini ke editor Apps Script.
 * 4. Jalankan fungsi "initDatabaseStructure" sekali untuk membuat sheet Core_App,
 *    Faktur_Header, dan Faktur_Detail secara otomatis dengan header kolom yang rapi.
 * 5. Klik tombol biru "Terapkan" (Deploy) > "Penerapan Baru" (New Deployment).
 * 6. Pilih jenis: "Aplikasi Web" (Web App).
 *    - Deskripsi: KDKMP Parang API v2.5
 *    - Jalankan sebagai (Execute as): "Saya" (Me / akun Google Anda)
 *    - Siapa yang memiliki akses (Who has access): "Siapa saja" (Anyone) -> SANGAT PENTING!
 * 7. Klik "Terapkan" (Deploy), lalu izinkan otorisasi akses Google Drive & Spreadsheet.
 * 8. Salin URL Aplikasi Web yang diberikan (berakhiran `/exec`), lalu tempelkan
 *    ke menu "Pengaturan & Sinkronisasi" di aplikasi web KDKMP Parang.
 * ============================================================================
 */

// Konstanta Nama Folder Google Drive untuk Menyimpan Foto Dokumen
const FOLDER_NAME_DRIVE = "KDKMP_Dokumen_Faktur";

/**
 * Inisialisasi struktur sheet dan kolom awal secara otomatis
 */
function initDatabaseStructure() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Sheet Core_App (Format: No | Nama Data | Data)
  let sheetCore = ss.getSheetByName("Core_App") || ss.getSheetByName("Sheet1");
  if (!sheetCore) {
    sheetCore = ss.insertSheet("Core_App");
  }

  // Jika sheet kosong, isi header dan baris sesuai format pengguna
  if (sheetCore.getLastRow() === 0) {
    const headersCore = ["No", "Nama Data", "Data"];
    sheetCore.appendRow(headersCore);
    sheetCore.getRange("A1:C1").setFontWeight("bold").setBackground("#1f242c").setFontColor("#58a6ff");
    
    // Baris Standar Sesuai Gambar Pengguna
    sheetCore.appendRow([1, "SO", "https://docs.google.com/spreadsheets/d/18u-hFXEnEzPq2ZlHIeG09QDq0QDjsyNb/edit?usp=drive_link"]);
    sheetCore.appendRow([2, "Harga", "https://docs.google.com/spreadsheets/d/1bxh0Ji02UaUqQztJn566lMuG10CWfwL6/edit?usp=drive_link"]);
    sheetCore.appendRow([3, "Faktur", ss.getUrl()]);
  }

  // 2. Sheet Faktur_Header (Format Header Terstandarisasi)
  let sheetHeader = ss.getSheetByName("Faktur_Header");
  if (!sheetHeader) {
    sheetHeader = ss.insertSheet("Faktur_Header");
    const headersH = [
      "id_faktur", "timestamp", "no_po", "no_do", "tgl_diterima", 
      "pengirim", "nopol_pengirim", "nama_sopir", "kontak_sopir", 
      "dibuat_oleh", "url_foto_stb", "url_foto_dokumen_lain", "total_jenis_barang", "total_qty_diterima"
    ];
    sheetHeader.appendRow(headersH);
    sheetHeader.getRange("A1:N1").setFontWeight("bold").setBackground("#161b22").setFontColor("#3fb950");
  }

  // 3. Sheet Faktur_Detail
  let sheetDetail = ss.getSheetByName("Faktur_Detail");
  if (!sheetDetail) {
    sheetDetail = ss.insertSheet("Faktur_Detail");
    const headersD = ["id_faktur", "nama_barang", "qty_diterima", "tgl_expired"];
    sheetDetail.appendRow(headersD);
    sheetDetail.getRange("A1:D1").setFontWeight("bold").setBackground("#161b22").setFontColor("#bc8cff");
  }

  Logger.log("Inisialisasi database KDKMP Parang selesai!");
}

/**
 * Handle HTTP GET Requests (Membaca Data / Proxy Spreadsheet Anti-CORS)
 */
function doGet(e) {
  try {
    const action = e.parameter.action || "getAllData";

    // Aksi 1: Ambil data seluruh sheet pada spreadsheet tertentu (Proxy Anti-CORS)
    if (action === "getSpreadsheetData") {
      const sheetId = e.parameter.sheetId;
      if (!sheetId) {
        return createJsonResponse({ status: "error", message: "Parameter sheetId tidak diberikan." });
      }

      const targetSs = SpreadsheetApp.openById(sheetId);
      const sheets = targetSs.getSheets();
      const resultSheets = {};

      sheets.forEach(sh => {
        const data = sh.getDataRange().getValues();
        resultSheets[sh.getName()] = data;
      });

      return createJsonResponse({
        status: "success",
        spreadsheetName: targetSs.getName(),
        sheets: resultSheets
      });
    }

    // Aksi 2: Ambil seluruh data Faktur & Core App dari spreadsheet aktif
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetCore = ss.getSheetByName("Core_App");
    const sheetHeader = ss.getSheetByName("Faktur_Header");
    const sheetDetail = ss.getSheetByName("Faktur_Detail");

    const coreCatalog = sheetCore ? sheetToJson(sheetCore) : [];
    const headersList = sheetHeader ? sheetToJson(sheetHeader) : [];
    const detailsList = sheetDetail ? sheetToJson(sheetDetail) : [];

    return createJsonResponse({
      status: "success",
      catalog: coreCatalog,
      headers: headersList,
      details: detailsList
    });

  } catch (error) {
    return createJsonResponse({
      status: "error",
      message: error.toString()
    });
  }
}

/**
 * Handle HTTP POST Requests (Menyimpan Faktur Baru & Upload Foto ke Google Drive)
 */
function doPost(e) {
  try {
    let payload;
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else {
      payload = e.parameter;
    }

    const action = payload.action || "createFaktur";

    if (action === "createFaktur") {
      const header = payload.header;
      const items = payload.items || [];

      if (!header || !header.id_faktur) {
        return createJsonResponse({ status: "error", message: "Data header faktur tidak lengkap." });
      }

      // 1. Dapatkan atau Buat Folder di Google Drive (Gunakan link/ID custom jika dikirim dari web)
      let driveFolder = null;
      if (header.drive_folder_url) {
        const match = String(header.drive_folder_url).match(/\/folders\/([a-zA-Z0-9-_]+)/);
        const folderId = match ? match[1] : header.drive_folder_url.trim();
        try {
          driveFolder = DriveApp.getFolderById(folderId);
        } catch (e) {
          Logger.log("Folder custom tidak dapat dibuka, menggunakan folder bawaan: " + e.toString());
        }
      }
      if (!driveFolder) {
        driveFolder = getOrCreateDriveFolder(FOLDER_NAME_DRIVE);
      }

      // 2. Simpan Foto STB (Base64 -> File Google Drive)
      let urlFotoStb = "";
      if (header.stb_photo_base64) {
        const filename = `STB_${header.id_faktur}_${header.stb_filename || 'dokumen.jpg'}`;
        urlFotoStb = saveBase64ImageToDrive(driveFolder, header.stb_photo_base64, filename);
      }

      // 3. Simpan Foto Dokumen Lainnya (Array Base64 -> Files Google Drive)
      const urlsDokumenLain = [];
      if (header.other_photos && Array.isArray(header.other_photos)) {
        header.other_photos.forEach((photoObj, index) => {
          if (photoObj.base64) {
            const filename = `DOK_${header.id_faktur}_${index + 1}_${photoObj.name || 'lampiran.jpg'}`;
            const url = saveBase64ImageToDrive(driveFolder, photoObj.base64, filename);
            if (url) urlsDokumenLain.push(url);
          }
        });
      }

      // 4. Simpan ke Sheet Faktur_Header (Mendukung spreadsheet faktur custom atau spreadsheet aktif)
      let ss = SpreadsheetApp.getActiveSpreadsheet();
      if (header.faktur_spreadsheet_url) {
        const match = String(header.faktur_spreadsheet_url).match(/\/d\/([a-zA-Z0-9-_]+)/);
        const ssId = match ? match[1] : header.faktur_spreadsheet_url.trim();
        try {
          ss = SpreadsheetApp.openById(ssId);
        } catch (e) {
          Logger.log("Menggunakan active spreadsheet: " + e.toString());
        }
      }

      let sheetH = ss.getSheetByName("Faktur_Header");
      if (!sheetH) {
        sheetH = ss.insertSheet("Faktur_Header");
        const headersH = [
          "id_faktur", "timestamp", "no_po", "no_do", "tgl_diterima", 
          "pengirim", "nopol_pengirim", "nama_sopir", "kontak_sopir", 
          "dibuat_oleh", "url_foto_stb", "url_foto_dokumen_lain", "total_jenis_barang", "total_qty_diterima"
        ];
        sheetH.appendRow(headersH);
        sheetH.getRange("A1:N1").setFontWeight("bold").setBackground("#161b22").setFontColor("#3fb950");
      }

      const rowHeader = [
        header.id_faktur,
        header.timestamp || new Date().toISOString(),
        header.no_po || "-",
        header.no_do || "-",
        header.tgl_diterima || "",
        header.pengirim || "-",
        header.nopol_pengirim || "-",
        header.nama_sopir || "-",
        header.kontak_sopir || "-",
        header.dibuat_oleh || "-",
        urlFotoStb,
        JSON.stringify(urlsDokumenLain),
        header.total_jenis_barang || items.length,
        header.total_qty_diterima || items.reduce((s, it) => s + (Number(it.qty_diterima) || 0), 0)
      ];

      sheetH.appendRow(rowHeader);

      // 5. Simpan ke Sheet Faktur_Detail
      let sheetD = ss.getSheetByName("Faktur_Detail");
      if (!sheetD) {
        sheetD = ss.insertSheet("Faktur_Detail");
        sheetD.appendRow(["id_faktur", "nama_barang", "qty_diterima", "tgl_expired"]);
      }

      items.forEach(it => {
        sheetD.appendRow([
          header.id_faktur,
          it.nama_barang || "-",
          Number(it.qty_diterima) || 0,
          it.tgl_expired || ""
        ]);
      });

      return createJsonResponse({
        status: "success",
        message: "Faktur penerimaan barang berhasil disimpan!",
        id_faktur: header.id_faktur,
        url_foto_stb: urlFotoStb,
        url_foto_dokumen_lain: urlsDokumenLain
      });
    }

    return createJsonResponse({ status: "error", message: "Aksi tidak dikenali." });

  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: err.toString()
    });
  }
}

/**
 * Mencari folder di Google Drive, atau membuatnya jika belum ada
 */
function getOrCreateDriveFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  const newFolder = DriveApp.createFolder(folderName);
  // Set agar file di dalamnya bisa dilihat publik jika memiliki link
  newFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return newFolder;
}

/**
 * Mengonversi Base64 Data URL menjadi File Gambar di Google Drive
 * dan mengembalikan Link Akses Langsung
 */
function saveBase64ImageToDrive(folder, base64DataString, fileName) {
  try {
    let contentType = "image/jpeg";
    let pureBase64 = base64DataString;

    // Pisahkan header data URI jika ada (misal: "data:image/jpeg;base64,...")
    if (base64DataString.indexOf("data:") === 0) {
      const parts = base64DataString.split(",");
      const meta = parts[0];
      pureBase64 = parts[1];
      const mimeMatch = meta.match(/data:(.*?);/);
      if (mimeMatch) {
        contentType = mimeMatch[1];
      }
    }

    const decodedBytes = Utilities.base64Decode(pureBase64);
    const blob = Utilities.newBlob(decodedBytes, contentType, fileName);
    const file = folder.createFile(blob);
    
    // Set izin akses viewer untuk file ini
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Dapatkan Direct View URL Google Drive
    const fileId = file.getId();
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  } catch (e) {
    Logger.log("Gagal menyimpan foto ke Drive: " + e.toString());
    return "";
  }
}

/**
 * Helper: Mengubah data sheet menjadi Array of Objects (JSON)
 */
function sheetToJson(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const headerKey = String(headers[j]).trim();
      if (headerKey) {
        obj[headerKey] = row[j];
      }
    }
    rows.push(obj);
  }

  return rows;
}

/**
 * Helper: Mengembalikan respons JSON dengan header CORS yang aman
 */
function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
