/**
 * ====================================================================
 * SIMASTER CSSD - FRONTEND & SUPABASE ENGINE (app.js)
 * Sistem Informasi Manajemen Sterilisasi Rumah Sakit
 * ====================================================================
 */

// --------------------------------------------------------------------
// 1. Masukkan URL dan Anon Key Anda
const SUPABASE_URL = 'https://lvbtsfryyokielmiylar.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_uXM0Tg2l94nRY5X9hN_wDw_h5f2liZZ';

// 2. Gunakan nama variabel 'supabaseClient' (atau nama lain) alih-alih 'supabase'
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Utility: Format Tanggal ke String (dd-MM-yyyy HH:mm)
 */
function formatDateCustom(dateVal, includeTime = true) {
  if (!dateVal || dateVal === "-") return "-";
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return dateVal;

  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());

  if (includeTime) {
    return `${day}-${month}-${year} ${hours}:${mins}`;
  }
  return `${day}-${month}-${year}`;
}

/**
 * Utility: Generate Dynamic Prefix ID (Contoh: TRX-20261104-001 / REQ-20261104-001)
 */
async function generateIdCustom(tableName, idColumn, prefixType) {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
  const prefix = `${prefixType}-${dateStr}-`;

  const { data, error } = await supabase
    .from(tableName)
    .select(idColumn)
    .like(idColumn, `${prefix}%`);

  let maxUrut = 0;
  if (data && data.length > 0) {
    data.forEach(row => {
      const idStr = row[idColumn];
      if (idStr && idStr.startsWith(prefix)) {
        const urutStr = idStr.substring(prefix.length);
        const urutInt = parseInt(urutStr, 10);
        if (!isNaN(urutInt) && urutInt > maxUrut) {
          maxUrut = urutInt;
        }
      }
    });
  }

  const nextUrut = String(maxUrut + 1).padStart(3, '0');
  return prefix + nextUrut;
}

// --------------------------------------------------------------------
// 2. AUTHENTICATION & LOGIN
// --------------------------------------------------------------------
async function verifikasiLogin(nip, pin) {
  try {
    if (!nip || !pin) {
      return { status: "ERROR", pesan: "NIP/NIK dan PIN tidak boleh kosong!" };
    }

    const { data, error } = await supabase
      .from('db_user')
      .select('*')
      .eq('nip', nip.toString().trim())
      .eq('pin', pin.toString().trim())
      .single();

    if (error || !data) {
      return { status: "ERROR", pesan: "NIP/NIK atau PIN salah! Silakan periksa kembali." };
    }

    return {
      status: "SUCCESS",
      user: {
        nip: data.nip,
        nama: data.nama || "Staf CSSD",
        role: (data.role || "operator").toString().trim().toLowerCase(),
        penempatan: (data.penempatan || "All Area").toString().trim()
      }
    };
  } catch (err) {
    return { status: "ERROR", pesan: "Terjadi kesalahan server: " + err.message };
  }
}

// --------------------------------------------------------------------
// 3. MASTER KATALOG & SINGLE-USE PRE-CHECK
// --------------------------------------------------------------------
async function getKatalogAlat() {
  try {
    const { data, error } = await supabase
      .from('db_instrumen')
      .select('*');

    if (error) throw error;

    const katalog = data.map(item => ({
      idProduk: item.id_produk || "",
      namaAlat: item.nama_alat || "",
      komposisi: item.komposisi || "",
      kategori: item.kategori || ""
    }));

    return { status: "SUCCESS", data: katalog };
  } catch (error) {
    return { status: "ERROR", pesan: "Gagal mengambil data katalog: " + error.message };
  }
}

async function cekKuotaSingleUse(qrScan) {
  try {
    const cleanQr = (qrScan || "").toString().trim();
    if (!cleanQr) return { status: "NOT_FOUND", pesan: "ID QR tidak boleh kosong!" };

    const { data, error } = await supabase
      .from('master_single_use')
      .select('*')
      .eq('id_qr', cleanQr)
      .single();

    if (error || !data) {
      return { status: "NOT_FOUND", pesan: `ID QR "${cleanQr}" tidak terdaftar di Master Single-Use!` };
    }

    const namaAlat = data.nama_alat || "-";
    const siklusSaatIni = parseInt(data.siklus_ke) || 0;
    const maxSiklus = parseInt(data.batas_maksimal) || 0;
    const statusAlat = data.status || "Aktif";

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
  } catch (error) {
    return { status: "ERROR", pesan: "Gagal cek data: " + error.message };
  }
}

