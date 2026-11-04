/**
 * ====================================================================
 * SIMASTER CSSD - BACKEND ENGINE (Code.gs)
 * Sistem Informasi Manajemen Sterilisasi Rumah Sakit
 * ====================================================================
 */

// KONSTANTA NAMA SHEET DATABASE
const SHT_TRANSAKSI     = "Transaksi";
const SHT_MASTER_SU     = "Master_SingleUse";
const SHT_DB_INSTRUMEN  = "DB_Instrumen";

/**
 * 1. FUNGSI UTAMA WEB APP (ENTRY POINT)
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('SIMASTER CSSD - Sistem Informasi & Manajemen Sterilisasi')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Helper untuk menyisipkan file HTML/CSS/JS tambahan jika dipisah
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 2. FUNGSI PRE-CHECK REALTIME (SAAT SCAN BARCODE/QR)
 */
function cekKuotaSingleUse(qrScan) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetSU = ss.getSheetByName(SHT_MASTER_SU);
    
    if (!sheetSU) {
      return { status: "NOT_FOUND", pesan: "Sheet Master Single-Use belum dibuat." };
    }

    const dataSU = sheetSU.getDataRange().getValues();
    const cleanQr = (qrScan || "").toString().trim();

    for (let i = 1; i < dataSU.length; i++) {
      if (dataSU[i][0].toString().trim() === cleanQr) {
        const namaAlat = dataSU[i][1];
        const siklusSaatIni = parseInt(dataSU[i][3]) || 0;
        const maxSiklus = parseInt(dataSU[i][4]) || 0;
        const statusAlat = dataSU[i][5] || "Aktif";

        if (siklusSaatIni >= maxSiklus || statusAlat === "Afkir") {
          return {
            status: "AFKIR",
            namaAlat: namaAlat,
            siklusSaatIni: siklusSaatIni,
            maxSiklus: maxSiklus,
            pesan: `❌ ALAT AFKIR! Alat "${namaAlat}" sudah mencapai batas maksimal (${siklusSaatIni}/${maxSiklus}x) dan HARUS DIMUSNAHKAN!`
          };
        }

        return {
          status: "OK",
          namaAlat: namaAlat,
          siklusSaatIni: siklusSaatIni,
          maxSiklus: maxSiklus,
          pesan: `✔ Alat Ditemukan: ${namaAlat} (Siklus saat ini: ${siklusSaatIni} dari max ${maxSiklus}x)`
        };
      }
    }

    return { status: "NOT_FOUND", pesan: `ID QR "${cleanQr}" tidak terdaftar di Master Single-Use!` };

  } catch (error) {
    return { status: "ERROR", pesan: "Gagal cek data: " + error.message };
  }
}

/**
 * 3. FUNGSI PENYIMPANAN & VALIDASI TRANSAKSI UTAMA (PENERIMAAN)
 */
function simpanDataPenerimaanLengkap(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); 

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // Memanggil spesifik sheet dengan nama "Transaksi"
    let sheetTerima = ss.getSheetByName("Transaksi");
    
    // Asumsi: Sheet untuk Master Single Use bernama "Master Single-Use"
    let sheetSU = ss.getSheetByName("Master_SingleUse"); 
    
    // 1. OTOMATIS BUAT SHEET TRANSAKSI JIKA BELUM ADA (DESAIN 14 KOLOM: A s/d N)
    if (!sheetTerima) {
      sheetTerima = ss.insertSheet("Transaksi");
      sheetTerima.appendRow([
        "Waktu Masuk", "ID Transaksi", "Instalasi", "Ruangan Asal", 
        "Kategori Layanan", "ID Produk", "Nama Set / Alat", "Nomor Set", 
        "QR Single-Use", "Petugas Pengantar", "Status", 
        "Mesin Cuci", "Petugas Dekontaminasi", "Waktu Dekontaminasi"
      ]);
      sheetTerima.getRange("A1:N1").setFontWeight("bold").setBackground("#e0f2fe");
      sheetTerima.setFrozenRows(1);
    }

    // 2. OTOMATIS BUAT SHEET MASTER SINGLE-USE JIKA BELUM ADA
    if (!sheetSU) {
      sheetSU = ss.insertSheet("Master Single-Use");
      sheetSU.appendRow([
        "ID QR Single-Use", "Nama Alat", "Tanggal Registrasi", 
        "Siklus Ke-", "Batas Maksimal", "Status"
      ]);
      sheetSU.getRange("A1:F1").setFontWeight("bold").setBackground("#fef08a");
      sheetSU.setFrozenRows(1);
    }

    const today = new Date();
    const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyyMMdd");
    
    let idTransaksiOutput = "";
    let pesanInfoOutput = "";
    let namaAlatLog = payload.namaSet || payload.namaAlat || "-";

    // ----------------------------------------------------
    // LOGIKA KATEGORI 1: Single-Use Ulang (Re-use)
    // ----------------------------------------------------
    if (payload.kategori === "SingleUseUlang") {
      const qrScan = (payload.qrSingleUseScan || "").toString().trim();
      if (!qrScan) return { status: "ERROR", pesan: "Kode QR Single-Use tidak boleh kosong!" };

      const dataSU = sheetSU.getDataRange().getValues();
      let rowIndex = -1;
      
      for (let i = 1; i < dataSU.length; i++) {
        if (dataSU[i][0].toString().trim() === qrScan) { 
          rowIndex = i; 
          break; 
        }
      }

      if (rowIndex === -1) return { status: "ERROR", pesan: `ID Alat "${qrScan}" tidak ditemukan di Master Single-Use!` };

      let siklusSaatIni = parseInt(dataSU[rowIndex][3]) || 0;
      let maxSiklus = parseInt(dataSU[rowIndex][4]) || 0;
      namaAlatLog = dataSU[rowIndex][1];

      if (siklusSaatIni >= maxSiklus) {
        return { 
          status: "ERROR", 
          pesan: `❌ ALAT AFKIR! Alat "${namaAlatLog}" telah mencapai batas maksimal pemrosesan (${siklusSaatIni}/${maxSiklus}x). Harap segera dimusnahkan!` 
        };
      }

      siklusSaatIni += 1;
      sheetSU.getRange(rowIndex + 1, 4).setValue(siklusSaatIni); 
      
      if (siklusSaatIni === maxSiklus) {
         sheetSU.getRange(rowIndex + 1, 6).setValue("Batas Maksimal Tercapai"); 
      }

      idTransaksiOutput = qrScan;
      pesanInfoOutput = `Siklus Lanjutan Berhasil! Pemrosesan ke-${siklusSaatIni} dari maksimal ${maxSiklus}x untuk ${namaAlatLog}.`;

    // ----------------------------------------------------
    // LOGIKA KATEGORI 2: Single-Use Registrasi Baru
    // ----------------------------------------------------
    } else if (payload.kategori === "SingleUseBaru") {
      let totalBarisTerima = sheetTerima.getLastRow();
      idTransaksiOutput = "TRX-" + dateStr + "-" + String(totalBarisTerima).padStart(3, '0');
      let maxSiklus = 5;

      let prefix = payload.idProduk || "SU";
      if (prefix === "SU-CAU") maxSiklus = 2;
      else if (prefix === "SU-ETT") maxSiklus = 5;
      else if (prefix === "SU-GUE") maxSiklus = 5;
      else if (prefix === "SU-BIO") maxSiklus = 5;
      else if (prefix === "SU-LMA") maxSiklus = 3;
      else maxSiklus = parseInt(payload.maxSiklusInput) || 5; 
      
      // Simpan ke Master Single-Use menggunakan ID format TRX yang seragam
      sheetSU.appendRow([idTransaksiOutput, namaAlatLog, today, 1, maxSiklus, "Aktif"]);
      pesanInfoOutput = `Alat Single-Use Baru Berhasil Terdaftar! ID: ${idTransaksiOutput} (Siklus 1/${maxSiklus}x).`;

    // ----------------------------------------------------
    // LOGIKA KATEGORI 3: Set Instrumen / Pernapasan / Lainnya
    // ----------------------------------------------------
    } else {
      let totalBarisTerima = sheetTerima.getLastRow();
      idTransaksiOutput = "TRX-" + dateStr + "-" + String(totalBarisTerima).padStart(3, '0');
      pesanInfoOutput = `Data penerimaan alat ${namaAlatLog} berhasil disimpan.`;
    }

    // ----------------------------------------------------
    // CATAT KE SHEET TRANSAKSI (PRESISI KOLOM A s/d K)
    // ----------------------------------------------------
    sheetTerima.appendRow([
      today,                                                                // Kolom A (0) : Waktu Masuk
      idTransaksiOutput,                                                    // Kolom B (1) : ID Transaksi
      payload.instalasi || "-",                                             // Kolom C (2) : Instalasi
      payload.ruangan || payload.ruanganAsal || payload.asalRuangan || "-", // Kolom D (3) : Ruangan Asal
      payload.kategori || "-",                                              // Kolom E (4) : Kategori Layanan
      payload.idProduk || "-",                                              // Kolom F (5) : ID Produk
      namaAlatLog,                                                          // Kolom G (6) : Nama Set / Alat
      payload.nomorSet || "-",                                              // Kolom H (7) : Nomor Set
      payload.qrSingleUseScan || idTransaksiOutput,                         // Kolom I (8) : QR Single-Use
      payload.pengantar || payload.petugasTerima || payload.petugas || "-", // Kolom J (9) : Petugas Pengantar
      "1. Penerimaan Kotor"                                                 // Kolom K (10): Status Saat Ini (KUNCI UTAMA)
    ]);

    return { 
      status: "SUCCESS", 
      idTransaksi: idTransaksiOutput, 
      namaSet: namaAlatLog,
      nomorSet: payload.nomorSet || "-",
      komposisi: payload.komposisi || "",
      pesanInfo: pesanInfoOutput 
    };

  } catch (error) {
    return { status: "ERROR", pesan: "Gagal menyimpan data: " + error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 4. FUNGSI ADMIN UTILITY
 */
function updateBatasMaksimalSingleUse(qrCode, batasBaru) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetSU = ss.getSheetByName(SHT_MASTER_SU);
    if (!sheetSU) return { status: "ERROR", pesan: "Sheet Master Single-Use tidak ditemukan" };

    const data = sheetSU.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString().trim() === qrCode.toString().trim()) {
        sheetSU.getRange(i + 1, 5).setValue(batasBaru);
        return { status: "SUCCESS", pesan: `Batas maksimal ${qrCode} diperbarui menjadi ${batasBaru}x` };
      }
    }
    return { status: "NOT_FOUND", pesan: "ID QR tidak ditemukan" };
  } catch (err) {
    return { status: "ERROR", pesan: err.message };
  }
}

