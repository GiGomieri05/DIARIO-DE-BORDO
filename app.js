// ============================================================
// DATA MODEL
// ============================================================
const HORARIOS = [
  "8h – 9h",
  "9h – 10h",
  "10h – 11h",
  "11h – 12h",
  "12h30 – 13h30",
  "13h30 – 14h30",
  "14h30 – 15h30",
  "15h30 – 16h30"
];

const AULAS = ["Informática", "Inglês"];

// data = { "2025-04-28": [ {polo, aula, tema}, ... ] } (8 entries per day, index = horario)
let data = {};
let fileHandle = null;
let unsaved = false;
let autoSaveTimer = null;
const DB_NAME = 'DiarioDB';
const STORE_NAME = 'fileHandle';
const DATA_STORE = 'dataStore'; // For Vercel: store data directly
const AUTO_SAVE_DELAY = 2000; // 2 segundos após última edição

// Detect environment
const isLocalFile = window.location.protocol === 'file:';
const isVercel = window.location.hostname.includes('vercel.app') || 
                 window.location.hostname === 'localhost' && window.location.port === '3000';
const isWeb = !isLocalFile;

// ============================================================
// INDEXEDDB - Persist file handle
// ============================================================
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2); // Version 2 for dataStore
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(DATA_STORE)) {
        db.createObjectStore(DATA_STORE);
      }
    };
  });
}

async function saveFileHandleToDB(handle) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(handle, 'fileHandle');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function loadFileHandleFromDB() {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get('fileHandle');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function clearFileHandleFromDB() {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete('fileHandle');
    tx.oncomplete = () => resolve();
  });
}

// ============================================================
// INDEXEDDB - Save/Load data (for Web/Vercel deployment)
// ============================================================
async function saveDataToDB(dataObj) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    // Create data store if doesn't exist
    if (!db.objectStoreNames.contains(DATA_STORE)) {
      console.log('Data store not available, skipping DB save');
      resolve();
      return;
    }
    const tx = db.transaction(DATA_STORE, 'readwrite');
    const store = tx.objectStore(DATA_STORE);
    const request = store.put(dataObj, 'diarioData');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function loadDataFromDB() {
  const db = await initDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(DATA_STORE)) {
      resolve(null);
      return;
    }
    const tx = db.transaction(DATA_STORE, 'readonly');
    const store = tx.objectStore(DATA_STORE);
    const request = store.get('diarioData');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

// ============================================================
// FILE SYSTEM
// ============================================================
async function openFile() {
  try {
    [fileHandle] = await window.showOpenFilePicker({
      types: [{ description: 'Diário JSON', accept: { 'application/json': ['.json'] } }],
      multiple: false
    });
    await loadFileFromHandle();
    await saveFileHandleToDB(fileHandle);
  } catch (err) {
    if (err.name !== 'AbortError') {
      promptNewFile();
    }
  }
}

async function loadFileFromHandle() {
  if (!fileHandle) return false;
  try {
    // Check permission
    const permission = await fileHandle.queryPermission({ mode: 'readwrite' });
    if (permission === 'prompt' || permission === 'denied') {
      const newPermission = await fileHandle.requestPermission({ mode: 'readwrite' });
      if (newPermission !== 'granted') {
        throw new Error('Permissão negada');
      }
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    data = JSON.parse(text);
    updateFileStatus(file.name, true);
    toast('Arquivo carregado: ' + file.name, 'success');
    refreshAll();
    return true;
  } catch (err) {
    console.error('Erro ao carregar arquivo:', err);
    fileHandle = null;
    await clearFileHandleFromDB();
    return false;
  }
}

// Try to reconnect to previously opened file
async function reconnectToFile() {
  try {
    const savedHandle = await loadFileHandleFromDB();
    if (savedHandle) {
      fileHandle = savedHandle;
      const success = await loadFileFromHandle();
      if (success) {
        toast('Reconectado ao arquivo anterior', 'success');
        return true;
      } else {
        toast('Não foi possível reconectar ao arquivo. Por favor, abra novamente.', 'error');
        return false;
      }
    }
    return false;
  } catch (err) {
    console.log('Nenhum arquivo anterior salvo');
    return false;
  }
}

function promptNewFile() {
  showModal(
    'Criar novo arquivo?',
    'Nenhum arquivo foi selecionado. Deseja criar um novo diario.json para começar?',
    async () => {
      try {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: 'diario.json',
          types: [{ description: 'Diário JSON', accept: { 'application/json': ['.json'] } }]
        });
        data = {};
        await writeFile();
        await saveFileHandleToDB(fileHandle);
        const file = await fileHandle.getFile();
        updateFileStatus(file.name, true);
        toast('Novo arquivo criado!', 'success');
        refreshAll();
      } catch {}
    }
  );
}