async function updateBatasMaksimalSingleUse(qrCode, batasBaru) {
  try {
    const { error } = await supabase
      .from('master_single_use')
      .update({ batas_maksimal: batasBaru })
      .eq('id_qr', qrCode.toString().trim());

    if (error) throw error;
    return { status: "SUCCESS", pesan: `Batas maksimal ${qrCode} diperbarui menjadi ${batasBaru}x` };
  } catch (err) {
    return { status: "ERROR", pesan: err.message };
  }
}

// --------------------------------------------------------------------
// 4. MODUL PENERIMAN (MENU 1)
// --------------------------------------------------------------------
async function simpanDataPenerimaanLengkap(payload) {
  try {
    let idTransaksiOutput = "";
    let pesanInfoOutput = "";
    let namaAlatLog = payload.namaSet || payload.namaAlat || "-";
    const todayISO = new Date().toISOString();

    if (payload.kategori === "SingleUseUlang") {
      const qrScan = (payload.qrSingleUseScan || "").toString().trim();
      if (!qrScan) return { status: "ERROR", pesan: "Kode QR Single-Use tidak boleh kosong!" };

      const { data: suData, error: suErr } = await supabase
        .from('master_single_use')
        .select('*')
        .eq('id_qr', qrScan)
        .single();

      if (suErr || !suData) return { status: "ERROR", pesan: `ID Alat "${qrScan}" tidak ditemukan di Master Single-Use!` };

      let siklusSaatIni = parseInt(suData.siklus_ke) || 0;
      let maxSiklus = parseInt(suData.batas_maksimal) || 0;
      namaAlatLog = suData.nama_alat;

      if (siklusSaatIni >= maxSiklus) {
        return {
          status: "ERROR",
          pesan: `❌ ALAT AFKIR! Alat "${namaAlatLog}" telah mencapai batas maksimal pemrosesan (${siklusSaatIni}/${maxSiklus}x).`
        };
      }

      siklusSaatIni += 1;
      let statusSU = "Aktif";
      if (siklusSaatIni >= maxSiklus) statusSU = "Batas Maksimal Tercapai";

      await supabase
        .from('master_single_use')
        .update({ siklus_ke: siklusSaatIni, status: statusSU })
        .eq('id_qr', qrScan);

      idTransaksiOutput = qrScan;
      pesanInfoOutput = `Siklus Lanjutan Berhasil! Pemrosesan ke-${siklusSaatIni} dari maksimal ${maxSiklus}x untuk ${namaAlatLog}.`;

    } else if (payload.kategori === "SingleUseBaru") {
      idTransaksiOutput = await generateIdCustom('transaksi', 'id_transaksi', 'TRX');
      let maxSiklus = 5;

      let prefix = payload.idProduk || "SU";
      if (prefix === "SU-CAU") maxSiklus = 2;
      else if (prefix === "SU-ETT") maxSiklus = 5;
      else if (prefix === "SU-GUE") maxSiklus = 5;
      else if (prefix === "SU-BIO") maxSiklus = 5;
      else if (prefix === "SU-LMA") maxSiklus = 3;
      else maxSiklus = parseInt(payload.maxSiklusInput) || 5;

      await supabase
        .from('master_single_use')
        .insert([{
          id_qr: idTransaksiOutput,
          nama_alat: namaAlatLog,
          tanggal_registrasi: todayISO,
          siklus_ke: 1,
          batas_maksimal: maxSiklus,
          status: "Aktif"
        }]);

      pesanInfoOutput = `Alat Single-Use Baru Berhasil Terdaftar! ID: ${idTransaksiOutput} (Siklus 1/${maxSiklus}x).`;

    } else {
      idTransaksiOutput = await generateIdCustom('transaksi', 'id_transaksi', 'TRX');
      pesanInfoOutput = `Data penerimaan alat ${namaAlatLog} berhasil disimpan.`;
    }

    const { error: trxErr } = await supabase
      .from('transaksi')
      .insert([{
        waktu_masuk: todayISO,
        id_transaksi: idTransaksiOutput,
        instalasi: payload.instalasi || "-",
        ruangan_asal: payload.ruangan || payload.ruanganAsal || payload.asalRuangan || "-",
        kategori: payload.kategori || "-",
        id_produk: payload.idProduk || "-",
        nama_set: namaAlatLog,
        nomor_set: payload.nomorSet || "-",
        qr_single_use: payload.qrSingleUseScan || idTransaksiOutput,
        petugas_pengantar: payload.pengantar || payload.petugasTerima || payload.petugas || "-",
        status_alat: "1. Penerimaan Kotor"
      }]);

    if (trxErr) throw trxErr;

    return {
      status: "SUCCESS",
      idTransaksi: idTransaksiOutput,
      namaSet: namaAlatLog,
      nomorSet: payload.nomorSet || "-",
      komposisi: payload.komposisi || "",
      pesanInfo: pesanInfoOutput
    };

  } catch (error) {
    return { status: "ERROR", pesan: "Gagal menyimpan data: " + error.message };
  }
}