/**
 * ====================================================================
 * MODUL DEKONTAMINASI
 * ====================================================================
 */

/**
 * 5. MENGAMBIL ANTREAN DEKONTAMINASI
 */
function getAntreanDekontaminasi() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Transaksi"); 
    
    if (!sheet) return [];

    var data = sheet.getDataRange().getValues();
    var antrean = [];

    // Loop mulai dari indeks 1 (Baris ke-2)
    for (var i = 1; i < data.length; i++) {
      var status = data[i][10]; // KOLOM K (Indeks 10): Status Saat Ini

      if (status === "1. Penerimaan Kotor") {
        
        // -- PERBAIKAN FORMAT WAKTU DI SINI --
        var rawWaktu = data[i][0];
        var waktuFormatted = "-";
        
        if (rawWaktu) {
          if (rawWaktu instanceof Date) {
            // Ubah ke format standar ISO agar new Date() di Frontend (HTML) tidak error/NaN
            waktuFormatted = Utilities.formatDate(rawWaktu, ss.getSpreadsheetTimeZone(), "dd-MM-yyyy HH:mm:ss");
          } else {
            waktuFormatted = rawWaktu.toString();
          }
        }

        var idTrx = data[i][1] || "-";
        var inst = data[i][2] || "-";
        var ruang = data[i][3] || "-";
        var kat = data[i][4] || "-";
        var idProd = data[i][5] || "-";
        var nmAlat = data[i][6] || "-";
        var noSet = data[i][7] || "-";
        var qr = data[i][8] || "-";
        var pet = data[i][9] || "-";

        antrean.push({
          baris: i + 1,
          
          // Tanggal / Waktu
          waktu: waktuFormatted,
          waktuMasuk: waktuFormatted,
          tanggalTerima: waktuFormatted,
          
          // Transaksi & Ruangan
          idTransaksi: idTrx,
          instalasi: inst,
          ruangan: ruang,
          asalRuangan: ruang,
          ruanganAsal: ruang,
          
          // Detail Alat
          kategori: kat,
          idProduk: idProd,
          namaSet: nmAlat,
          namaAlat: nmAlat,
          namaSetAlat: nmAlat,
          nomorSet: noSet,
          qrSingleUse: qr,
          
          // Petugas
          petugas: pet,
          petugasPengantar: pet
        });
      }
    }

    return antrean;

  } catch (error) {
    Logger.log("Error getAntreanDekontaminasi: " + error.toString());
    return [];
  }
}

/**
 * 6. EKSEKUSI PROSES DEKONTAMINASI
 */
/**
 * 6. EKSEKUSI PROSES DEKONTAMINASI
 */