async function saveFile() {
  if (!fileHandle) {
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: 'diario.json',
        types: [{ description: 'Diário JSON', accept: { 'application/json': ['.json'] } }]
      });
      await saveFileHandleToDB(fileHandle);
    } catch { return; }
  }
  await writeFile();
}

// Trigger auto-save after a delay
function triggerAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (!fileHandle) return; // Only auto-save if file is linked
  autoSaveTimer = setTimeout(async () => {
    if (unsaved && fileHandle) {
      await writeFile();
      toast('Auto-salvo', 'success');
    }
  }, AUTO_SAVE_DELAY);
}

async function writeFile() {
  // Web/Vercel mode: save to IndexedDB
  if (isWeb && !fileHandle) {
    try {
      await saveDataToDB(data);
      markSaved();
      toast('Salvo no navegador ✓', 'success');
      return true;
    } catch (err) {
      toast('Erro ao salvar: ' + err.message, 'error');
      return false;
    }
  }
  
  // Local file mode
  try {
    // Check permission before writing
    const permission = await fileHandle.queryPermission({ mode: 'readwrite' });
    if (permission === 'denied') {
      throw new Error('Sem permissão para escrever no arquivo');
    }
    if (permission === 'prompt') {
      const newPermission = await fileHandle.requestPermission({ mode: 'readwrite' });
      if (newPermission !== 'granted') {
        throw new Error('Permissão negada');
      }
    }
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    markSaved();
    const file = await fileHandle.getFile();
    updateFileStatus(file.name, true);
    return true;
  } catch (err) {
    toast('Erro ao salvar: ' + err.message, 'error');
    return false;
  }
}

// Export data as JSON file (for web/Vercel)
function exportJSON() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'diario.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('JSON exportado!', 'success');
}

// Import data from JSON file (for web/Vercel)
async function importJSON(file) {
  try {
    const text = await file.text();
    const jsonData = JSON.parse(text);
    data = jsonData;
    if (isWeb) {
      await saveDataToDB(data);
    }
    refreshAll();
    toast('JSON importado!', 'success');
  } catch (err) {
    toast('Erro ao importar: ' + err.message, 'error');
  }
}

// Handle file import from input
function handleImport(input) {
  const file = input.files[0];
  if (file) {
    importJSON(file);
  }
  input.value = ''; // Reset input
}

// Setup UI based on environment
function setupUIForEnvironment() {
  const localButtons = document.querySelectorAll('.local-mode');
  const webButtons = document.querySelectorAll('.web-mode');
  
  if (isWeb) {
    // Show web buttons, hide local buttons
    localButtons.forEach(btn => btn.style.display = 'none');
    webButtons.forEach(btn => btn.style.display = 'inline-block');
  } else {
    // Show local buttons, hide web buttons
    localButtons.forEach(btn => btn.style.display = 'inline-block');
    webButtons.forEach(btn => btn.style.display = 'none');
  }
}