// --------------------------------------------------------------------
// 5. MODUL DEKONTAMINASI (MENU 2)
// --------------------------------------------------------------------
async function getAntreanDekontaminasi() {
  try {
    const { data, error } = await supabase
      .from('transaksi')
      .select('*')
      .eq('status_alat', '1. Penerimaan Kotor')
      .order('waktu_masuk', { ascending: true });

    if (error) throw error;

    return data.map((row, i) => {
      const waktuFormatted = formatDateCustom(row.waktu_masuk);
      return {
        baris: i + 1,
        waktu: waktuFormatted,
        waktuMasuk: waktuFormatted,
        tanggalTerima: waktuFormatted,
        idTransaksi: row.id_transaksi || "-",
        instalasi: row.instalasi || "-",
        ruangan: row.ruangan_asal || "-",
        asalRuangan: row.ruangan_asal || "-",
        ruanganAsal: row.ruangan_asal || "-",
        kategori: row.kategori || "-",
        idProduk: row.id_produk || "-",
        namaSet: row.nama_set || "-",
        namaAlat: row.nama_set || "-",
        namaSetAlat: row.nama_set || "-",
        nomorSet: row.nomor_set || "-",
        qrSingleUse: row.qr_single_use || "-",
        petugas: row.petugas_pengantar || "-",
        petugasPengantar: row.petugas_pengantar || "-"
      };
    });
  } catch (error) {
    console.error("Error getAntreanDekontaminasi:", error);
    return [];
  }
}

async function prosesDekontaminasi(payload) {
  try {
    if (!payload || !payload.items || payload.items.length === 0) {
      throw new Error("Tidak ada item alat yang dipilih untuk diproses.");
    }

    let updatedCount = 0;
    const waktuSekarang = new Date().toISOString();

    for (const item of payload.items) {
      const { error } = await supabase
        .from('transaksi')
        .update({
          status_alat: '2. Dekontaminasi',
          mesin_cuci: payload.mesin || '-',
          petugas_dekon: payload.petugas || '-',
          waktu_dekon: waktuSekarang
        })
        .eq('id_transaksi', item.idTransaksi);

      if (!error) updatedCount++;
    }

    return {
      status: "SUCCESS",
      pesan: `Pencucian ${updatedCount} set alat dengan (${payload.mesin}) berhasil dicatat.`
    };
  } catch (err) {
    return { status: "ERROR", pesan: "Gagal menyimpan ke database: " + err.message };
  }
}

