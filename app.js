const GAS_URL = "https://script.google.com/macros/s/AKfycbwVqo6bI8AMoQCchwXljU5I8YtqJLXJAAUvQLFRGvNHApJTJjunyE95QPOdi6m8-eZYoQ/exec";

let token = sessionStorage.getItem('bappb_token') || '';
let currentUser = null, appData = null, historyRows = [], itemCounter = 0;
let selectedResiPhotos = [], selectedPhotos = [], selectedBiodataPhotos = [];
let editingId = '';
let activePdfUrl = '', activePdfName = 'dokumen.pdf';

const $ = id => document.getElementById(id);

function showLoader(msg = "Memproses...") {
  $('loadingText').textContent = msg;
  $('loadingOverlay').classList.remove('hidden');
}
function hideLoader() { $('loadingOverlay').classList.add('hidden'); }

let toastTimer;
function toast(msg, ms = 3600, type = 'ok') {
  $('toast').textContent = msg;
  $('toast').className = 'toast toast-' + type;
  clearTimeout(toastTimer);
  $('toast').classList.remove('hidden');
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), ms);
}
function showError(id, msg) { $(id).textContent = msg; $(id).classList.remove('hidden'); }
function hideError(id) { $(id).classList.add('hidden'); }

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toggleTheme() {
  const currentTheme = document.body.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', newTheme);
  localStorage.setItem('bappb_theme', newTheme);
}
document.body.setAttribute('data-theme', localStorage.getItem('bappb_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

const gasx = (action, obj = {}) => gas('x', action, obj);
async function gas(action, ...args) {
  const payload = { action };
  if (action === 'login') { payload.username = args[0]; payload.password = args[1]; }
  else if (action === 'saveDocument') { payload.token = args[1]; payload.payload = args[0]; }
  else if (action === 'createUser') { payload.token = args[0]; payload.username = args[1]; payload.password = args[2]; payload.role = args[3]; }
  else if (action === 'changeMyPassword') { payload.token = args[0]; payload.oldPassword = args[1]; payload.newPassword = args[2]; }
  else if (action === 'getJustifData' || action === 'buildJustif') { payload.token = args[0]; payload.bappbNo = args[1]; }
  else if (action === 'x') { Object.assign(payload, args[1], { action: args[0], token }); }
  else { payload.token = args[0]; if (args[1]) payload.fileId = args[1]; }

  let json;
  try {
    const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload) });
    json = await res.json();
  } catch (e) {
    throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
  }
  if (!json.success) {
    if (String(json.error).startsWith('SESSION_EXPIRED')) {
      sessionStorage.removeItem('bappb_token');
      alert('Sesi habis, silakan login ulang.');
      location.reload();
    }
    throw new Error(String(json.error).replace('SESSION_EXPIRED: ', ''));
  }
  return json.data;
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  hideError('loginError');
  showLoader('Proses masuk...');
  try {
    const res = await gas('login', $('username').value, $('password').value);
    token = res.token;
    sessionStorage.setItem('bappb_token', token);
    await startApp();
  } catch (err) {
    showError('loginError', err.message);
  } finally {
    hideLoader();
  }
});