function prosesDekontaminasi(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { status: "ERROR", pesan: "Sistem sedang sibuk. Silakan coba beberapa saat lagi." };
  }

  try {
    if (!payload || !payload.items || payload.items.length === 0) {
      throw new Error("Tidak ada item alat yang dipilih untuk diproses.");
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Transaksi");
    if (!sheet) throw new Error("Sheet 'Transaksi' tidak ditemukan!");

    var dataAll = sheet.getDataRange().getValues();
    var updatedCount = 0;
    var waktuSekarang = new Date();

    payload.items.forEach(function(item) {
      var baris = item.baris;

      // Pencarian alternatif berdasarkan ID Transaksi jika nomor baris tidak valid
      if (!baris || isNaN(baris) || baris <= 1) {
        for (var r = 1; r < dataAll.length; r++) {
          if (dataAll[r][1] && dataAll[r][1].toString().trim() === item.idTransaksi.toString().trim()) {
            baris = r + 1;
            break;
          }
        }
      }

      if (baris && baris > 1) {
        // 1. Update Status di Kolom K (Indeks 11) menjadi "2. Dekontaminasi"
        sheet.getRange(baris, 11).setValue("2. Dekontaminasi");
        
        // 2. Simpan Mesin Cuci ke Kolom L (Indeks 12)
        sheet.getRange(baris, 12).setValue(payload.mesin || "-");
        
        // 3. Simpan Petugas Dekontaminasi ke Kolom M (Indeks 13)
        sheet.getRange(baris, 13).setValue(payload.petugas || "-");
        
        // 4. Simpan Waktu Dekontaminasi ke Kolom N (Indeks 14)
        sheet.getRange(baris, 14).setValue(waktuSekarang);

        updatedCount++;
      }
    });

    SpreadsheetApp.flush();

    return {
      status: "SUCCESS",
      pesan: "Pencucian " + updatedCount + " set alat dengan (" + payload.mesin + ")."
    };

  } catch (err) {
    return {
      status: "ERROR",
      pesan: "Gagal menyimpan ke database: " + err.message
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 7. MENGAMBIL DAFTAR KATALOG ALAT/SET DARI DB_INSTRUMEN
 */
function getKatalogAlat() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHT_DB_INSTRUMEN);
    
    if (!sheet) {
      return { status: "ERROR", pesan: "Sheet 'DB_Instrumen' tidak ditemukan di Spreadsheet!" };
    }

    const data = sheet.getDataRange().getValues();
    const katalog = [];

    for (let i = 1; i < data.length; i++) {
      const idProduk  = (data[i][0] || "").toString().trim(); 
      const namaAlat  = (data[i][1] || "").toString().trim(); 
      const komposisi = (data[i][2] || "").toString().trim(); 
      const kategori  = (data[i][3] || "").toString().trim(); 

      if (namaAlat !== "") {
        katalog.push({
          idProduk: idProduk,
          namaAlat: namaAlat,
          komposisi: komposisi,
          kategori: kategori
        });
      }
    }

    return { status: "SUCCESS", data: katalog };

  } catch (error) {
    return { status: "ERROR", pesan: "Gagal mengambil data katalog: " + error.toString() };
  }
}

// ===================================================
// 1. MEMBACA ANTREAN SETTING & PACKING (Status: 2. Dekontaminasi)
// ===================================================
function getAntreanSettingPacking() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Transaksi");
    if (!sheet) return [];

    var data = sheet.getDataRange().getValues();
    var antrean = [];

    for (var i = 1; i < data.length; i++) {
      var statusAlat = (data[i][10] || "").toString().trim(); 

      if (statusAlat === "2. Dekontaminasi" || statusAlat === "3. Setting Packing") {
        antrean.push({
          baris: i + 1,
          idTransaksi: (data[i][1] || "").toString().trim(), // Kolom B
          ruangan: (data[i][3] || "").toString().trim(),     // Kolom C
          kategori: (data[i][4] || "").toString().trim(),     // Kolom E (Kategori)
          namaSet: (data[i][6] || "").toString().trim(),
          nomorSet: (data[i][7] || "").toString().trim(),
          statusAlat: (data[i][10] || "").toString().trim(),   // Kolom K
          petugasDekon: (data[i][12] || "-"),                 // Kolom M: Petugas Dekontaminasi
          petugasPacking: (data[i][15] || "-")                // Kolom P: Petugas Packing
        });
      }
    }
    
    return antrean;
  } catch (err) {
    Logger.log("Error getAntreanSettingPacking: " + err);
    return [];
  }
}

function prosesInputBarangBersih(payload) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Transaksi");
    if (!sheet) throw new Error("Sheet 'Transaksi' tidak ditemukan!");

    // 1. Pastikan payload berbentuk Array (bisa menangani 1 item maupun banyak item)
    var listPayload = Array.isArray(payload) ? payload : [payload];
    if (listPayload.length === 0) throw new Error("Data payload kosong!");

    var waktuSekarang = new Date();

    // 2. BUAT PREFIX ID TRANSAKSI (Contoh: TRX-20261007-)
    var dateStr = Utilities.formatDate(waktuSekarang, "GMT+8", "yyyyMMdd");
    var prefix = "TRX-" + dateStr + "-";
    var maxUrut = 0;

    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      // Ambil data ID dari Kolom B (Kolom ke-2)
      var idValues = sheet.getRange(2, 2, lastRow - 1, 1).getValues();

      // Cari nomor urut terbesar di hari ini
      for (var i = 0; i < idValues.length; i++) {
        var id = idValues[i][0];
        if (id && typeof id === 'string' && id.indexOf(prefix) === 0) {
          var urutStr = id.substring(prefix.length);
          var urutInt = parseInt(urutStr, 10);
          if (!isNaN(urutInt) && urutInt > maxUrut) {
            maxUrut = urutInt;
          }
        }
      }
    }

    // 3. LOOPING BARIS DATA & NOMOR ID BERURUTAN
    var rowsToAppend = [];
    var firstIdTrx = "";
    var lastIdTrx = "";

    for (var k = 0; k < listPayload.length; k++) {
      var item = listPayload[k];
      var urut = maxUrut + k + 1;
      
      // Format 3 digit (contoh: 001, 002, dst)
      var urutPadded = urut < 1000 ? ("000" + urut).slice(-3) : urut.toString();
      var idTrx = prefix + urutPadded;

      // Simpan ID pertama dan terakhir untuk dimunculkan di pop-up alert
      if (k === 0) firstIdTrx = idTrx;
      lastIdTrx = idTrx;

      var barisBaru = [];
      barisBaru[0] = waktuSekarang;         
      barisBaru[1] = idTrx;
      barisBaru[2] = item.instalasi;                 
      barisBaru[3] = item.ruangan;
      barisBaru[4] = item.kategori;
      barisBaru[5] = item.idProduk || "";       
      barisBaru[6] = item.namaSet;       
      barisBaru[7] = item.nomorSet || "";      
      
      // Kolom I sampai J (Penerimaan Kotor & Deko) dibiarkan kosong
      barisBaru[8] = "";
      barisBaru[9] = "";
      
      // Kolom K (Indeks ke-10): Status langsung Setting Packing
      barisBaru[10] = "3. Setting Packing"; 

      rowsToAppend.push(barisBaru);
    }

    // 4. SIMPAN SEMUA BARIS SEKALIGUS (BATCH INSERT)
    // Jauh lebih cepat dan mencegah aplikasi freeze
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);

    // 5. SIAPKAN PESAN SUKSES
    var pesanRespon = listPayload.length === 1
      ? "Barang bersih berhasil diinput dengan ID: " + firstIdTrx
      : listPayload.length + " barang bersih berhasil diinput (ID: " + firstIdTrx + " s/d " + lastIdTrx + ")";

    return {
      status: "SUCCESS",
      pesan: pesanRespon
    };

  } catch (err) {
    Logger.log("Error prosesInputBarangBersih: " + err.message);
    return {
      status: "ERROR",
      pesan: err.message
    };
  }
}
function simpanVerifikasiPacking(payload) {
  const lock = LockService.getScriptLock();
  
  if (!lock.tryLock(10000)) {
    return { success: false, message: "Sistem sedang memproses transaksi lain. Silakan coba beberapa saat lagi." };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Transaksi"); 
    
    if (!sheet) {
      return { success: false, message: "Sheet Transaksi tidak ditemukan." };
    }
    
    const data = sheet.getDataRange().getValues();
    let targetRow = -1;
    const idCari = String(payload.idTransaksi).trim();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === idCari) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow === -1) {
      return { success: false, message: "ID Transaksi " + idCari + " tidak ditemukan." };
    }

    var waktuSekarang = new Date();

    // 1. Ubah status di Kolom K (Indeks 11) menjadi "3. Selesai Packing"
    sheet.getRange(targetRow, 11).setValue("3. Selesai Packing"); 
    
    // 2. Simpan Waktu Setting Packing ke Kolom R (Indeks 18) & Format Tanggal Jam
    var cellWaktuPacking = sheet.getRange(targetRow, 18);
    cellWaktuPacking.setValue(waktuSekarang);
    cellWaktuPacking.setNumberFormat("dd/mm/yyyy hh:mm:ss");

    // 3. Simpan Petugas Setting Packing ke Kolom P (Indeks 16)
    sheet.getRange(targetRow, 16).setValue(payload.petugasPacking || "-");

    // 4. Simpan Catatan Setting Packing ke Kolom Q (Indeks 17)
    sheet.getRange(targetRow, 17).setValue(payload.catatan || "-");

    SpreadsheetApp.flush();

    return { 
      success: true, 
      message: "Data berhasil disimpan!" 
    };

  } catch (error) {
    return { success: false, message: "Terjadi kesalahan sistem: " + error.toString() };
  } finally {
    lock.releaseLock(); 
  }
}
function getAntreanSterilisasi() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Transaksi");
    if (!sheet) return [];

    var data = sheet.getDataRange().getValues();
    var antrean = [];

    // Looping dari baris ke-2 (mengabaikan header)
    for (var i = 1; i < data.length; i++) {
      var statusAlat = (data[i][10] || "").toString().trim(); // Kolom K (Indeks ke-10)

      // 👉 HANYA TAMPILKAN ALAT YANG SUDAH DIVERIFIKASI (STATUS: "3. Selesai Packing")
      if (statusAlat === "3. Selesai Packing") {
        antrean.push({
          baris: i + 1,
          idTransaksi: (data[i][1] || "").toString().trim(), // Kolom B
          instalasi: (data[i][2] || "").toString().trim(),   // Kolom C
          ruangan: (data[i][3] || "").toString().trim(),     // Kolom D
          kategori: (data[i][4] || "").toString().trim(),    // Kolom E
          namaSet: (data[i][6] || "").toString().trim(),     // Kolom G
          nomorSet: (data[i][7] || "").toString().trim(),    // Kolom H
          statusAlat: statusAlat
        });
      }
    }
    return antrean;
  } catch (err) {
    Logger.log("Error getAntreanSterilisasi: " + err.message);
    return [];
  }
}
/**
 * 8. EKSEKUSI PROSES STERILISASI
 * Mencatat hasil sterilisasi ke kolom R s/d U di sheet Transaksi
 */