// --------------------------------------------------------------------
// 6. MODUL SETTING & PACKING (MENU 3)
// --------------------------------------------------------------------
async function getAntreanSettingPacking() {
  try {
    const { data, error } = await supabase
      .from('transaksi')
      .select('*')
      .in('status_alat', ['2. Dekontaminasi', '3. Setting Packing'])
      .order('waktu_masuk', { ascending: true });

    if (error) throw error;

    return data.map((row, i) => ({
      baris: i + 1,
      idTransaksi: row.id_transaksi || "-",
      ruangan: row.ruangan_asal || "-",
      kategori: row.kategori || "-",
      namaSet: row.nama_set || "-",
      nomorSet: row.nomor_set || "-",
      statusAlat: row.status_alat || "-",
      petugasDekon: row.petugas_dekon || "-",
      petugasPacking: row.petugas_packing || "-"
    }));
  } catch (err) {
    console.error("Error getAntreanSettingPacking:", err);
    return [];
  }
}

async function prosesInputBarangBersih(payload) {
  try {
    const listPayload = Array.isArray(payload) ? payload : [payload];
    if (listPayload.length === 0) throw new Error("Data payload kosong!");

    const waktuSekarang = new Date().toISOString();
    let firstIdTrx = "";
    let lastIdTrx = "";

    for (let k = 0; k < listPayload.length; k++) {
      const item = listPayload[k];
      const idTrx = await generateIdCustom('transaksi', 'id_transaksi', 'TRX');
      if (k === 0) firstIdTrx = idTrx;
      lastIdTrx = idTrx;

      await supabase
        .from('transaksi')
        .insert([{
          waktu_masuk: waktuSekarang,
          id_transaksi: idTrx,
          instalasi: item.instalasi || "-",
          ruangan_asal: item.ruangan || "-",
          kategori: item.kategori || "-",
          id_produk: item.idProduk || "-",
          nama_set: item.namaSet || "-",
          nomor_set: item.nomorSet || "-",
          status_alat: "3. Setting Packing"
        }]);
    }

    const pesanRespon = listPayload.length === 1
      ? `Barang bersih berhasil diinput dengan ID: ${firstIdTrx}`
      : `${listPayload.length} barang bersih berhasil diinput (ID: ${firstIdTrx} s/d ${lastIdTrx})`;

    return { status: "SUCCESS", pesan: pesanRespon };
  } catch (err) {
    return { status: "ERROR", pesan: err.message };
  }
}

async function simpanVerifikasiPacking(payload) {
  try {
    const idCari = String(payload.idTransaksi).trim();
    const waktuSekarang = new Date().toISOString();

    const { error } = await supabase
      .from('transaksi')
      .update({
        status_alat: '3. Selesai Packing',
        waktu_packing: waktuSekarang,
        petugas_packing: payload.petugasPacking || "-",
        catatan_packing: payload.catatan || "-"
      })
      .eq('id_transaksi', idCari);

    if (error) throw error;
    return { success: true, message: "Data berhasil disimpan!" };
  } catch (error) {
    return { success: false, message: "Terjadi kesalahan sistem: " + error.message };
  }
}

async function rejectKeDekontaminasi(payload) {
  try {
    const idCari = String(payload.idTransaksi).trim();
    const waktuSekarangStr = formatDateCustom(new Date().toISOString());

    const { data: trxData } = await supabase
      .from('transaksi')
      .select('riwayat_reject')
      .eq('id_transaksi', idCari)
      .single();

    const riwayatLama = trxData ? (trxData.riwayat_reject || "") : "";
    const catatanBaru = `[${waktuSekarangStr}] REJECT: ${payload.catatan || "Tanpa catatan"}`;
    const riwayatGabungan = riwayatLama ? `${riwayatLama} | ${catatanBaru}` : catatanBaru;

    const { error } = await supabase
      .from('transaksi')
      .update({
        status_alat: '1. Penerimaan Kotor',
        riwayat_reject: riwayatGabungan
      })
      .eq('id_transaksi', idCari);

    if (error) throw error;
    return { success: true, message: "Alat dikembalikan ke antrean dekontaminasi." };
  } catch (error) {
    return { success: false, message: "Terjadi kesalahan sistem: " + error.message };
  }
}