function updateFileStatus(name, linked) {
  const el = document.getElementById('file-status');
  const unlinkBtn = document.getElementById('unlink-btn');
  el.textContent = linked ? '📄 ' + name : 'Nenhum arquivo vinculado';
  el.className = 'file-status' + (linked ? ' linked' : '');
  if (unlinkBtn) unlinkBtn.style.display = linked ? 'inline-block' : 'none';
}

async function unlinkFile() {
  fileHandle = null;
  data = {};
  await clearFileHandleFromDB();
  updateFileStatus(null, false);
  refreshAll();
  toast('Arquivo desvinculado');
}

// ============================================================
// STATE HELPERS
// ============================================================
function getDayData(dateStr) {
  if (!data[dateStr]) {
    data[dateStr] = HORARIOS.map(() => ({ polo: '', aula: '', tema: '' }));
  }
  // Ensure 8 slots
  while (data[dateStr].length < 8) data[dateStr].push({ polo: '', aula: '', tema: '' });
  return data[dateStr];
}

function setUnsaved() {
  unsaved = true;
  document.getElementById('save-dot').className = 'save-dot unsaved';
  document.getElementById('save-label').textContent = 'Alterações não salvas';
}

function markSaved() {
  unsaved = false;
  document.getElementById('save-dot').className = 'save-dot saved';
  document.getElementById('save-label').textContent = 'Tudo salvo';
}

// ============================================================
// DATE UTILS
// ============================================================
function toDateStr(d) {
  return d.toISOString().split('T')[0];
}

function formatDateDisplay(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const days = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const dt = new Date(y, m-1, d);
  return `${days[dt.getDay()]}, ${d} ${months[m-1]} ${y}`;
}

// Short format without day name and year (for turma view - always Saturday)
function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${d} ${months[m-1]}`;
}

function setToday() {
  // Default to next Saturday (classes are always on Saturdays)
  const d = new Date();
  const day = d.getDay(); // 0=Sun, 6=Sat
  const diff = (6 - day + 7) % 7; // days until next Saturday
  const nextSat = new Date(d);
  nextSat.setDate(d.getDate() + (diff === 0 ? 0 : diff));
  const satStr = toDateStr(nextSat);
  document.getElementById('hoje-date').value = satStr;
  renderHoje();
}

// ============================================================
// TAB: HOJE
// ============================================================
function renderHoje() {
  const dateStr = document.getElementById('hoje-date').value;
  if (!dateStr) return;

  const dayData = getDayData(dateStr);
  const tbody = document.getElementById('hoje-tbody');
  tbody.innerHTML = '';

  HORARIOS.forEach((h, i) => {
    const row = dayData[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="horario-cell">${h}</td>
      <td>
        <input class="polo-input" type="text" value="${esc(row.polo)}" placeholder="—"
          oninput="updateCell('${dateStr}', ${i}, 'polo', this.value)"
          title="Polo">
      </td>
      <td>
        <select onchange="updateCell('${dateStr}', ${i}, 'aula', this.value)">
          <option value="">—</option>
          ${AULAS.map(a => `<option value="${a}" ${row.aula === a ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
      </td>
      <td>
        <input type="text" value="${esc(row.tema)}" placeholder="Tema da aula..."
          oninput="updateCell('${dateStr}', ${i}, 'tema', this.value)">
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateCell(dateStr, idx, field, value) {
  if (!data[dateStr]) getDayData(dateStr);
  data[dateStr][idx][field] = value;
  setUnsaved();
  // Refresh other tabs lazily if active
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'diasemana') renderDiaADia();
  if (activeTab === 'turmas') renderTurmas();
}