function prosesSterilisasi(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { status: "ERROR", pesan: "Sistem sedang sibuk. Silakan coba beberapa saat lagi." };
  }

  try {
    if (!payload || !payload.items || payload.items.length === 0) {
      throw new Error("Tidak ada alat yang dipilih untuk diproses sterilisasi.");
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Transaksi");
    if (!sheet) throw new Error("Sheet 'Transaksi' tidak ditemukan!");

    var dataAll = sheet.getDataRange().getValues();
    var updatedCount = 0;
    var waktuSekarang = new Date();

    payload.items.forEach(function(item) {
      var baris = item.baris;

      // Cari baris berdasarkan ID Transaksi jika nomor baris tidak valid
      if (!baris || isNaN(baris) || baris <= 1) {
        for (var r = 1; r < dataAll.length; r++) {
          if (dataAll[r][1] && dataAll[r][1].toString().trim() === item.idTransaksi.toString().trim()) {
            baris = r + 1;
            break;
          }
        }
      }

      if (baris && baris > 1) {
        // 1. Update Status di Kolom K (11) menjadi "4. Sterilisasi"
        sheet.getRange(baris, 11).setValue("4. Sterilisasi");
        
        // 2. Simpan Mesin Sterilisasi ke Kolom S (19)
        sheet.getRange(baris, 19).setValue(payload.mesinSteril || "-");
        
        // 3. Simpan Siklus Ke ke Kolom T (20)
        sheet.getRange(baris, 20).setValue(payload.noSiklus || "-");
        
        // 4. Simpan Program ke Kolom U (21)
        sheet.getRange(baris, 21).setValue(payload.programSteril || "-");
        
        // 5. Simpan Petugas Sterilisasi ke Kolom V (22)
        sheet.getRange(baris, 22).setValue(payload.petugasSteril || "-");
        
        // 6. Simpan Waktu Sterilisasi ke Kolom W (23) & Format Tanggal Jam
        var cellWaktuSteril = sheet.getRange(baris, 23);
        cellWaktuSteril.setValue(waktuSekarang);
        cellWaktuSteril.setNumberFormat("dd/mm/yyyy hh:mm:ss");

        updatedCount++;
      }
    });

    SpreadsheetApp.flush();

    return {
      status: "SUCCESS",
      pesan: updatedCount + " set alat berhasil dimasukkan ke proses Sterilisasi (" + payload.mesinSteril + " - Siklus " + payload.noSiklus + ")."
    };

  } catch (err) {
    return {
      status: "ERROR",
      pesan: "Gagal menyimpan data sterilisasi: " + err.message
    };
  } finally {
    lock.releaseLock();
  }
}
/**
 * Mengembalikan status alat dari Setting & Packing ke Dekontaminasi (Reject)
 * dan mencatat riwayat reject ke Kolom O (15)
 */
function rejectKeDekontaminasi(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: "Sistem sedang sibuk. Silakan coba beberapa saat lagi." };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Transaksi"); 
    if (!sheet) return { success: false, message: "Sheet Transaksi tidak ditemukan." };
    
    const data = sheet.getDataRange().getValues();
    let targetRow = -1;
    const idCari = String(payload.idTransaksi).trim();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === idCari) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow === -1) {
      return { success: false, message: "ID Transaksi " + idCari + " tidak ditemukan." };
    }

    // 1. Ubah Status di Kolom K (11) kembali menjadi "1. Penerimaan Kotor"
    sheet.getRange(targetRow, 11).setValue("1. Penerimaan Kotor");
    
    // 2. Ambil riwayat reject yang sudah ada sebelumnya di Kolom O (15) jika ada
    let cellRiwayat = sheet.getRange(targetRow, 15);
    let riwayatLama = cellRiwayat.getValue() ? cellRiwayat.getValue().toString().trim() : "";
    
    // Format waktu reject saat ini
    let waktuReject = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy HH:mm:ss");
    let catatanBaru = `[${waktuReject}] REJECT: ${payload.catatan || "Tanpa catatan"}`;

    // Gabungkan riwayat lama dengan yang baru (agar tidak saling menimpa jika direject berkali-kali)
    let riwayatGabungan = riwayatLama ? riwayatLama + " | " + catatanBaru : catatanBaru;

    // 3. Simpan riwayat reject ke Kolom O (15)
    cellRiwayat.setValue(riwayatGabungan);

    SpreadsheetApp.flush();

    return { 
      success: true, 
      message: "Alat dikembalikan ke antrean dekontaminasi." 
    };

  } catch (error) {
    return { success: false, message: "Terjadi kesalahan sistem: " + error.toString() };
  } finally {
    lock.releaseLock(); 
  }
}
/**
 * 9. MENGAMBIL ANTREAN UNTUK MENU 5: UJI VISUAL & SIMPAN
 * Menarik data yang berstatus "4. Sterilisasi"
 */