// --------------------------------------------------------------------
// 7. MODUL STERILISASI (MENU 4)
// --------------------------------------------------------------------
async function getAntreanSterilisasi() {
  try {
    const { data, error } = await supabase
      .from('transaksi')
      .select('*')
      .eq('status_alat', '3. Selesai Packing')
      .order('waktu_masuk', { ascending: true });

    if (error) throw error;

    return data.map((row, i) => ({
      baris: i + 1,
      idTransaksi: row.id_transaksi || "-",
      instalasi: row.instalasi || "-",
      ruangan: row.ruangan_asal || "-",
      kategori: row.kategori || "-",
      namaSet: row.nama_set || "-",
      nomorSet: row.nomor_set || "-",
      statusAlat: row.status_alat || "-"
    }));
  } catch (err) {
    console.error("Error getAntreanSterilisasi:", err);
    return [];
  }
}

async function prosesSterilisasi(payload) {
  try {
    if (!payload || !payload.items || payload.items.length === 0) {
      throw new Error("Tidak ada alat yang dipilih untuk diproses sterilisasi.");
    }

    let updatedCount = 0;
    const waktuSekarang = new Date().toISOString();

    for (const item of payload.items) {
      const { error } = await supabase
        .from('transaksi')
        .update({
          status_alat: '4. Sterilisasi',
          mesin_steril: payload.mesinSteril || "-",
          siklus_steril: payload.noSiklus || "-",
          program_steril: payload.programSteril || "-",
          petugas_steril: payload.petugasSteril || "-",
          waktu_steril: waktuSekarang
        })
        .eq('id_transaksi', item.idTransaksi);

      if (!error) updatedCount++;
    }

    return {
      status: "SUCCESS",
      pesan: `${updatedCount} set alat berhasil dimasukkan ke proses Sterilisasi (${payload.mesinSteril} - Siklus ${payload.noSiklus}).`
    };
  } catch (err) {
    return { status: "ERROR", pesan: "Gagal menyimpan data sterilisasi: " + err.message };
  }
}

// --------------------------------------------------------------------
// 8. MODUL UJI VISUAL & PENYIMPANAN (MENU 5)
// --------------------------------------------------------------------
async function getAntreanUjiVisual() {
  try {
    const { data, error } = await supabase
      .from('transaksi')
      .select('*')
      .eq('status_alat', '4. Sterilisasi')
      .order('waktu_masuk', { ascending: true });

    if (error) throw error;

    return data.map((row, i) => ({
      baris: i + 1,
      timestamp: formatDateCustom(row.waktu_masuk),
      idTransaksi: row.id_transaksi || "",
      instalasi: row.instalasi || "",
      ruanganAsal: row.ruangan_asal || "",
      kategori: row.kategori || "",
      idProduk: row.id_produk || "",
      namaAlat: row.nama_set || "",
      nomorSet: row.nomor_set || "",
      qrSingleUse: row.qr_single_use || "",
      pengantar: row.petugas_pengantar || "",
      status: row.status_alat || "",
      mesinSteril: row.mesin_steril || "-",
      siklusKe: row.siklus_steril || "-",
      program: row.program_steril || "-",
      petugasSteril: row.petugas_steril || "-"
    }));
  } catch (err) {
    console.error("Error getAntreanUjiVisual:", err);
    return [];
  }
}

async function prosesUjiVisual(payload) {
  try {
    const idCari = String(payload.idTransaksi).trim();
    const waktuSekarang = new Date().toISOString();

    if (payload.lolosUji === true) {
      const { error } = await supabase
        .from('transaksi')
        .update({
          status_alat: '5. Penyimpanan',
          petugas_uji: payload.petugasUji || "-",
          waktu_simpan: waktuSekarang
        })
        .eq('id_transaksi', idCari);

      if (error) throw error;
      return { success: true, message: "Alat lolos uji visual dan disimpan!" };
    } else {
      const { data: trxData } = await supabase
        .from('transaksi')
        .select('riwayat_reject_uv')
        .eq('id_transaksi', idCari)
        .single();

      const riwayatLama = trxData ? (trxData.riwayat_reject_uv || "") : "";
      const waktuRejectStr = formatDateCustom(waktuSekarang);
      const catatanReject = `[${waktuRejectStr}] REJECT UJI VISUAL oleh ${payload.petugasUji}: ${payload.alasanReject}`;
      const riwayatGabungan = riwayatLama ? `${riwayatLama} | ${catatanReject}` : catatanReject;

      const { error } = await supabase
        .from('transaksi')
        .update({
          status_alat: '3. Setting Packing',
          petugas_uji: payload.petugasUji || "-",
          riwayat_reject_uv: riwayatGabungan
        })
        .eq('id_transaksi', idCari);

      if (error) throw error;
      return {
        success: true,
        message: "Alat ditolak pada uji visual! Dikembalikan ke antrean Setting & Packing untuk dikemas ulang."
      };
    }
  } catch (error) {
    return { success: false, message: "Terjadi kesalahan sistem: " + error.message };
  }
}