async function startApp() {
  showLoader('Memuat data sistem...');
  try {
    appData = await gas('getAppData', token);
    currentUser = appData.user;
    historyRows = Array.isArray(appData.history) ? appData.history : [];
    
    $('who').textContent = currentUser.username || 'Pengguna';
    $('roleBadge').textContent = currentUser.role === 'admin' ? 'Administrator' : 'Petugas Gudang';
    $('avatarIcon').textContent = (currentUser.username || 'U').charAt(0).toUpperCase();
    const isAdmin = (currentUser.role || '') === 'admin';
    $('adminNav').classList.toggle('hidden', !isAdmin);
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
    
    buildSelects();
    renderDashboard();
    renderHistory();
    resetDocForm(false);
    
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    startNotifPolling();
  } catch (err) {
    sessionStorage.removeItem('bappb_token');
    token = '';
    $('appView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    showError('loginError', err.message);
  } finally {
    hideLoader();
  }
}
if (token) startApp();

function navigate(page) {
  document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
  $('page-' + page).classList.remove('hidden');
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  if (page === 'history') renderHistory();
  if (page === 'justif' || page === 'justifhistory') loadJustifMeta();
  if (page === 'settings') loadSettings();
  closeNotif();
}

async function doLogout() {
  try { await gas('logout', token); } catch (e) {}
  sessionStorage.removeItem('bappb_token');
  token = '';
  location.reload();
}

function buildSelects() {
  $('poListOptions').innerHTML = (appData.poList || []).map(po => `<option value="${escapeHtml(po)}">`).join('');
  $('doListOptions').innerHTML = (appData.doList || []).map(doNo => `<option value="${escapeHtml(doNo)}">`).join('');
  $('docManager').innerHTML = '<option value="">-- Pilih Manajer --</option>' + (appData.managers || []).map(m => `<option>${escapeHtml(m.name || m)}</option>`).join('');
  
  const whOptions = '<option value="">-- Pilih Gudang --</option>' + (appData.warehouses || []).map(w => `<option value="${escapeHtml(w.name)}">${escapeHtml(w.name)}</option>`).join('');
  $('sender').innerHTML = whOptions;
  $('receiver').innerHTML = whOptions;

  $('sender').onchange = () => warehouseChanged('sender');
  $('receiver').onchange = () => warehouseChanged('receiver');
  window.materialOptions = appData.materials || [];
}

function warehouseChanged(prefix) {
  const w = (appData.warehouses || []).find(x => x.name === $(prefix).value);
  $(prefix + 'Address').value = w ? w.address : '';
  $(prefix + 'Up').value = w ? w.up : '';
  $(prefix + 'Nik').value = w ? w.nik : '';
  $(prefix + 'Telp').value = w ? (w.telp || '') : '';
}

function addItem(data = {}) {
  if ($('itemsBody').children.length >= 15) return toast('Maksimal 15 item barang.');
  itemCounter++;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <input class="material" list="mat_${itemCounter}" value="${escapeHtml(data.material || '')}" placeholder="Pilih/Ketik material" required>
      <datalist id="mat_${itemCounter}">${(window.materialOptions || []).map(m => `<option value="${escapeHtml(typeof m === 'object' ? (m.name || m.nama || m.material || '') : m)}">`).join('')}</datalist>
    </td>
    <td><input class="unit" value="${escapeHtml(data.unit || 'PCS')}" required placeholder="Satuan"></td>
    <td><input class="shipped" type="number" min="1" value="${escapeHtml(data.shipped || '1')}"></td>
    <td>
      <select class="condition">
        <option value="TIDAK BAIK/BAIK">TIDAK BAIK/BAIK</option>
        <option value="BAIK">BAIK</option>
        <option value="TIDAK BAIK">TIDAK BAIK</option>
      </select>
    </td>
    <td><input class="koli" value="${escapeHtml(data.koli || '1 KOLI')}"></td>
    <td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">×</button></td>
  `;

  // --- TAMBAHAN KODE UNTUK AUTO-FILL SATUAN ---
  const matInput = tr.querySelector('.material');
  const unitInput = tr.querySelector('.unit');

  const updateUnit = () => {
    const val = matInput.value.trim();
    if (!val) return;
    
    // Cari material di window.materialOptions
    const found = (window.materialOptions || []).find(m => {
      if (typeof m === 'object') {
        const matName = m.name || m.nama || m.material || '';
        return matName.toLowerCase() === val.toLowerCase();
      }
      return String(m).toLowerCase() === val.toLowerCase();
    });

    // Jika ketemu dan ada properti unit/satuan, isi otomatis
    if (found && typeof found === 'object') {
      const u = found.unit || found.satuan || found.Unit || found.Satuan;
      if (u) {
        unitInput.value = u;
      }
    }
  };

  matInput.addEventListener('input', updateUnit);
  matInput.addEventListener('change', updateUnit);
  // --------------------------------------------

  $('itemsBody').appendChild(tr);
}

function resetDocForm(clearPhotos = true) {
  setEditMode('', '');
  $('docForm').reset();
  $('docDate').value = today();
  $('itemsBody').innerHTML = '';
  addItem();
  if (clearPhotos) {
    selectedResiPhotos = [];
    selectedPhotos = [];
    selectedBiodataPhotos = [];
    renderPhotos();
  }
}

['resiInput', 'evidenInput', 'biodataInput'].forEach((id, idx) => {
  $(id).addEventListener('change', async e => {
    showLoader('Memproses foto...');
    for (const file of Array.from(e.target.files || [])) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const compressed = await compressImage(file);
        if (idx === 0) selectedResiPhotos.push(compressed);
        else if (idx === 1) selectedPhotos.push(compressed);
        else selectedBiodataPhotos.push(compressed);
      } catch (err) { toast('Gagal memproses file foto.'); }
    }
    renderPhotos();
    hideLoader();
  });
});

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      let scale = Math.min(1, 1000 / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
      URL.revokeObjectURL(url);
      resolve({ name: file.name, mimeType: 'image/jpeg', data });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Foto tidak dapat dibaca')); };
    img.src = url;
  });
}

function renderPhotos() {
  $('resiPhotoGrid').innerHTML = selectedResiPhotos.map((p, i) => `<div class="photo-preview-card"><img src="data:image/jpeg;base64,${p.data}"><button class="remove-btn" type="button" onclick="selectedResiPhotos.splice(${i},1);renderPhotos()">×</button></div>`).join('');
  $('evidenPhotoGrid').innerHTML = selectedPhotos.map((p, i) => `<div class="photo-preview-card"><img src="data:image/jpeg;base64,${p.data}"><button class="remove-btn" type="button" onclick="selectedPhotos.splice(${i},1);renderPhotos()">×</button></div>`).join('');
  $('biodataPhotoGrid').innerHTML = selectedBiodataPhotos.map((p, i) => `<div class="photo-preview-card"><img src="data:image/jpeg;base64,${p.data}"><button class="remove-btn" type="button" onclick="selectedBiodataPhotos.splice(${i},1);renderPhotos()">×</button></div>`).join('');
}

$('docForm').addEventListener('submit', async e => {
  e.preventDefault();
  showLoader(editingId ? 'Memperbarui Dokumen & PDF...' : 'Membuat Dokumen & PDF...');
  try {
    const items = Array.from($('itemsBody').querySelectorAll('tr')).map(tr => ({
      material: tr.querySelector('.material').value,
      unit: tr.querySelector('.unit').value,
      shipped: tr.querySelector('.shipped').value,
      received: tr.querySelector('.shipped').value, // Disamakan otomatis dengan jumlah kirim
      condition: tr.querySelector('.condition').value,
      koli: tr.querySelector('.koli').value
    })).filter(x => x.material);

    if (!items.length) throw new Error('Isi minimal satu barang.');
    const dupNo = $('docNo').value.trim().toLowerCase();
    if (historyRows.some(r => r.id !== editingId && String(r.bappbNo).trim().toLowerCase() === dupNo)) throw new Error(`No. BAPPB '${$('docNo').value.trim()}' sudah pernah dibuat.`);
    if ($('sender').value === $('receiver').value) throw new Error('Gudang pengirim dan penerima tidak boleh sama.');
    $('saveBtn').disabled = true;
    const payload = {
      editId: editingId,
      header: {
        date: $('docDate').value,
        po: $('docPO').value,
        doNo: $('docDO').value,
        bappbNo: $('docNo').value,
        manager: $('docManager').value,
        koli: $('docKoli').value,
        driver: $('docDriver').value,
        plate: $('docPlate').value,
        sender: $('sender').value,
        receiver: $('receiver').value,
        senderAddress: $('senderAddress').value,
        receiverAddress: $('receiverAddress').value,
        senderNik: $('senderNik').value,
        senderTelp: $('senderTelp').value,
        receiverTelp: $('receiverTelp').value,
        managerNik: ((appData.managers || []).find(m => (m.name || m) === $('docManager').value) || {}).nik || '',
        receiverNik: $('receiverNik').value,
        senderUp: $('senderUp').value,
        receiverUp: $('receiverUp').value,
        note: $('docNote').value
      },
      items,
      resiPhotos: selectedResiPhotos,
      eviden: selectedPhotos,
      biodataPhotos: selectedBiodataPhotos
    };

    const res = await gas('saveDocument', payload, token);
    toast(res.message, 4000);
    pollNotif();
    try { showPdfData(await mergePdfs(res.parts), res.name); } catch (e) { toast(e.message, 7000, 'error'); }
    
    try { historyRows = await gas('getHistory', token); } catch (e) { /* daftar riwayat akan dimuat ulang saat dibuka */ }
    renderDashboard();
    renderHistory();
    resetDocForm();
    navigate('history');
  } catch (err) {
    toast(err.message, 6000, 'error');
  } finally {
    $('saveBtn').disabled = false;
    hideLoader();
  }
});

function renderDashboard() {
  $('statTotal').textContent = historyRows.length;
  $('statToday').textContent = historyRows.filter(r => String(r.date).slice(0, 10) === today()).length;
  $('statPhotos').textContent = historyRows.reduce((n, r) => n + (r.evidenIds ? r.evidenIds.split(',').filter(Boolean).length : 0), 0);
  $('recentTable').innerHTML = historyTable(historyRows.slice(0, 5));
}

function renderHistory() {
  const q = ($('historySearch')?.value || '').toLowerCase();
  $('historyTable').innerHTML = historyTable(historyRows.filter(r => [r.id, r.bappbNo, r.po, r.doNo, r.sender, r.receiver].join(' ').toLowerCase().includes(q)));
}

function historyTable(rows) {
  if (!rows.length) return '<p class="empty">Belum ada dokumen. Pilih <strong>Buat Dokumen</strong> untuk membuat BAPPB pertama.</p>';
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>No. BAPPB</th>
            <th>PO / DO</th>
            <th>Pengirim &rarr; Penerima</th>
            <th>Dibuat oleh</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(String(r.date).slice(0, 10))}</td>
              <td><strong>${escapeHtml(r.bappbNo)}</strong></td>
              <td>${escapeHtml(r.po)} / ${escapeHtml(r.doNo)}</td>
              <td>${escapeHtml(r.sender)} &rarr; ${escapeHtml(r.receiver)}</td>
              <td>${escapeHtml(r.createdBy || '-')}</td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-secondary btn-sm" data-id="${escapeHtml(r.bappbFileId)}" onclick="openPdf(this.dataset.id)">📄 Lihat PDF</button>
                  ${canEdit(r) ? `<button class="btn btn-secondary btn-sm" data-id="${escapeHtml(r.id)}" onclick="startEdit(this.dataset.id)">✏ Edit</button>` : ''}
                  <button class="btn btn-secondary btn-sm" data-no="${escapeHtml(r.bappbNo)}" onclick="openJustif(this.dataset.no)">⚖ Justif</button>
                  ${canEdit(r) ? `<button class="btn btn-danger btn-sm" data-id="${escapeHtml(r.id)}" data-no="${escapeHtml(r.bappbNo)}" onclick="deleteDoc(this.dataset.id, this.dataset.no)">🗑 Hapus</button>` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function mergePdfs(parts) {
  if (!parts || !parts.length) throw new Error('File PDF kosong. Pastikan Code.gs terbaru sudah di-deploy sebagai versi baru.');
  if (parts.length === 1 || !window.PDFLib) return parts[0];
  const out = await PDFLib.PDFDocument.create();
  for (const b of parts) {
    const src = await PDFLib.PDFDocument.load(b);
    (await out.copyPages(src, src.getPageIndices())).forEach(pg => out.addPage(pg));
  }
  return await out.saveAsBase64();
}

async function openPdf(fileId) {
  showLoader('Membuka PDF...');
  try {
    const r = await gas('getPdf', token, fileId);
    showPdfData(await mergePdfs(r.parts), r.name);
  } catch (e) {
    toast(e.message, 5000, 'error');
  } finally {
    hideLoader();
  }
}

function showPdfData(base64, name) {
  activePdfName = name || 'dokumen.pdf';
  if (!base64) throw new Error('File PDF kosong. Pastikan Code.gs terbaru sudah di-deploy sebagai versi baru.');
  let bytes;
  try { bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); }
  catch (e) { throw new Error('Data PDF rusak, coba lagi.'); }
  const blob = new Blob([bytes], { type: 'application/pdf' });
  if (activePdfUrl) URL.revokeObjectURL(activePdfUrl);
  activePdfUrl = URL.createObjectURL(blob);
  
  $('pdfTitle').textContent = activePdfName;
  $('pdfFrame').src = activePdfUrl;
  $('pdfModal').classList.remove('hidden');
  
  $('downloadPdfBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = activePdfUrl;
    a.download = activePdfName;
    a.click();
  };
}

function closePdf() {
  $('pdfModal').classList.add('hidden');
  $('pdfFrame').src = 'about:blank';
}

$('userForm').addEventListener('submit', async e => {
  e.preventDefault();
  showLoader('Membuat pengguna...');
  try {
    const r = await gas('createUser', token, $('newUsername').value, $('newPassword').value, $('newRole').value);
    toast(r.message);
    $('userForm').reset();
  } catch (err) {
    toast(err.message, 5000, 'error');
  } finally {
    hideLoader();
  }
});

async function showPassword() {
  const oldP = prompt('Password lama:');
  if (!oldP) return;
  const newP = prompt('Password baru (min. 6 karakter):');
  if (!newP) return;
  if (newP.length < 6) return toast('Password baru minimal 6 karakter.');
  
  showLoader('Mengubah password...');
  try {
    const r = await gas('changeMyPassword', token, oldP, newP);
    toast(r.message);
  } catch (e) {
    toast(e.message, 5000, 'error');
  } finally {
    hideLoader();
  }
}

/* ---------- JUSTIF: multi-BAPPB, material dari RAB, harga per BAPPB ---------- */
let justifMeta = null, justifSel = new Set(), justifPids = [];
const isAdmin = () => (currentUser?.role || '') === 'admin';
const rupiah = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const BLN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const cap = s => String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
const cleanWh = s => String(s || '').replace(/^(WH\s+SO|WH|STO)\s+/i, '').trim();

async function loadJustifMeta() {
  showLoader('Memuat data JUSTIF...');
  try {
    justifMeta = await gasx('getJustifMeta');
    $('jPidList').innerHTML = justifMeta.pidList.map(p => `<option value="${escapeHtml(p)}">`).join('');
    if (!$('jTgl').value) $('jTgl').value = today();
    renderJustifPick(); renderJustifHistory(); updateJustifDefaults();
  } catch (e) { toast(e.message, 6000, 'error'); } finally { hideLoader(); }
}

function renderJustifPick() {
  if (!justifMeta) return;
  const q = ($('justifSearch').value || '').toLowerCase(), adm = isAdmin();
  const rows = historyRows.filter(r => [r.bappbNo, r.sender, r.receiver].join(' ').toLowerCase().includes(q));
  if (!rows.length) { $('justifPick').innerHTML = '<p class="empty">Belum ada BAPPB.</p>'; return; }
  $('justifPick').innerHTML = `<div class="table-wrap pick-scroll"><table>
    <thead><tr><th></th><th>Tanggal</th><th>No. BAPPB</th><th>Pengirim &rarr; Penerima</th><th class="num">Material</th><th>Total Harga Kirim</th></tr></thead>
    <tbody>${rows.map(r => {
      const k = String(r.bappbNo).toLowerCase(), b = justifMeta.biaya[k], n = justifMeta.rabCount[k] || 0;
      const price = adm
        ? `<div class="row-actions"><input class="biaya-in" type="number" min="0" data-no="${escapeHtml(r.bappbNo)}" value="${b ? b.total : ''}" placeholder="0">
             <button class="btn btn-secondary btn-sm" data-no="${escapeHtml(r.bappbNo)}" onclick="saveBiaya(this)">Simpan</button></div>`
        : (b ? rupiah(b.total) : '<span class="muted">belum diisi</span>');
      return `<tr><td><input type="checkbox" data-no="${escapeHtml(r.bappbNo)}" ${justifSel.has(r.bappbNo) ? 'checked' : ''} ${n ? '' : 'disabled'} onchange="toggleJustifSel(this)"></td>
        <td>${escapeHtml(String(r.date).slice(0, 10))}</td><td><strong>${escapeHtml(r.bappbNo)}</strong></td>
        <td>${escapeHtml(r.sender)} &rarr; ${escapeHtml(r.receiver)}</td><td class="num">${n}</td><td>${price}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function toggleJustifSel(el) {
  el.checked ? justifSel.add(el.dataset.no) : justifSel.delete(el.dataset.no);
  $('justifCount').textContent = justifSel.size + ' dipilih';
  updateJustifDefaults();
}

async function saveBiaya(btn) {
  const no = btn.dataset.no, inp = document.querySelector(`.biaya-in[data-no="${CSS.escape(no)}"]`);
  showLoader('Menyimpan total harga...');
  try {
    const r = await gasx('setBiaya', { bappbNo: no, total: inp.value, armada: justifMeta.settings.defaultArmada, volume: 1 });
    justifMeta.biaya = r.biaya; toast(r.message); pollNotif(); $('justifResult').innerHTML = '';
  } catch (e) { toast(e.message, 6000, 'error'); } finally { hideLoader(); }
}

function setIfClean(id, val) { const el = $(id); if (!el.dataset.dirty) el.value = val; }
function selRows() { return historyRows.filter(r => justifSel.has(r.bappbNo)); }

function updateJustifDefaults() {
  if (!justifMeta) return;
  $('justifCount').textContent = justifSel.size + ' dipilih';
  const rows = selRows(), tgl = $('jTgl').value || today(), [y, m] = tgl.split('-'), bln = BLN[+m - 1];
  const dest = [...new Set(rows.map(r => cap(cleanWh(r.receiver))))];
  const tujuan = dest.length > 1 ? dest.slice(0, -1).join(', ') + ' dan ' + dest[dest.length - 1] : (dest[0] || '');
  const src = rows[0] ? String(rows[0].sender) : '';
  const sumber = /^WH\s+SO\s+/i.test(src) ? 'WH SO ' + cap(src.replace(/^WH\s+SO\s+/i, '')) : src;
  const seq = String(justifMeta.justifs.filter(j => String(j.tglTerbit).slice(0, 7) === `${y}-${m}`).length + 1).padStart(2, '0');
  setIfClean('jTujuan', tujuan); setIfClean('jSumber', sumber);
  setIfClean('jSaat', `${bln} ${y}`);
  setIfClean('jNama', `Justifikasi Pengiriman Material ${sumber} ${bln} ${seq}`.replace(/\s+/g, ' '));
}
function justifDateChanged() { ['jNama', 'jSaat'].forEach(id => delete $(id).dataset.dirty); updateJustifDefaults(); }

function justifParams() {
  if (!justifSel.size) throw new Error('Pilih minimal satu BAPPB.');
  const p = { bappbNos: [...justifSel], noJustif: $('jNo').value.trim(), tglTerbit: $('jTgl').value, pids: [...justifPids], namaKegiatan: $('jNama').value.trim(),
    tujuan: $('jTujuan').value.trim(), sumber: $('jSumber').value.trim(), saatPenggunaan: $('jSaat').value.trim() };
  if (!p.noJustif) throw new Error('Isi No. Justif.');
  if (!p.pids.length) throw new Error('Tambahkan minimal satu ID Project (PID).');
  if (!p.tglTerbit || !p.namaKegiatan || !p.tujuan || !p.sumber || !p.saatPenggunaan) throw new Error('Lengkapi data justifikasi.');
  return p;
}

async function addPidChip() {
  const pid = $('jPidInput').value.trim();
  if (!pid) return toast('Ketik atau pilih PID dulu.');
  if (justifPids.some(x => x.toLowerCase() === pid.toLowerCase())) return toast('PID sudah ditambahkan.');
  justifPids.push(pid); $('jPidInput').value = ''; renderPidChips();
  if (isAdmin() && !justifMeta.pidList.some(x => x.toLowerCase() === pid.toLowerCase())) {
    try {
      const r = await gasx('addPid', { pid }); justifMeta.pidList = r.pidList;
      $('jPidList').innerHTML = r.pidList.map(p => `<option value="${escapeHtml(p)}">`).join('');
      toast('PID baru disimpan ke daftar PID.');
    } catch (e) { toast(e.message, 5000, 'error'); }
  }
}
function removePidChip(i) { justifPids.splice(i, 1); renderPidChips(); }
function renderPidChips() {
  $('jPidChips').innerHTML = justifPids.map((p, i) => `<span class="pid-chip">${escapeHtml(p)}<button type="button" onclick="removePidChip(${i})" title="Hapus">×</button></span>`).join('');
}

async function previewJustif() {
  try {
    justifParams();
    showLoader('Mengambil material dari RAB...');
    const d = await gasx('getJustifData', { bappbNos: [...justifSel] });
    $('justifResult').innerHTML = `<div class="card card-table"><h2>Pratinjau RAB Peruntukan Pengiriman Material</h2><div class="table-wrap"><table>
      <thead><tr><th>No</th><th>Uraian</th><th>Armada</th><th>Lokasi</th><th class="num">Volume</th><th class="num">Total</th></tr></thead><tbody>
      ${d.groups.map((g, i) => `<tr><td>${i + 1}</td><td><strong>${escapeHtml(g.route)}</strong> <span class="muted small">(${escapeHtml(g.bappbNo)})</span></td><td>${escapeHtml(g.armada)}</td><td>${escapeHtml(g.route)}</td><td class="num">${g.volume}</td><td class="num">${g.total ? rupiah(g.total) : '<span class="muted">belum diisi</span>'}</td></tr>`
        + g.materials.map(m => `<tr><td></td><td>${escapeHtml(m.uraian)}</td><td></td><td></td><td class="num">${escapeHtml(m.volume)}</td><td></td></tr>`).join('')).join('')}
      </tbody><tfoot><tr class="tr-total"><td colspan="5">GRAND TOTAL</td><td class="num">${rupiah(d.grandTotal)}</td></tr></tfoot></table></div></div>`;
  } catch (e) { toast(e.message, 6000, 'error'); } finally { hideLoader(); }
}

let editingJustifId = '';
async function uploadJustifPdf(r, merged) {
  try {
    showLoader('Menyimpan PDF ke folder Drive...');
    const x = await gasx('saveJustifFile', { id: r.id, name: r.name, data: merged });
    toast('📁 ' + x.message, 4500);
  } catch (e) { toast('PDF berhasil dibuat, tetapi gagal disimpan ke Drive: ' + e.message, 9000, 'error'); }
}

function resetJustifForm() {
  editingJustifId = ''; justifSel.clear(); justifPids = []; renderPidChips();
  ['jNo', 'jPidInput', 'jNama', 'jTujuan', 'jSumber', 'jSaat'].forEach(id => { $(id).value = ''; delete $(id).dataset.dirty; });
  $('jTgl').value = today(); $('justifResult').innerHTML = '';
  $('jEditBanner').classList.add('hidden'); $('jBuildBtn').innerHTML = '📄 Buat &amp; Lihat PDF Justif';
  if (justifMeta) { renderJustifPick(); updateJustifDefaults(); }
}

async function buildJustif() {
  try {
    const params = justifParams();
    if (editingJustifId) params.editId = editingJustifId;
    showLoader(editingJustifId ? 'Memperbarui PDF Justif...' : 'Menyusun PDF Justif...');
    const r = await gasx('buildJustif', { params });
    const merged = await mergePdfs(r.parts);
    showPdfData(merged, r.name);
    toast('Justif ' + r.noJustif + (r.edited ? ' diperbarui.' : ' dibuat.'), 4000);
    await uploadJustifPdf(r, merged);
    resetJustifForm();
    await loadJustifMeta(); pollNotif();
  } catch (e) { toast(e.message, 7000, 'error'); } finally { hideLoader(); }
}

function startEditJustif(id) {
  const x = justifMeta.justifs.find(v => v.id === id);
  if (!x) return toast('Data justif tidak dapat dimuat.', 5000, 'error');
  // Justif lama tanpa data parameter: susun ulang dari kolom yang tersimpan
  const p = x.params || {
    noJustif: x.noJustif, tglTerbit: x.tglTerbit, namaKegiatan: x.namaKegiatan || '', tujuan: '', sumber: '', saatPenggunaan: '',
    pids: String(x.pid || '').split(',').map(v => v.trim()).filter(Boolean),
    bappbNos: String(x.bappbNos || '').split(',').map(v => v.trim()).filter(Boolean)
  };
  resetJustifForm();
  editingJustifId = id; justifSel = new Set(p.bappbNos); justifPids = [...(p.pids || (p.pid ? [p.pid] : []))];
  $('jNo').value = p.noJustif || x.noJustif; $('jTgl').value = p.tglTerbit;
  [['jNama', p.namaKegiatan], ['jTujuan', p.tujuan], ['jSumber', p.sumber], ['jSaat', p.saatPenggunaan]].forEach(([k, v]) => { $(k).value = v; $(k).dataset.dirty = 1; });
  renderPidChips(); renderJustifPick(); updateJustifDefaults();
  $('jEditNo').textContent = x.noJustif; $('jEditBanner').classList.remove('hidden');
  $('jBuildBtn').innerHTML = '💾 Simpan Perubahan &amp; Lihat PDF';
  navigate('justif');
}

function renderJustifHistory() {
  if (!justifMeta) return;
  const q = ($('jhSearch').value || '').toLowerCase();
  const l = justifMeta.justifs.filter(x => [x.noJustif, x.namaKegiatan, x.pid, x.bappbNos, x.createdBy].join(' ').toLowerCase().includes(q));
  $('justifHistory').innerHTML = !l.length ? '<p class="empty">Belum ada justif.</p>' : `<div class="table-wrap"><table>
    <thead><tr><th>Tgl Terbit</th><th>No. Justif</th><th>Kegiatan</th><th>PID</th><th>BAPPB</th><th class="num">Total</th><th>Dibuat oleh</th><th>Aksi</th></tr></thead><tbody>
    ${l.map(x => `<tr><td>${escapeHtml(x.tglTerbit)}</td><td><strong>${escapeHtml(x.noJustif)}</strong></td><td>${escapeHtml(x.namaKegiatan)}</td><td>${escapeHtml(x.pid)}</td>
      <td>${escapeHtml(x.bappbNos)}</td><td class="num">${rupiah(x.total)}</td><td>${escapeHtml(x.createdBy || '-')}${x.updatedBy ? `<div class="muted small">diedit: ${escapeHtml(x.updatedBy)}</div>` : ''}</td>
      <td><div class="row-actions"><button class="btn btn-secondary btn-sm" data-id="${escapeHtml(x.id)}" onclick="reopenJustif(this.dataset.id)">📄 Buka PDF</button>
        ${x.fileId ? `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://drive.google.com/file/d/${escapeHtml(x.fileId)}/view">📁 Drive</a>` : ''}
        ${(isAdmin() || x.createdBy === currentUser?.username) ? `<button class="btn btn-secondary btn-sm" data-id="${escapeHtml(x.id)}" onclick="startEditJustif(this.dataset.id)">✏ Edit</button>
        <button class="btn btn-danger btn-sm" data-id="${escapeHtml(x.id)}" data-no="${escapeHtml(x.noJustif)}" onclick="deleteJustif(this.dataset.id, this.dataset.no)">🗑 Hapus</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
}
async function deleteJustif(id, no) {
  if (!confirm(`Hapus justif ${no}?\n\nData justif dan file PDF-nya di Drive akan dihapus. Tindakan ini tidak dapat dibatalkan.`)) return;
  showLoader('Menghapus justif...');
  try {
    const r = await gasx('deleteJustif', { id });
    if (editingJustifId === id) resetJustifForm();
    toast(r.message, 4000);
    await loadJustifMeta(); pollNotif();
  } catch (e) { toast(e.message, 7000, 'error'); } finally { hideLoader(); }
}
async function reopenJustif(id) {
  showLoader('Membuka PDF JUSTIF...');
  try {
    const r = await gasx('buildJustif', { params: { id } });
    const merged = await mergePdfs(r.parts);
    showPdfData(merged, r.name);
    const x = justifMeta.justifs.find(v => v.id === id);
    if (!r.hasFile && x && (isAdmin() || x.createdBy === currentUser?.username)) { await uploadJustifPdf(r, merged); await loadJustifMeta(); }
  } catch (e) { toast(e.message, 6000, 'error'); } finally { hideLoader(); }
}
function openJustif(no) {
  if (editingJustifId) resetJustifForm();
  justifSel = new Set([no]);
  navigate('justif');
}

/* ---------- PENGATURAN ---------- */
let settingsData = null, settingsPids = [];
async function loadSettings() {
  showLoader('Memuat pengaturan...');
  try { const r = await gasx('getSettings'); settingsData = r.settings; settingsPids = r.pidList; renderSettings(); }
  catch (e) { toast(e.message, 6000, 'error'); } finally { hideLoader(); }
}
function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? '' : a[k]), o); }
function setPath(o, p, v) { const ks = p.split('.'); ks.slice(0, -1).reduce((a, k) => a[k], o)[ks.at(-1)] = v; }
function sField(label, path, type = 'text', full = false) {
  const v = escapeHtml(getPath(settingsData, path));
  const inp = type === 'textarea' ? `<textarea rows="2" data-path="${path}">${v}</textarea>` : `<input type="${type}" data-path="${path}" value="${v}">`;
  return `<div class="field ${full ? 'full' : ''}"><label>${label}</label>${inp}</div>`;
}
function renderSettings() {
  const adm = isAdmin(), d = settingsData;
  let h = `<div class="card"><h2>Tampilan &amp; Akun</h2><div class="row-actions">
      <button class="btn btn-secondary" onclick="toggleTheme()">🌓 Ganti Tema Terang/Gelap</button>
      <button class="btn btn-secondary" onclick="showPassword()">🔑 Ganti Password</button>
      ${adm ? `<button class="btn btn-secondary" onclick="navigate('users')">♙ Kelola Pengguna</button>` : ''}</div></div>`;
  if (!adm) { $('settingsBody').innerHTML = h + '<p class="muted">Pengaturan lainnya hanya dapat diubah oleh admin.</p>'; return; }
  h += `<div class="card"><h2>Data Default Justif</h2><div class="form-grid">
      ${sField('Unit kerja', 'unitKerja', 'text', true)}${sField('Cost center', 'costCenter')}${sField('No. DRK', 'noDrk')}${sField('Jenis anggaran', 'jenisAnggaran')}
      ${sField('Armada default', 'defaultArmada')}${sField('Folder Drive file Justif (ID atau link folder)', 'justifFolderId', 'text', true)}${sField('Alamat tempat penggunaan', 'alamatPenggunaan', 'textarea', true)}</div></div>`;
  const person = (title, path) => `<div class="signer"><strong>${title}</strong><div class="form-grid">${sField('Nama', path + '.nama')}${sField('NIK', path + '.nik')}${sField('Jabatan', path + '.jabatan')}</div></div>`;
  h += `<div class="card"><h2>Penandatangan Justif</h2><p class="muted small">Pemeriksa 1 dan 2 juga tampil di halaman RAB.</p>
      ${person('Dibuat oleh', 'signers.dibuat')}${[0, 1, 2, 3].map(i => person('Diperiksa oleh #' + (i + 1), 'signers.diperiksa.' + i)).join('')}${person('Disetujui oleh', 'signers.disetujui')}</div>`;
  h += `<div class="card"><h2>Kepala Surat Jalan</h2><p class="muted small">Empat baris di pojok kanan atas Surat Jalan.</p><div class="form-grid">
      ${[0, 1, 2, 3].map(i => sField('Baris ' + (i + 1), 'sjForm.' + i)).join('')}</div></div>`;
  h += `<div class="card"><h2>Daftar PID (ID Project)</h2><div class="justif-bar"><div class="field"><label>PID baru</label><input id="newPid" placeholder="Contoh: 26PV12R638-0001 , TIF-50/2026"></div>
      <button class="btn btn-primary" onclick="addPidSettings()">＋ Tambah PID</button></div><div id="pidList" style="margin-top:14px"></div></div>`;
  $('settingsBody').innerHTML = h; renderPidList();
}
function renderPidList() {
  $('pidList').innerHTML = settingsPids.length ? settingsPids.map(p => `<div class="pid-row"><span>${escapeHtml(p)}</span><button class="btn btn-danger btn-sm" data-pid="${escapeHtml(p)}" onclick="deletePid(this.dataset.pid)">Hapus</button></div>`).join('') : '<p class="muted small">Belum ada PID.</p>';
}
async function addPidSettings() {
  try { const r = await gasx('addPid', { pid: $('newPid').value }); settingsPids = r.pidList; $('newPid').value = ''; renderPidList(); toast(r.message); }
  catch (e) { toast(e.message, 5000, 'error'); }
}
async function deletePid(pid) {
  if (!confirm('Hapus PID ini?')) return;
  try { const r = await gasx('deletePid', { pid }); settingsPids = r.pidList; renderPidList(); } catch (e) { toast(e.message, 5000, 'error'); }
}
async function saveSettings() {
  const s = JSON.parse(JSON.stringify(settingsData));
  document.querySelectorAll('#settingsBody [data-path]').forEach(el => setPath(s, el.dataset.path, el.value));
  showLoader('Menyimpan pengaturan...');
  try { const r = await gasx('saveSettings', { settings: s }); settingsData = r.settings; toast(r.message); }
  catch (e) { toast(e.message, 6000, 'error'); } finally { hideLoader(); }
}


/* ---------- EDIT DOKUMEN ---------- */
const canEdit = r => (currentUser?.role === 'admin') || String(r.createdBy) === currentUser?.username;

async function deleteDoc(id, no) {
  if (!confirm(`Hapus dokumen BAPPB ${no}?\n\nPDF di Drive, data RAB, dan total harga kirim untuk BAPPB ini akan ikut dihapus. Tindakan ini tidak dapat dibatalkan.`)) return;
  showLoader('Menghapus dokumen...');
  try {
    const r = await gasx('deleteDocument', { id });
    if (editingId === id) resetDocForm();
    toast(r.message, 4000);
    try { historyRows = await gas('getHistory', token); } catch (e) { historyRows = historyRows.filter(h => h.id !== id); }
    renderDashboard(); renderHistory();
    if (justifMeta) { justifSel.delete(no); loadJustifMeta(); }
    pollNotif();
  } catch (e) { toast(e.message, 7000, 'error'); } finally { hideLoader(); }
}

function setEditMode(id, no) {
  editingId = id || '';
  $('editBanner').classList.toggle('hidden', !editingId);
  $('editBannerNo').textContent = no || '';
  $('saveBtn').innerHTML = editingId ? '💾 Simpan Perubahan &amp; Generate PDF' : '💾 Simpan &amp; Generate PDF';
}
function cancelEdit() { resetDocForm(); toast('Edit dibatalkan.'); }

async function startEdit(id) {
  showLoader('Memuat data dokumen...');
  try {
    const d = await gasx('getEditData', { id });
    const h = d.header || {};
    resetDocForm();
    setEditMode(id, h.bappbNo);
    const set = (el, v) => { $(el).value = v ?? ''; };
    set('docDate', String(h.date || '').slice(0, 10)); set('docPO', h.po); set('docDO', h.doNo); set('docNo', h.bappbNo);
    set('docManager', h.manager); set('docKoli', h.koli); set('docDriver', h.driver); set('docPlate', h.plate); set('docNote', h.note);
    set('sender', h.sender); set('receiver', h.receiver);
    warehouseChanged('sender'); warehouseChanged('receiver');
    ['senderUp', 'senderNik', 'senderTelp', 'senderAddress', 'receiverUp', 'receiverNik', 'receiverTelp', 'receiverAddress']
      .forEach(k => { if (h[k]) set(k, h[k]); });
    $('itemsBody').innerHTML = '';
    (d.items.length ? d.items : [{}]).forEach(it => {
      addItem(it);
      const tr = $('itemsBody').lastElementChild;
      if (it.condition) tr.querySelector('.condition').value = it.condition;
    });
    selectedResiPhotos = d.photos.resi; selectedPhotos = d.photos.eviden; selectedBiodataPhotos = d.photos.biodata;
    renderPhotos();
    navigate('create');
    if (d.legacy) toast('Dokumen lama: data dilengkapi dari riwayat & RAB. Periksa kembali sebelum menyimpan.', 8000);
  } catch (e) { toast(e.message, 6000, 'error'); } finally { hideLoader(); }
}


/* ---------- NOTIFIKASI ---------- */
let notifData = { events: [], alerts: [] }, notifTimer = null;
const seenKey = () => 'bappb_seen_' + (currentUser?.username || '');
const NOTIF_PAGE = { dokumen_baru: 'history', dokumen_edit: 'history', harga: 'justif', justif_baru: 'justifhistory', justif_edit: 'justifhistory', dokumen_hapus: 'history', justif_hapus: 'justifhistory' };
const NOTIF_ICON = { dokumen_baru: '📄', dokumen_edit: '✏', harga: '💰', justif_baru: '⚖', justif_edit: '✏', dokumen_hapus: '🗑', justif_hapus: '🗑' };

function startNotifPolling() {
  clearInterval(notifTimer);
  pollNotif(true);
  notifTimer = setInterval(() => { if (!document.hidden) pollNotif(); }, 60000);
}
async function pollNotif(first = false) {
  try {
    const prev = new Set(notifData.events.map(e => e.id));
    notifData = await gasx('getNotifs');
    if (!localStorage.getItem(seenKey())) localStorage.setItem(seenKey(), notifData.events[0]?.time || '');
    const fresh = notifData.events.filter(e => !prev.has(e.id) && e.actor !== currentUser.username && e.time > (localStorage.getItem(seenKey()) || ''));
    if (!first && fresh.length) toast('🔔 ' + fresh[0].text + (fresh.length > 1 ? ` (+${fresh.length - 1} lainnya)` : ''), 5000, 'info');
    renderNotif();
  } catch (e) { /* diam: polling tidak boleh mengganggu pengguna */ }
}
const unreadEvents = () => notifData.events.filter(e => e.actor !== currentUser.username && e.time > (localStorage.getItem(seenKey()) || ''));
function renderNotif() {
  const n = unreadEvents().length + notifData.alerts.length;
  $('bellBadge').textContent = n > 9 ? '9+' : n; $('bellBadge').classList.toggle('hidden', !n);
  const seen = localStorage.getItem(seenKey()) || '';
  const alerts = notifData.alerts.map(a => `<div class="notif-item notif-alert" onclick="gotoNotif('${a.page}')"><span>⚠</span><div>${escapeHtml(a.text)}<div class="muted small">Klik untuk membuka</div></div></div>`).join('');
  const evs = notifData.events.map(e => `<div class="notif-item ${e.actor !== currentUser.username && e.time > seen ? 'unread' : ''}" onclick="gotoNotif('${NOTIF_PAGE[e.type] || 'dashboard'}')">
      <span>${NOTIF_ICON[e.type] || '•'}</span><div>${escapeHtml(e.text)}<div class="muted small">${escapeHtml(e.actor || '-')} &middot; ${escapeHtml(e.time.slice(8, 10) + '/' + e.time.slice(5, 7) + ' ' + e.time.slice(11, 16))}</div></div></div>`).join('');
  $('notifList').innerHTML = (alerts + evs) || '<p class="empty" style="padding:16px">Belum ada notifikasi.</p>';
}
function toggleNotif(ev) { ev.stopPropagation(); $('notifPanel').classList.toggle('hidden'); if (!$('notifPanel').classList.contains('hidden')) renderNotif(); }
function closeNotif() { $('notifPanel').classList.add('hidden'); }
function markNotifRead() { localStorage.setItem(seenKey(), notifData.events[0]?.time || ''); renderNotif(); }
function gotoNotif(page) { closeNotif(); navigate(page); }
document.addEventListener('click', closeNotif);