function getAntreanUjiVisual() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Transaksi");
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var status = row[10] ? row[10].toString().trim() : ""; // Kolom K

    if (status === "4. Sterilisasi") {
      result.push({
        baris: i + 1,
        timestamp: row[0] ? Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), "dd-MM-yyyy HH:mm:ss") : "",
        idTransaksi: row[1] || "",
        instalasi: row[2] || "",
        ruanganAsal: row[3] || "",
        kategori: row[4] || "",
        idProduk: row[5] || "",
        namaAlat: row[6] || "",
        nomorSet: row[7] || "",
        qrSingleUse: row[8] || "",
        pengantar: row[9] || "",
        status: status,
        mesinSteril: row[18] || "-",     // Kolom S (19)
        siklusKe: row[19] || "-",        // Kolom T (20)
        program: row[20] || "-",         // Kolom U (21)
        petugasSteril: row[21] || "-"    // Kolom V (22)
      });
    }
  }
  return result;
}

/**
 * 10. EKSEKUSI KEPUTUSAN UJI VISUAL & PENYIMPANAN / REJECT KE PACKING
 * Menggunakan Kolom X (Petugas Uji), Kolom Y (Waktu Penyimpanan), & Kolom Z (Riwayat Reject Uji Visual)
 */
function prosesUjiVisual(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: "Sistem sedang sibuk. Silakan coba beberapa saat lagi." };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Transaksi");
    if (!sheet) return { success: false, message: "Sheet Transaksi tidak ditemukan." };

    const data = sheet.getDataRange().getValues();
    let targetRow = -1;
    const idCari = String(payload.idTransaksi).trim();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === idCari) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow === -1) {
      return { success: false, message: "ID Transaksi " + idCari + " tidak ditemukan." };
    }

    var waktuSekarang = new Date();

    // 1. Simpan Nama Petugas Uji Visual ke Kolom X (Indeks 24)
    sheet.getRange(targetRow, 24).setValue(payload.petugasUji || "-");

    if (payload.lolosUji === true) {
      // KONDISI 1: LOLOS UJI -> Status: "5. Penyimpanan"
      sheet.getRange(targetRow, 11).setValue("5. Penyimpanan");
      
      // Simpan Waktu Penyimpanan ke Kolom Y (Indeks 25) & Format Tanggal Jam
      var cellWaktuSimpan = sheet.getRange(targetRow, 25);
      cellWaktuSimpan.setValue(waktuSekarang);
      cellWaktuSimpan.setNumberFormat("dd-MM-yyyy hh:mm:ss");

      SpreadsheetApp.flush();
      return {
        success: true,
        message: "Alat lolos uji visual dan disimpan!"
      };

    } else {
      // KONDISI 2: TIDAK LOLOS -> Reject kembali ke "3. Setting Packing"
      sheet.getRange(targetRow, 11).setValue("3. Setting Packing");

      // Catat alasan reject khusus Uji Visual ke KOLOM Z (Indeks 26) -- TANPA MENIMPA KOLOM O
      let cellRiwayatUV = sheet.getRange(targetRow, 26);
      let riwayatLama = cellRiwayatUV.getValue() ? cellRiwayatUV.getValue().toString().trim() : "";
      let waktuReject = Utilities.formatDate(waktuSekarang, Session.getScriptTimeZone(), "dd-MM-yyyy HH:mm:ss");
      let catatanReject = `[${waktuReject}] REJECT UJI VISUAL oleh ${payload.petugasUji}: ${payload.alasanReject}`;

      let riwayatGabungan = riwayatLama ? riwayatLama + " | " + catatanReject : catatanReject;
      cellRiwayatUV.setValue(riwayatGabungan);

      SpreadsheetApp.flush();
      return {
        success: true,
        message: "Alat ditolak pada uji visual! Dikembalikan ke antrean Setting & Packing untuk dikemas ulang."
      };
    }

  } catch (error) {
    return { success: false, message: "Terjadi kesalahan sistem: " + error.toString() };
  } finally {
    lock.releaseLock();
  }
}
/**
 * 11. ADJUST STOCK (PENYESUAIAN / STOK AWAL GUDANG)
 * Memasukkan data inventaris steril langsung berstatus "5. Penyimpanan"
 */
function prosesAdjustStock(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { status: "ERROR", pesan: "Sistem sedang sibuk. Silakan coba beberapa saat lagi." };
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Transaksi");
    if (!sheet) throw new Error("Sheet 'Transaksi' tidak ditemukan!");

    var listPayload = Array.isArray(payload) ? payload : [payload];
    if (listPayload.length === 0) throw new Error("Data payload kosong!");

    var waktuSekarang = new Date();
    var dateStr = Utilities.formatDate(waktuSekarang, Session.getScriptTimeZone(), "yyyyMMdd");
    var prefix = "ADJ-" + dateStr + "-";
    
    var lastRow = sheet.getLastRow();
    var maxUrut = 0;
    if (lastRow >= 2) {
      var idValues = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
      for (var i = 0; i < idValues.length; i++) {
        var id = idValues[i][0];
        if (id && typeof id === 'string' && id.indexOf(prefix) === 0) {
          var urutStr = id.substring(prefix.length);
          var urutInt = parseInt(urutStr, 10);
          if (!isNaN(urutInt) && urutInt > maxUrut) maxUrut = urutInt;
        }
      }
    }

    var rowsToAppend = [];
    listPayload.forEach(function(item, index) {
      var urut = maxUrut + index + 1;
      var idTrx = prefix + ("000" + urut).slice(-3);

      // Ambil tanggal sterilisasi dari form Adjust Stock, default ke waktu sekarang jika kosong
      var waktuSterilVal = waktuSekarang;
      if (item.tglSteril) {
        var parsedDate = new Date(item.tglSteril);
        if (!isNaN(parsedDate.getTime())) {
          waktuSterilVal = parsedDate;
        }
      }

      var barisBaru = [];
      barisBaru[0] = waktuSekarang;                     // Kolom A: Waktu Masuk
      barisBaru[1] = idTrx;                             // Kolom B: ID Transaksi
      barisBaru[2] = item.instalasi;                    // Kolom C: Instalasi
      barisBaru[3] = item.ruangan;                      // Kolom D: Ruangan
      barisBaru[4] = item.kategori;                     // Kolom E: Kategori
      barisBaru[5] = item.idProduk || "-";              // Kolom F: ID Produk
      barisBaru[6] = item.namaSet;                      // Kolom G: Nama Set / Alat
      barisBaru[7] = item.nomorSet || "-";              // Kolom H: Nomor Set
      barisBaru[8] = idTrx;                             // Kolom I: QR
      barisBaru[9] = "System / Stock Opname";           // Kolom J: Pengantar
      barisBaru[10] = "5. Penyimpanan";                 // Kolom K: Status
      
      // Kosongkan Kolom L s/d V
      for (let c = 11; c < 23; c++) { barisBaru[c] = "-"; }
      
      // Kolom W (23): Waktu Sterilisasi
      barisBaru[22] = waktuSterilVal;

      // Kolom X (24): Petugas Uji Visual
      barisBaru[23] = "-";

      // Kolom Y (25): Waktu Penyimpanan
      barisBaru[24] = waktuSekarang;

      rowsToAppend.push(barisBaru);
    });

    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);

    let startRow = sheet.getLastRow() - rowsToAppend.length + 1;
    sheet.getRange(startRow, 23, rowsToAppend.length, 1).setNumberFormat("dd-MM-yyyy hh:mm:ss");
    sheet.getRange(startRow, 25, rowsToAppend.length, 1).setNumberFormat("dd-MM-yyyy hh:mm:ss");

    SpreadsheetApp.flush();

    return {
      status: "SUCCESS",
      pesan: listPayload.length + " item stok awal berhasil ditambahkan ke gudang penyimpanan."
    };

  } catch (err) {
    return { status: "ERROR", pesan: "Gagal adjust stock: " + err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 12. MENGAMBIL ANTREAN PENYIMPANAN (UNTUK DISTRIBUSI)
 * Menarik data yang berstatus "5. Penyimpanan"
 */
function getAntreanPenyimpanan() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Transaksi");
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var status = row[10] ? row[10].toString().trim() : ""; // Kolom K

    if (status === "5. Penyimpanan") {
      var kategori = (row[4] || "").toString().trim().toLowerCase();
      var tglSterilRaw = row[22]; // Kolom W (Waktu Sterilisasi)
      var tglSterilStr = "-";
      var tglKedaluwarsaStr = "-";

      if (tglSterilRaw) {
        var dSteril = new Date(tglSterilRaw);
        if (!isNaN(dSteril.getTime())) {
          tglSterilStr = Utilities.formatDate(dSteril, ss.getSpreadsheetTimeZone(), "dd-MM-yyyy");
          
          // Hitung Tanggal Kedaluwarsa berdasarkan kategori
          var dExp = new Date(dSteril.getTime());
          if (kategori.includes("linen") || kategori.includes("bmhp")) {
            dExp.setMonth(dExp.getMonth() + 1); // 1 Bulan untuk Linen & BMHP
          } else {
            dExp.setMonth(dExp.getMonth() + 3); // 3 Bulan untuk Instrumen, Pernafasan, Implan, dll
          }
          tglKedaluwarsaStr = Utilities.formatDate(dExp, ss.getSpreadsheetTimeZone(), "dd-MM-yyyy");
        }
      }

      result.push({
        baris: i + 1,
        timestamp: row[0] ? Utilities.formatDate(new Date(row[0]), ss.getSpreadsheetTimeZone(), "dd-MM-yyyy HH:mm:ss") : "",
        idTransaksi: row[1] || "",
        instalasi: row[2] || "",
        ruanganAsal: row[3] || "",
        kategori: row[4] || "",
        namaAlat: row[6] || "",
        nomorSet: row[7] || "",
        status: status,
        waktuMasukSimpan: row[24] ? Utilities.formatDate(new Date(row[24]), ss.getSpreadsheetTimeZone(), "dd-MM-yyyy HH:mm:ss") : "-",
        tglSterilisasi: tglSterilStr,
        tglKedaluwarsa: tglKedaluwarsaStr
      });
    }
  }
  return result;
}