async function prosesAdjustStock(payload) {
  try {
    const listPayload = Array.isArray(payload) ? payload : [payload];
    if (listPayload.length === 0) throw new Error("Data payload kosong!");

    const waktuSekarang = new Date().toISOString();

    for (let i = 0; i < listPayload.length; i++) {
      const item = listPayload[i];
      const idTrx = await generateIdCustom('transaksi', 'id_transaksi', 'ADJ');

      let waktuSterilVal = waktuSekarang;
      if (item.tglSteril) {
        const parsedDate = new Date(item.tglSteril);
        if (!isNaN(parsedDate.getTime())) waktuSterilVal = parsedDate.toISOString();
      }

      await supabase
        .from('transaksi')
        .insert([{
          waktu_masuk: waktuSekarang,
          id_transaksi: idTrx,
          instalasi: item.instalasi || "-",
          ruangan_asal: item.ruangan || "-",
          kategori: item.kategori || "-",
          id_produk: item.idProduk || "-",
          nama_set: item.namaSet || "-",
          nomor_set: item.nomorSet || "-",
          qr_single_use: idTrx,
          petugas_pengantar: "System / Stock Opname",
          status_alat: "5. Penyimpanan",
          waktu_steril: waktuSterilVal,
          waktu_simpan: waktuSekarang
        }]);
    }

    return {
      status: "SUCCESS",
      pesan: `${listPayload.length} item stok awal berhasil ditambahkan ke gudang penyimpanan.`
    };
  } catch (err) {
    return { status: "ERROR", pesan: "Gagal adjust stock: " + err.message };
  }
}

// --------------------------------------------------------------------
// 9. MODUL DISTRIBUSI (MENU 6)
// --------------------------------------------------------------------
async function getAntreanPenyimpanan() {
  try {
    const { data, error } = await supabase
      .from('transaksi')
      .select('*')
      .eq('status_alat', '5. Penyimpanan')
      .order('waktu_masuk', { ascending: true });

    if (error) throw error;

    return data.map((row, i) => {
      const kategori = (row.kategori || "").toLowerCase();
      let tglSterilStr = "-";
      let tglKedaluwarsaStr = "-";

      if (row.waktu_steril) {
        const dSteril = new Date(row.waktu_steril);
        if (!isNaN(dSteril.getTime())) {
          tglSterilStr = formatDateCustom(dSteril, false);
          const dExp = new Date(dSteril.getTime());
          if (kategori.includes("linen") || kategori.includes("bmhp")) {
            dExp.setMonth(dExp.getMonth() + 1);
          } else {
            dExp.setMonth(dExp.getMonth() + 3);
          }
          tglKedaluwarsaStr = formatDateCustom(dExp, false);
        }
      }

      return {
        baris: i + 1,
        timestamp: formatDateCustom(row.waktu_masuk),
        idTransaksi: row.id_transaksi || "",
        instalasi: row.instalasi || "",
        ruanganAsal: row.ruangan_asal || "",
        kategori: row.kategori || "",
        namaAlat: row.nama_set || "",
        nomorSet: row.nomor_set || "",
        status: row.status_alat || "",
        waktuMasukSimpan: formatDateCustom(row.waktu_simpan),
        tglSterilisasi: tglSterilStr,
        tglKedaluwarsa: tglKedaluwarsaStr
      };
    });
  } catch (err) {
    console.error("Error getAntreanPenyimpanan:", err);
    return [];
  }
}