// ============================================================
// TAB: DIA A DIA
// ============================================================
function renderDiaADia() {
  const container = document.getElementById('days-list');
  const dates = Object.keys(data).sort((a,b) => b.localeCompare(a));

  if (dates.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>Nenhum dia registrado ainda.<br>Use a aba "Aulas de Hoje" para começar.</p></div>`;
    return;
  }

  container.innerHTML = '';
  dates.forEach(dateStr => {
    const dayData = data[dateStr];
    const hasContent = dayData.some(r => r.polo || r.aula || r.tema);
    const filled = dayData.filter(r => r.aula).length;

    const card = document.createElement('div');
    card.className = 'day-card';
    card.innerHTML = `
      <div class="day-header" onclick="toggleDay(this)">
        <div class="day-header-left">
          <span class="day-date">${formatDateDisplay(dateStr)}</span>
          <span class="day-count">${filled} aula${filled !== 1 ? 's' : ''} registrada${filled !== 1 ? 's' : ''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-danger" onclick="event.stopPropagation(); confirmDeleteDay('${dateStr}')">Excluir</button>
          <span class="day-chevron">▼</span>
        </div>
      </div>
      <div class="day-body">
        ${renderDayTable(dateStr, dayData)}
      </div>
    `;
    container.appendChild(card);
  });
}

function renderDayTable(dateStr, dayData) {
  const rows = HORARIOS.map((h, i) => {
    const row = dayData[i] || { polo: '', aula: '', tema: '' };
    return `<tr>
      <td class="horario-cell">${h}</td>
      <td>
        <input class="polo-input" type="text" value="${esc(row.polo)}" placeholder="—"
          oninput="updateCell('${dateStr}', ${i}, 'polo', this.value)">
      </td>
      <td>
        <select onchange="updateCell('${dateStr}', ${i}, 'aula', this.value)">
          <option value="">—</option>
          ${AULAS.map(a => `<option value="${a}" ${row.aula === a ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
      </td>
      <td>
        <input type="text" value="${esc(row.tema)}" placeholder="Tema..."
          oninput="updateCell('${dateStr}', ${i}, 'tema', this.value)">
      </td>
    </tr>`;
  }).join('');

  return `<table>
    <thead><tr><th>Horário</th><th>Polo</th><th>Aula</th><th>Tema</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function toggleDay(header) {
  header.parentElement.classList.toggle('collapsed');
}

function addDay() {
  const today = toDateStr(new Date());
  // Find next saturday or last saturday
  const d = new Date();
  const day = d.getDay();
  const diff = (6 - day + 7) % 7;
  const nextSat = new Date(d);
  nextSat.setDate(d.getDate() + (diff === 0 ? 0 : diff));
  const dateStr = toDateStr(nextSat);
  getDayData(dateStr);
  setUnsaved();
  renderDiaADia();
  toast('Dia adicionado: ' + formatDateDisplay(dateStr));
}

function confirmDeleteDay(dateStr) {
  showModal(
    'Excluir dia?',
    `Tem certeza que deseja excluir todos os registros de ${formatDateDisplay(dateStr)}? Essa ação não pode ser desfeita.`,
    () => {
      delete data[dateStr];
      setUnsaved();
      renderDiaADia();
      toast('Dia excluído');
    }
  );
}

// ============================================================
// TAB: TURMAS
// ============================================================
function renderTurmas() {
  // Build map: "Polo X | H" -> [{date, aula, tema}]
  const turmas = {}; // key: "polo|horario_index"

  // Get filter values
  const filterHorario = document.getElementById('filter-horario')?.value || '';
  const filterPolo = document.getElementById('filter-polo')?.value?.trim() || '';

  Object.entries(data).forEach(([dateStr, rows]) => {
    rows.forEach((row, i) => {
      if (!row.polo) return;

      // Apply filters
      if (filterHorario && HORARIOS[i] !== filterHorario) return;
      if (filterPolo && row.polo !== filterPolo) return;

      const key = `Polo ${row.polo} | ${HORARIOS[i]}`;
      if (!turmas[key]) turmas[key] = [];
      turmas[key].push({ dateStr, aula: row.aula, tema: row.tema });
    });
  });

  const grid = document.getElementById('turmas-grid');
  const keys = Object.keys(turmas).sort();

  if (keys.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🏫</div><p>${filterHorario || filterPolo ? 'Nenhuma turma encontrada com esses filtros.' : 'Nenhuma turma registrada ainda.'}</p></div>`;
    return;
  }

  grid.innerHTML = '';
  keys.forEach(key => {
    const entries = turmas[key].sort((a,b) => b.dateStr.localeCompare(a.dateStr));
    const card = document.createElement('div');
    card.className = 'turma-card';
    const rows = entries.map(e => `
      <tr>
        <td>${formatDateShort(e.dateStr)}</td>
        <td>${aulaTag(e.aula)}</td>
        <td style="font-size:0.82rem">${esc(e.tema) || '<span style="color:var(--muted)">—</span>'}</td>
      </tr>
    `).join('');

    card.innerHTML = `
      <div class="turma-card-header">
        <span class="turma-tag">${key}</span>
        <span style="font-size:0.72rem;color:var(--muted);margin-left:auto">${entries.length} aula${entries.length !== 1 ? 's' : ''}</span>
      </div>
      <table class="turma-history">
        <thead><tr><th>Data</th><th>Aula</th><th>Tema</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    grid.appendChild(card);
  });
}

function clearTurmaFilters() {
  document.getElementById('filter-horario').value = '';
  document.getElementById('filter-polo').value = '';
  renderTurmas();
}

function initTurmaFilters() {
  const select = document.getElementById('filter-horario');
  if (!select) return;
  // Clear existing options except first
  while (select.options.length > 1) {
    select.remove(1);
  }
  // Add horario options
  HORARIOS.forEach(h => {
    const option = document.createElement('option');
    option.value = h;
    option.textContent = h;
    select.appendChild(option);
  });
}

function aulaTag(aula) {
  if (!aula) return '<span style="color:var(--muted);font-size:0.78rem">—</span>';
  let cls = 'outros';
  if (aula === 'Informática') cls = 'info';
  if (aula === 'Inglês') cls = 'ingles';
  return `<span class="aula-tag ${cls}">${aula}</span>`;
}

// ============================================================
// TABS
// ============================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'diasemana') renderDiaADia();
    if (btn.dataset.tab === 'turmas') {
      initTurmaFilters();
      renderTurmas();
    }
  });
});

// ============================================================
// TOAST
// ============================================================
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ============================================================
// MODAL
// ============================================================
function showModal(title, body, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = body;
  document.getElementById('modal-confirm').onclick = () => { onConfirm(); closeModal(); };
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

// ============================================================
// UTILS
// ============================================================
function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

function refreshAll() {
  renderHoje();
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'diasemana') renderDiaADia();
  if (activeTab === 'turmas') renderTurmas();
  markSaved();
}

// ============================================================
// KEYBOARD SHORTCUT
// ============================================================
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveFile();
  }
});

// ============================================================
// INIT
// ============================================================
async function initApp() {
  setToday();
  markSaved();
  setupUIForEnvironment();
  
  // Web mode: try to load from IndexedDB first, then API
  if (isWeb) {
    try {
      // Try IndexedDB first
      const savedData = await loadDataFromDB();
      if (savedData && Object.keys(savedData).length > 0) {
        data = savedData;
        updateFileStatus('Navegador', true);
        toast('Dados carregados do navegador', 'success');
        renderHoje();
        return;
      }
      
      // Try API (if deployed with API)
      const response = await fetch('/api/diario');
      if (response.ok) {
        const apiData = await response.json();
        if (apiData && Object.keys(apiData).length > 0) {
          data = apiData;
          await saveDataToDB(data);
          updateFileStatus('diario.json (API)', true);
          toast('Dados carregados da API', 'success');
          renderHoje();
          return;
        }
      }
    } catch (err) {
      console.log('No saved data found:', err);
    }
    renderHoje();
    return;
  }
  
  // Local file mode
  reconnectToFile().then((success) => {
    if (!success) {
      renderHoje();
    }
  });
}

initApp();