/**
 * 13. EKSEKUSI DISTRIBUSI BARANG STERIL
 * Mengubah status ke "6. Didistribusikan" dan mencatat tujuan serta petugas
 */
function prosesDistribusi(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: "Sistem sedang sibuk. Silakan coba beberapa saat lagi." };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Transaksi");
    if (!sheet) return { success: false, message: "Sheet Transaksi tidak ditemukan." };

    if (!payload || !payload.items || payload.items.length === 0) {
      throw new Error("Tidak ada item yang dipilih untuk didistribusikan.");
    }

    var dataAll = sheet.getDataRange().getValues();
    var updatedCount = 0;
    var waktuSekarang = new Date();

    // 1. Proses update status item di sheet Transaksi
    payload.items.forEach(function(item) {
      var baris = item.baris;

      if (!baris || isNaN(baris) || baris <= 1) {
        for (var r = 1; r < dataAll.length; r++) {
          if (dataAll[r][1] && dataAll[r][1].toString().trim() === item.idTransaksi.toString().trim()) {
            baris = r + 1;
            break;
          }
        }
      }

      if (baris && baris > 1) {
        sheet.getRange(baris, 11).setValue("6. Didistribusikan");
        sheet.getRange(baris, 27).setValue(payload.ruanganTujuan || "-");
        sheet.getRange(baris, 28).setValue(payload.petugasDistribusi || "-");
        
        var cellWaktuDistribusi = sheet.getRange(baris, 29);
        cellWaktuDistribusi.setValue(waktuSekarang);
        cellWaktuDistribusi.setNumberFormat("dd-MM-yyyy hh:mm:ss");

        updatedCount++;
      }
    });

    // 2. 👉 Update status di sheet Permintaan menjadi "Terlayani" jika ada ID Request yang disertakan
    if (payload.idReq) {
      var sheetReq = ss.getSheetByName("Permintaan");
      if (sheetReq) {
        var dataReq = sheetReq.getDataRange().getValues();
        for (var i = 1; i < dataReq.length; i++) {
          var currentIdReq = (dataReq[i][1] || "").toString().trim();
          if (currentIdReq === payload.idReq.toString().trim()) {
            sheetReq.getRange(i + 1, 9).setValue("Terlayani"); // Kolom I: Status
          }
        }
      }
    }

    SpreadsheetApp.flush();

    return {
      success: true,
      message: updatedCount + " set/alat berhasil didistribusikan ke " + payload.ruanganTujuan + "."
    };

  } catch (error) {
    return { success: false, message: "Terjadi kesalahan sistem: " + error.toString() };
  } finally {
    lock.releaseLock();
  }
}
function lacakTransaksi(idTransaksi) {
  try {
    if (!idTransaksi) return { status: "ERROR", pesan: "ID Transaksi tidak boleh kosong!" };
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Transaksi");
    if (!sheet) return { status: "ERROR", pesan: "Sheet 'Transaksi' tidak ditemukan!" };

    var data = sheet.getDataRange().getValues();
    var query = idTransaksi.toString().trim().toLowerCase();
    
    var targetRow = null;

    for (var i = 1; i < data.length; i++) {
      var idTrx = (data[i][1] || "").toString().trim().toLowerCase(); // Kolom B (ID Transaksi)
      var qrVal = (data[i][8] || "").toString().trim().toLowerCase(); // Kolom I (QR Single-Use jika ada)

      if (idTrx === query || qrVal === query) {
        targetRow = data[i];
        break;
      }
    }

    if (!targetRow) {
      return { status: "NOT_FOUND", pesan: "ID Transaksi atau QR Code tidak ditemukan!" };
    }

    // Format tanggal & waktu diubah menjadi dd-MM-yyyy HH:mm
    function fmtDate(val) {
      if (!val || val === "-") return "-";
      var d = new Date(val);
      return !isNaN(d.getTime()) ? Utilities.formatDate(d, ss.getSpreadsheetTimeZone(), "dd-MM-yyyy HH:mm") : val;
    }

    // Hitung tanggal kedaluwarsa berdasarkan waktu sterilisasi (Kolom W / index 22)
    var tglSterilRaw = targetRow[22]; 
    var tglExpStr = "-";
    if (tglSterilRaw && tglSterilRaw !== "-") {
      var dSteril = new Date(tglSterilRaw);
      if (!isNaN(dSteril.getTime())) {
        var dExp = new Date(dSteril.getTime());
        var kategori = (targetRow[4] || "").toString().trim().toLowerCase(); // Kolom E (Kategori)
        if (kategori.includes("linen") || kategori.includes("bmhp")) {
          dExp.setMonth(dExp.getMonth() + 1);
        } else {
          dExp.setMonth(dExp.getMonth() + 3);
        }
        // Format tanggal kedaluwarsa menjadi dd-MM-yyyy
        tglExpStr = Utilities.formatDate(dExp, ss.getSpreadsheetTimeZone(), "dd-MM-yyyy");
      }
    }

    // Susun data detail tracking
    var detail = {
      idTransaksi: targetRow[1] || "-",
      instalasi: targetRow[2] || "-",
      ruangan: targetRow[3] || "-",
      kategori: targetRow[4] || "-",
      namaAlat: targetRow[6] || "-",
      nomorSet: targetRow[7] || "-",
      statusSaatIni: targetRow[10] || "Tidak Diketahui",
      tglKedaluwarsa: tglExpStr,
      
      // 1. Penerimaan Kotor (Kolom A -> index 0)
      waktuPenerimaan: fmtDate(targetRow[0]),

      // 2. Dekontaminasi (Kolom L, M, N -> index 11, 12, 13)
      mesinDekon: targetRow[11] || "-",
      petugasDekon: targetRow[12] || "-",
      waktuDekon: fmtDate(targetRow[13]),

      // 3. Setting & Packing (Kolom P, R -> index 15, 17)
      petugasPacking: targetRow[15] || "-",
      waktuPacking: fmtDate(targetRow[17]),

      // 4. Sterilisasi (Kolom S, T, V, W -> index 18, 19, 21, 22)
      mesinSteril: targetRow[18] || "-",
      siklusSteril: targetRow[19] || "-",
      petugasSteril: targetRow[21] || "-",
      waktuSteril: fmtDate(targetRow[22]),

      // 5. Uji Visual & Penyimpanan (Kolom X, Y -> index 23, 24)
      petugasUjiVisual: targetRow[23] || "-",
      waktuPenyimpanan: fmtDate(targetRow[24]),

      // 6. Distribusi (Kolom AA, AB, AC -> index 26, 27, 28)
      unitTujuan: targetRow[26] || "-",
      petugasDistribusi: targetRow[27] || "-",
      waktuDistribusi: fmtDate(targetRow[28])
    };

    return { status: "SUCCESS", data: detail };

  } catch (err) {
    return { status: "ERROR", pesan: "Gagal melacak: " + err.message };
  }
}
/**
 * VERIFIKASI LOGIN STAF CSSD
 */