async function prosesDistribusi(payload) {
  try {
    if (!payload || !payload.items || payload.items.length === 0) {
      throw new Error("Tidak ada item yang dipilih untuk didistribusikan.");
    }

    let updatedCount = 0;
    const waktuSekarang = new Date().toISOString();

    for (const item of payload.items) {
      const { error } = await supabase
        .from('transaksi')
        .update({
          status_alat: '6. Didistribusikan',
          ruangan_tujuan: payload.ruanganTujuan || "-",
          petugas_distribusi: payload.petugasDistribusi || "-",
          waktu_distribusi: waktuSekarang
        })
        .eq('id_transaksi', item.idTransaksi);

      if (!error) updatedCount++;
    }

    if (payload.idReq) {
      await supabase
        .from('permintaan')
        .update({ status: 'Terlayani' })
        .eq('id_permintaan', payload.idReq.toString().trim());
    }

    return {
      success: true,
      message: `${updatedCount} set/alat berhasil didistribusikan ke ${payload.ruanganTujuan}.`
    };
  } catch (error) {
    return { success: false, message: "Terjadi kesalahan sistem: " + error.message };
  }
}

// --------------------------------------------------------------------
// 10. MODUL PERMINTAAN / REQUEST (MENU 7)
// --------------------------------------------------------------------
async function simpanPermintaanSteril(payload) {
  try {
    const waktuSekarang = new Date().toISOString();
    const idReq = await generateIdCustom('permintaan', 'id_permintaan', 'REQ');

    const { error } = await supabase
      .from('permintaan')
      .insert([{
        timestamp: waktuSekarang,
        id_permintaan: idReq,
        instalasi: payload.instalasi || "-",
        ruangan: payload.ruangan || "-",
        kategori: payload.kategori || "-",
        id_produk: payload.idProduk || "-",
        nama_set: payload.namaSet || "-",
        jumlah: payload.jumlah || 1,
        status: "Pending",
        petugas: payload.namaPetugas || "-"
      }]);

    if (error) throw error;

    return {
      status: "SUCCESS",
      idReq: idReq,
      pesan: `Permintaan berhasil dikirim dengan ID: ${idReq}`
    };
  } catch (err) {
    return { status: "ERROR", pesan: "Gagal menyimpan permintaan: " + err.message };
  }
}

async function simpanBatchPermintaanSteril(listPayload) {
  try {
    if (!listPayload || listPayload.length === 0) throw new Error("Data permintaan kosong.");

    const waktuSekarang = new Date().toISOString();
    const idReq = await generateIdCustom('permintaan', 'id_permintaan', 'REQ');

    const rowsToInsert = listPayload.map(item => ({
      timestamp: waktuSekarang,
      id_permintaan: idReq,
      instalasi: item.instalasi || "-",
      ruangan: item.ruangan || "-",
      kategori: item.kategori || "-",
      id_produk: item.idProduk || "-",
      nama_set: item.namaSet || "-",
      jumlah: item.jumlah || 1,
      status: "Pending",
      petugas: item.petugas || "-"
    }));

    const { error } = await supabase
      .from('permintaan')
      .insert(rowsToInsert);

    if (error) throw error;

    return {
      status: "SUCCESS",
      idReq: idReq,
      pesan: `Berhasil mengirim ${listPayload.length} item permintaan dengan 1 ID: ${idReq}`
    };
  } catch (err) {
    return { status: "ERROR", pesan: "Gagal menyimpan permintaan: " + err.message };
  }
}

async function getDaftarPermintaan() {
  try {
    const { data, error } = await supabase
      .from('permintaan')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) throw error;

    return data.map(row => ({
      waktu: formatDateCustom(row.timestamp),
      idReq: row.id_permintaan || "-",
      instalasi: row.instalasi || "-",
      ruangan: row.ruangan || "-",
      kategori: row.kategori || "-",
      idProduk: row.id_produk || "-",
      namaSet: row.nama_set || "-",
      jumlah: row.jumlah || 1,
      status: row.status || "Pending",
      petugas: row.petugas || "-"
    }));
  } catch (err) {
    console.error("Error getDaftarPermintaan:", err);
    return [];
  }
}

async function getPermintaanPending() {
  try {
    const { data, error } = await supabase
      .from('permintaan')
      .select('*')
      .or('status.eq.Pending,status.is.null,status.eq.')
      .order('timestamp', { ascending: true });

    if (error) throw error;

    return data.map((row, i) => ({
      baris: i + 1,
      waktu: formatDateCustom(row.timestamp),
      idReq: row.id_permintaan || "-",
      instalasi: row.instalasi || "-",
      ruangan: row.ruangan || "-",
      kategori: row.kategori || "-",
      idProduk: row.id_produk || "-",
      namaSet: row.nama_set || "-",
      jumlah: row.jumlah || 1,
      status: row.status || "Pending",
      petugas: row.petugas || "-"
    }));
  } catch (err) {
    console.error("Error getPermintaanPending:", err);
    return [];
  }
}

async function updateStatusPermintaanTerlayani(idReq) {
  try {
    const { error } = await supabase
      .from('permintaan')
      .update({ status: 'Terlayani' })
      .eq('id_permintaan', idReq.toString().trim());

    if (error) throw error;
    return { status: "SUCCESS", pesan: "Status permintaan berhasil diperbarui menjadi Terlayani." };
  } catch (err) {
    return { status: "ERROR", pesan: "Gagal memperbarui status: " + err.message };
  }
}

// --------------------------------------------------------------------
// 11. TRACKING TRANSAKSI REALTIME (MENU LACAK)
// --------------------------------------------------------------------
async function lacakTransaksi(idTransaksi) {
  try {
    if (!idTransaksi) return { status: "ERROR", pesan: "ID Transaksi tidak boleh kosong!" };
    const query = idTransaksi.toString().trim();

    const { data, error } = await supabase
      .from('transaksi')
      .select('*')
      .or(`id_transaksi.eq.${query},qr_single_use.eq.${query}`)
      .limit(1);

    if (error || !data || data.length === 0) {
      return { status: "NOT_FOUND", pesan: "ID Transaksi atau QR Code tidak ditemukan!" };
    }

    const row = data[0];

    let tglExpStr = "-";
    if (row.waktu_steril) {
      const dSteril = new Date(row.waktu_steril);
      if (!isNaN(dSteril.getTime())) {
        const dExp = new Date(dSteril.getTime());
        const kategori = (row.kategori || "").toLowerCase();
        if (kategori.includes("linen") || kategori.includes("bmhp")) {
          dExp.setMonth(dExp.getMonth() + 1);
        } else {
          dExp.setMonth(dExp.getMonth() + 3);
        }
        tglExpStr = formatDateCustom(dExp, false);
      }
    }

    const detail = {
      idTransaksi: row.id_transaksi || "-",
      instalasi: row.instalasi || "-",
      ruangan: row.ruangan_asal || "-",
      kategori: row.kategori || "-",
      namaAlat: row.nama_set || "-",
      nomorSet: row.nomor_set || "-",
      statusSaatIni: row.status_alat || "Tidak Diketahui",
      tglKedaluwarsa: tglExpStr,

      // 1. Penerimaan
      waktuPenerimaan: formatDateCustom(row.waktu_masuk),

      // 2. Dekontaminasi
      mesinDekon: row.mesin_cuci || "-",
      petugasDekon: row.petugas_dekon || "-",
      waktuDekon: formatDateCustom(row.waktu_dekon),

      // 3. Setting & Packing
      petugasPacking: row.petugas_packing || "-",
      waktuPacking: formatDateCustom(row.waktu_packing),

      // 4. Sterilisasi
      mesinSteril: row.mesin_steril || "-",
      siklusSteril: row.siklus_steril || "-",
      petugasSteril: row.petugas_steril || "-",
      waktuSteril: formatDateCustom(row.waktu_steril),

      // 5. Uji Visual & Penyimpanan
      petugasUjiVisual: row.petugas_uji || "-",
      waktuPenyimpanan: formatDateCustom(row.waktu_simpan),

      // 6. Distribusi
      unitTujuan: row.ruangan_tujuan || "-",
      petugasDistribusi: row.petugas_distribusi || "-",
      waktuDistribusi: formatDateCustom(row.waktu_distribusi)
    };

    return { status: "SUCCESS", data: detail };
  } catch (err) {
    return { status: "ERROR", pesan: "Gagal melacak: " + err.message };
  }
}