function verifikasiLogin(nip, pin) {
  try {
    if (!nip || !pin) {
      return { status: "ERROR", pesan: "NIP/NIK dan PIN tidak boleh kosong!" };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("DB_User");
    if (!sheet) {
      return { status: "ERROR", pesan: "Sheet 'DB_User' tidak ditemukan di Spreadsheet!" };
    }

    var data = sheet.getDataRange().getValues();
    var inputNip = nip.toString().trim();
    var inputPin = pin.toString().trim();

    for (var i = 1; i < data.length; i++) {
      var dbNip = (data[i][0] || "").toString().trim(); // Kolom A: NIP/NIK
      var dbPin = (data[i][2] || "").toString().trim(); // Kolom C: PIN

      if (dbNip === inputNip && dbPin === inputPin) {
        return {
          status: "SUCCESS",
          user: {
            nip: dbNip,
            nama: data[i][1] || "Staf CSSD",          // Kolom B: Nama_Staf
            role: (data[i][3] || "operator").toString().trim().toLowerCase(), // Kolom D: Role
            penempatan: (data[i][4] || "All Area").toString().trim()          // Kolom E: Penempatan
          }
        };
      }
    }

    return { status: "ERROR", pesan: "NIP/NIK atau PIN salah! Silakan periksa kembali." };

  } catch (err) {
    return { status: "ERROR", pesan: "Terjadi kesalahan server: " + err.message };
  }
}
/**
 * ====================================================================
 * MODUL PERMINTAAN / REQUEST (MENU UTAMA UNIT PELAYANAN)
 * ====================================================================
 */

const SHT_PERMINTAAN = "Permintaan";

/**
 * Merekam Permintaan / Request Baru dari Unit Pelayanan
 */
function simpanPermintaanSteril(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { status: "ERROR", pesan: "Sistem sedang sibuk. Silakan coba beberapa saat lagi." };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheetReq = ss.getSheetByName(SHT_PERMINTAAN);

    // 1. Buat Sheet Permintaan jika belum ada (Kolom A s/d J: 10 Kolom)
    if (!sheetReq) {
      sheetReq = ss.insertSheet(SHT_PERMINTAAN);
      sheetReq.appendRow([
        "Time Stamp", "ID Permintaan", "Instalasi", "Ruangan Asal", 
        "Kategori Layanan", "ID Produk", "Nama Alat / Set", "Jumlah", "Status", "Nama Petugas"
      ]);
      sheetReq.getRange("A1:J1").setFontWeight("bold").setBackground("#dbeafe");
      sheetReq.setFrozenRows(1);
    }

    const waktuSekarang = new Date();
    const dateStr = Utilities.formatDate(waktuSekarang, ss.getSpreadsheetTimeZone(), "yyyyMMdd");
    const prefix = "REQ-" + dateStr + "-";

    // 2. Hitung Nomor Urut REQ pada hari ini
    let maxUrut = 0;
    const lastRow = sheetReq.getLastRow();
    if (lastRow >= 2) {
      const idValues = sheetReq.getRange(2, 2, lastRow - 1, 1).getValues();
      for (let i = 0; i < idValues.length; i++) {
        let id = idValues[i][0];
        if (id && typeof id === 'string' && id.indexOf(prefix) === 0) {
          let urutStr = id.substring(prefix.length);
          let urutInt = parseInt(urutStr, 10);
          if (!isNaN(urutInt) && urutInt > maxUrut) {
            maxUrut = urutInt;
          }
        }
      }
    }

    const urutPadded = String(maxUrut + 1).padStart(3, '0');
    const idReq = prefix + urutPadded;

    // 3. Simpan data ke Sheet Permintaan (10 Kolom)
    sheetReq.appendRow([
      waktuSekarang,               // Kolom A: Time Stamp
      idReq,                       // Kolom B: ID Permintaan
      payload.instalasi || "-",    // Kolom C: Instalasi
      payload.ruangan || "-",      // Kolom D: Ruangan Asal
      payload.kategori || "-",     // Kolom E: Kategori Layanan
      payload.idProduk || "-",     // Kolom F: ID Produk
      payload.namaSet || "-",      // Kolom G: Nama Alat / Set
      payload.jumlah || 1,         // Kolom H: Jumlah
      "Pending",                   // Kolom I: Status (Default: Pending)
      payload.namaPetugas || "-"   // Kolom J: Nama Petugas
    ]);

    // Format kolom Waktu
    sheetReq.getRange(sheetReq.getLastRow(), 1).setNumberFormat("dd/mm/yyyy hh:mm:ss");

    SpreadsheetApp.flush();

    return {
      status: "SUCCESS",
      idReq: idReq,
      pesan: `Permintaan berhasil dikirim dengan ID: ${idReq}`
    };

  } catch (err) {
    return { status: "ERROR", pesan: "Gagal menyimpan permintaan: " + err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Mengambil Daftar Permintaan yang Pernah Dibuat (Menu 7)
 */
function getDaftarPermintaan() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHT_PERMINTAAN);
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    const result = [];

    for (let i = data.length - 1; i >= 1; i--) { // Urutkan dari yang terbaru
      let row = data[i];
      if (row[1]) {
        let rawWaktu = row[0];
        let waktuFormatted = "-";
        if (rawWaktu instanceof Date) {
          waktuFormatted = Utilities.formatDate(rawWaktu, ss.getSpreadsheetTimeZone(), "dd-MM-yyyy HH:mm");
        } else if (rawWaktu) {
          waktuFormatted = rawWaktu.toString();
        }

        result.push({
          waktu: waktuFormatted,
          idReq: row[1] || "-",
          instalasi: row[2] || "-",
          ruangan: row[3] || "-",
          kategori: row[4] || "-",
          idProduk: row[5] || "-",
          namaSet: row[6] || "-",
          jumlah: row[7] || 1,
          status: row[8] || "Pending",
          petugas: row[9] || "-"
        });
      }
    }
    return result;
  } catch (err) {
    Logger.log("Error getDaftarPermintaan: " + err.message);
    return [];
  }
}

/**
 * Menyimpan Permintaan Batch (Banyak Item Sekaligus)
 */
function simpanBatchPermintaanSteril(listPayload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { status: "ERROR", pesan: "Sistem sedang sibuk. Silakan coba beberapa saat lagi." };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheetReq = ss.getSheetByName(SHT_PERMINTAAN);

    if (!sheetReq) {
      sheetReq = ss.insertSheet(SHT_PERMINTAAN);
      sheetReq.appendRow([
        "Time Stamp", "ID Permintaan", "Instalasi", "Ruangan Asal", 
        "Kategori Layanan", "ID Produk", "Nama Alat / Set", "Jumlah", "Status", "Nama Petugas"
      ]);
      sheetReq.getRange("A1:J1").setFontWeight("bold").setBackground("#dbeafe");
      sheetReq.setFrozenRows(1);
    }

    if (!listPayload || listPayload.length === 0) {
      throw new Error("Data permintaan kosong.");
    }

    const waktuSekarang = new Date();
    const dateStr = Utilities.formatDate(waktuSekarang, ss.getSpreadsheetTimeZone(), "yyyyMMdd");
    const prefix = "REQ-" + dateStr + "-";

    // Hitung Nomor Urut REQ pada hari ini
    let maxUrut = 0;
    const lastRow = sheetReq.getLastRow();
    if (lastRow >= 2) {
      const idValues = sheetReq.getRange(2, 2, lastRow - 1, 1).getValues();
      for (let i = 0; i < idValues.length; i++) {
        let id = idValues[i][0];
        if (id && typeof id === 'string' && id.indexOf(prefix) === 0) {
          let urutStr = id.substring(prefix.length);
          let urutInt = parseInt(urutStr, 10);
          if (!isNaN(urutInt) && urutInt > maxUrut) {
            maxUrut = urutInt;
          }
        }
      }
    }

    const urutPadded = String(maxUrut + 1).padStart(3, '0');
    const idReq = prefix + urutPadded;

    // Siapkan baris data batch (10 Kolom)
    let rowsToAppend = [];
    listPayload.forEach(item => {
      rowsToAppend.push([
        waktuSekarang,
        idReq,
        item.instalasi || "-",
        item.ruangan || "-",
        item.kategori || "-",
        item.idProduk || "-",
        item.namaSet || "-",
        item.jumlah || 1,
        "Pending",
        item.petugas || "-"
      ]);
    });

    if (rowsToAppend.length > 0) {
      sheetReq.getRange(sheetReq.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
      sheetReq.getRange(sheetReq.getLastRow() - rowsToAppend.length + 1, 1, rowsToAppend.length, 1).setNumberFormat("dd/mm/yyyy hh:mm:ss");
    }

    SpreadsheetApp.flush();

    return {
      status: "SUCCESS",
      idReq: idReq,
      pesan: `Berhasil mengirim ${listPayload.length} item permintaan dengan 1 ID: ${idReq}`
    };

  } catch (err) {
    return { status: "ERROR", pesan: "Gagal menyimpan permintaan: " + err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Mengambil Daftar Permintaan Pending untuk Notifikasi di Menu 6
 */
function getPermintaanPending() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Permintaan"); 
    if (!sheet) return [];

    var data = sheet.getDataRange().getValues();
    var listPending = [];

    for (var i = 1; i < data.length; i++) {
      var status = (data[i][8] || "").toString().trim(); // Kolom I (Indeks 8): Status

      if (status === "" || status === "Pending") {
        // 👉 FORMAT ULANG WAKTU AGAR RAPI (dd-MM-yyyy HH:mm)
        var rawWaktu = data[i][0];
        var waktuFormatted = "-";
        
        if (rawWaktu) {
          if (rawWaktu instanceof Date && !isNaN(rawWaktu.getTime())) {
            waktuFormatted = Utilities.formatDate(rawWaktu, ss.getSpreadsheetTimeZone(), "dd-MM-yyyy HH:mm");
          } else {
            waktuFormatted = rawWaktu.toString();
          }
        }

        listPending.push({
          baris: i + 1,
          waktu: waktuFormatted,                            // Waktu yang sudah diformat
          idReq: (data[i][1] || "").toString().trim(),      // Kolom B (Indeks 1)
          instalasi: (data[i][2] || "").toString().trim(),  // Kolom C (Indeks 2)
          ruangan: (data[i][3] || "").toString().trim(),    // Kolom D (Indeks 3)
          kategori: (data[i][4] || "").toString().trim(),   // Kolom E (Indeks 4)
          idProduk: (data[i][5] || "").toString().trim(),   // Kolom F (Indeks 5)
          namaSet: (data[i][6] || "").toString().trim(),    // Kolom G (Indeks 6)
          jumlah: (data[i][7] || "").toString().trim(),     // Kolom H (Indeks 7)
          status: status || "Pending",                      // Kolom I (Indeks 8)
          petugas: (data[i][9] || "").toString().trim()     // Kolom J (Indeks 9)
        });
      }
    }
    return listPending;
  } catch (err) {
    Logger.log("Error getPermintaanPending: " + err);
    return [];
  }
}
/**
 * Mengubah status permintaan di sheet Permintaan menjadi "Terlayani"
 */
function updateStatusPermintaanTerlayani(idReq) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { status: "ERROR", pesan: "Sistem sedang sibuk. Silakan coba beberapa saat lagi." };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Permintaan");
    if (!sheet) return { status: "ERROR", pesan: "Sheet 'Permintaan' tidak ditemukan." };

    const data = sheet.getDataRange().getValues();
    let updatedCount = 0;

    // Looping untuk mencari semua baris yang memiliki idReq yang sama (karena batch request bisa lebih dari 1 item)
    for (let i = 1; i < data.length; i++) {
      let currentIdReq = (data[i][1] || "").toString().trim(); // Kolom B (Indeks 1): ID Permintaan
      if (currentIdReq === idReq.toString().trim()) {
        // Ubah status di Kolom I (Indeks 8) menjadi "Terlayani"
        sheet.getRange(i + 1, 9).setValue("Terlayani");
        updatedCount++;
      }
    }

    SpreadsheetApp.flush();

    if (updatedCount > 0) {
      return { status: "SUCCESS", pesan: "Status permintaan berhasil diperbarui menjadi Terlayani." };
    } else {
      return { status: "NOT_FOUND", pesan: "ID Permintaan tidak ditemukan di sheet." };
    }

  } catch (err) {
    return { status: "ERROR", pesan: "Gagal memperbarui status: " + err.message };
  } finally {
    lock.releaseLock();
  }
}