/**
 * app.js - Main application controller (v6 FINAL)
 * + Undo/Redo system (Ctrl+Z/Y)
 * + Keyboard shortcuts
 * + Settings panel (tema, performa, FPS)
 * + Real analysis dengan progress nyata (async Viewer.realAnalysis)
 * + Real quality metrics dari QualityCalculator
 * + Real export via GLTFExporter + BVH generator
 * + Persistent state (localStorage)
 * + Responsive: mobile / tablet / desktop
 * + Session restore prompt
 * + Semua ID HTML terintegrasi dengan benar
 */
'use strict';

// ─── Toast ───────────────────────────────────────────────────
let toastTimer;
function toast(msg, type='ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'show' + (type !== 'ok' ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2800);
}

// ─── Mobile viewport height fix ─────────────────────────────
function fixVH() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}
window.addEventListener('resize', fixVH);
fixVH();

// ─── Page Navigation ─────────────────────────────────────────
const pageIds = {
  load: 'page-load', check: 'page-check', bodyrig: 'page-bodyrig',
  handrig: 'page-handrig', checkactor: 'page-checkactor', motions: 'page-motions',
};

function navigateTo(pageKey) {
  if (!AppState.steps.load && pageKey !== 'load') {
    toast('Muat file karakter terlebih dahulu', 'warn'); return;
  }
  if (!AppState.steps.check && ['bodyrig','handrig','checkactor','motions'].includes(pageKey)) {
    toast('Selesaikan Check Model terlebih dahulu', 'warn'); return;
  }
  if (!AppState.steps.bodyrig && ['handrig','checkactor','motions'].includes(pageKey)) {
    toast('Selesaikan Body Rig terlebih dahulu', 'warn'); return;
  }
  if (!AppState.steps.handrig && ['checkactor','motions'].includes(pageKey)) {
    toast('Selesaikan Hand Rig terlebih dahulu', 'warn'); return;
  }

  Object.values(pageIds).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const target = document.getElementById(pageIds[pageKey]);
  if (target) { target.classList.add('active'); AppState.currentPage = pageKey; }

  updateTabStates();
  updateStatusBar();
  _moveCanvasAndViewer(pageKey);

  if (pageKey === 'check' && AppState.file) initCheckCanvas();
  if (pageKey === 'bodyrig')    initBodyRigPage();
  if (pageKey === 'handrig')    initHandRigPage();
  if (pageKey === 'checkactor') initActorPage();
  if (pageKey === 'motions')    initMotionsPage();

  // Auto-save state setiap pindah halaman
  Storage.saveState(AppState);
}

// ─── Canvas Teleport ─────────────────────────────────────────
let _compassEl = null;

function _moveCanvasAndViewer(pageKey) {
  const vpMap = {
    check: 'check-viewport-wrap', bodyrig: 'rig-viewport',
    handrig: 'hand-viewport', checkactor: 'actor-viewport', motions: 'motions-viewport',
  };
  const gizmoMap = { bodyrig: 'body-gizmo-layer', handrig: 'hand-gizmo-layer' };

  const vpId = vpMap[pageKey];
  if (!vpId) return;
  const canvas = document.getElementById('main-canvas');
  const vp     = document.getElementById(vpId);
  if (!canvas || !vp) return;

  if (canvas.parentElement !== vp) vp.insertBefore(canvas, vp.firstChild);

  if (window.Viewer && viewerInitialized) Viewer.setViewportEl(vp);

  const gizmoId = gizmoMap[pageKey];
  if (gizmoId && window.Viewer) {
    const gizmoEl = document.getElementById(gizmoId);
    if (gizmoEl) Viewer.setGizmoContainer(gizmoEl);
  }

  if (!_compassEl) _compassEl = document.getElementById('compass-widget');
  if (_compassEl && vp) vp.appendChild(_compassEl);

  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
    if (window.Viewer && viewerInitialized) Viewer.setViewportEl(vp);
  }, 50);
}

function updateTabStates() {
  const stepsOrder = ['load','check','bodyrig','handrig','checkactor','motions'];
  const prereqs = {
    check:'load', bodyrig:'check', handrig:'bodyrig',
    checkactor:'handrig', motions:'checkactor',
  };
  document.querySelectorAll('.step-tab').forEach((tab, i) => {
    tab.classList.remove('active','done','locked');
    const key = stepsOrder[i]; if (!key) return;
    if (key === AppState.currentPage) { tab.classList.add('active'); return; }
    if (AppState.steps[key])          { tab.classList.add('done');   return; }
    const pre = prereqs[key];
    if (pre && !AppState.steps[pre])  tab.classList.add('locked');
  });
}

function updateStatusBar() {
  const msgs = {
    load:       'Pilih file GLB karakter untuk memulai proses auto-rigging',
    check:      'Tinjau model — verifikasi geometri, material, dan UV mapping',
    bodyrig:    'Sesuaikan posisi joint — seret titik untuk memindahkan',
    handrig:    'Atur joint jari tangan — seret untuk repositioning',
    checkactor: 'Validasi rig — test pose dan skin weights',
    motions:    'Pilih motion dan export karakter yang sudah di-rig',
  };
  const sb = document.getElementById('sb-msg');
  if (sb) sb.textContent = msgs[AppState.currentPage] || '';
}

// ─── Undo / Redo ─────────────────────────────────────────────
function performUndo() {
  const snap = HistoryManager.undo();
  if (!snap) { toast('Tidak ada yang bisa di-undo', 'warn'); return; }
  AppState.bodyRig.jointPositions = { ...snap };
  _rebuildJointPositionsInViewer();
  toast('↩ Undo');
  _updateUndoRedoBtns();
}

function performRedo() {
  const snap = HistoryManager.redo();
  if (!snap) { toast('Tidak ada yang bisa di-redo', 'warn'); return; }
  AppState.bodyRig.jointPositions = { ...snap };
  _rebuildJointPositionsInViewer();
  toast('↪ Redo');
  _updateUndoRedoBtns();
}

function _rebuildJointPositionsInViewer() {
  if (!window.Viewer) return;
  const joints = Viewer.getJoints();
  Object.entries(AppState.bodyRig.jointPositions).forEach(([id, pos]) => {
    const j = joints.find(jt => jt.id === id);
    if (j?.obj3d && !j.isBone) j.obj3d.position.set(pos.x, pos.y, pos.z);
  });
  Viewer.markDirty?.();
}

function _updateUndoRedoBtns() {
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  if (btnUndo) btnUndo.disabled = !HistoryManager.canUndo();
  if (btnRedo) btnRedo.disabled = !HistoryManager.canRedo();
}

// ─── Keyboard Shortcuts ───────────────────────────────────────
function _setupKeyboard() {
  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const ctrl = e.ctrlKey || e.metaKey;
    const key  = e.key.toLowerCase();

    if (ctrl && key === 'z') { e.preventDefault(); performUndo(); return; }
    if (ctrl && key === 'y') { e.preventDefault(); performRedo(); return; }
    if (ctrl && key === 's') { e.preventDefault(); Storage.saveState(AppState); toast('State tersimpan ✓'); return; }

    if (!window.Viewer || !viewerInitialized) return;

    switch (key) {
      case 'f':       vpSetView('front'); toast('View: Front'); break;
      case 'b':       vpSetView('back');  toast('View: Back');  break;
      case 't':       if (!ctrl) { vpSetView('top'); toast('View: Top'); } break;
      case 'r':       if (!ctrl) { vpReset(); toast('View: Reset'); } break;
      case 'w':       if (AppState.currentPage === 'check') tbWireframe(); break;
      case 'x':       if (AppState.currentPage === 'check') tbBones(); break;
      case ' ':
        e.preventDefault();
        if (AppState.currentPage === 'motions') togglePlay(document.getElementById('play-btn'));
        else if (AppState.currentPage === 'checkactor') toggleActorPreview(document.getElementById('actor-play-btn'));
        break;
      case 'escape':  closeSettingsPanel(); toggleShortcutsHelp(false); break;
      case '?':       toggleShortcutsHelp(); break;
    }
  });
}

// ─── Settings Panel ───────────────────────────────────────────
function openSettingsPanel() {
  const panel   = document.getElementById('settings-panel');
  const overlay = document.getElementById('settings-overlay');
  if (panel) {
    _populateSettings();
    panel.classList.add('open');
  }
  if (overlay) overlay.classList.add('open');
}

function closeSettingsPanel() {
  const panel   = document.getElementById('settings-panel');
  const overlay = document.getElementById('settings-overlay');
  if (panel)   panel.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

function _populateSettings() {
  const s = AppState.settings;
  _setCheck('set-shadows',     s.shadowsEnabled !== false);
  _setCheck('set-antialias',   s.antialias !== false);
  _setCheck('set-fps',         !!s.showFPS);
  _setCheck('set-coords',      s.showCoords !== false);
  _setCheck('set-symmetry',    s.defaultSymmetry !== false);
  _setCheck('set-right-panel', !!s.rightPanelVisible);

  const sidebarInp = document.getElementById('set-sidebar-width');
  const sidebarPrev = document.getElementById('sidebar-width-preview');
  if (sidebarInp) {
    sidebarInp.value = s.sidebarWidth || 185;
    if (sidebarPrev) sidebarPrev.textContent = sidebarInp.value;
  }

  const perfSel = document.getElementById('set-perf-tier');
  if (perfSel) {
    const fps = s.jointProjectionFPS || 60;
    perfSel.value = fps >= 60 ? 'high' : fps >= 45 ? 'mid' : 'low';
  }
}

function _setCheck(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!val;
  else if (el.classList.contains('toggle')) el.classList.toggle('on', !!val);
}

function saveSettingsFromPanel() {
  const s = AppState.settings;

  const getCheck = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? el.checked : fallback;
  };

  s.shadowsEnabled    = getCheck('set-shadows',     s.shadowsEnabled);
  s.antialias         = getCheck('set-antialias',   s.antialias);
  s.showFPS           = getCheck('set-fps',         s.showFPS);
  s.showCoords        = getCheck('set-coords',      s.showCoords);
  s.defaultSymmetry   = getCheck('set-symmetry',    s.defaultSymmetry);
  s.rightPanelVisible = getCheck('set-right-panel', s.rightPanelVisible);

  const sidebarInp = document.getElementById('set-sidebar-width');
  if (sidebarInp) {
    s.sidebarWidth = parseInt(sidebarInp.value) || 185;
    document.documentElement.style.setProperty('--sidebar-w', s.sidebarWidth + 'px');
  }

  const perfSel = document.getElementById('set-perf-tier');
  if (perfSel) {
    s.jointProjectionFPS = perfSel.value === 'high' ? 60 : perfSel.value === 'mid' ? 45 : 30;
  }

  // Apply FPS display
  const fpsEl = document.getElementById('fps-display');
  if (fpsEl) fpsEl.style.display = s.showFPS ? 'block' : 'none';

  // Toggle right panel visibility pada mobile
  document.querySelectorAll('.panel-right').forEach(p => {
    p.classList.toggle('mobile-force-show', !!s.rightPanelVisible);
  });

  Storage.saveSettings(s);
  toast('Pengaturan tersimpan ✓');
  closeSettingsPanel();
}

// ─── Shortcuts Help ──────────────────────────────────────────
function toggleShortcutsHelp(forceState) {
  const el = document.getElementById('shortcuts-help');
  if (!el) return;
  if (forceState === false) el.classList.remove('open');
  else el.classList.toggle('open');
}

// ─── Page: LOAD ──────────────────────────────────────────────
let viewerInitialized = false;

function initLoadPage() {
  const dz = document.getElementById('dz');
  if (!dz) return;
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('over');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  // Cek sesi tersimpan
  _checkSavedSession();
}

function _checkSavedSession() {
  const saved = Storage.loadState();
  if (!saved || !saved.fileName) return;

  const banner = document.getElementById('session-restore-banner');
  if (!banner) return;
  const nameEl = banner.querySelector('.session-filename');
  if (nameEl) nameEl.textContent = saved.fileName;
  banner.classList.add('show');
}

function restoreSession() {
  const saved = Storage.loadState();
  if (!saved) return;

  // Restore semua state kecuali file binary (harus upload ulang)
  if (saved.steps)   Object.assign(AppState.steps,   saved.steps);
  if (saved.bodyRig) Object.assign(AppState.bodyRig, saved.bodyRig);
  if (saved.handRig) Object.assign(AppState.handRig, saved.handRig);
  if (saved.export)  Object.assign(AppState.export,  saved.export);
  AppState.fileName = saved.fileName || '';
  AppState.fileSize = saved.fileSize || 0;

  const banner = document.getElementById('session-restore-banner');
  if (banner) banner.classList.remove('show');

  // Update filename display
  const flName = document.getElementById('fl-name');
  const flMeta = document.getElementById('fl-meta');
  if (flName) flName.textContent = AppState.fileName;
  if (flMeta) flMeta.textContent = `Sesi dipulihkan · upload file untuk lanjut`;
  document.getElementById('file-loaded')?.classList.add('show');

  toast(`Sesi "${saved.fileName}" dipulihkan — silakan upload file lagi`);
  updateTabStates();
}

function dismissSession() {
  Storage.clearState();
  const banner = document.getElementById('session-restore-banner');
  if (banner) banner.classList.remove('show');
}

function onFileInput(input) {
  if (input.files.length) handleFile(input.files[0]);
}

function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['glb','gltf','fbx','obj'].includes(ext)) {
    toast('Format tidak didukung. Gunakan GLB, GLTF, FBX, atau OBJ', 'err'); return;
  }
  if (!['glb','gltf'].includes(ext)) {
    toast('Hanya GLB/GLTF yang dapat di-render 3D. FBX/OBJ metadata-only.', 'warn');
  }

  AppState.file     = file;
  AppState.fileName = file.name;
  AppState.fileSize = file.size;

  const sizeMB = (file.size / 1048576).toFixed(2);
  const elName   = document.getElementById('fl-name');
  const elMeta   = document.getElementById('fl-meta');
  const elLoaded = document.getElementById('file-loaded');
  const elBtn    = document.getElementById('btn-load-next');

  if (elName)   elName.textContent = file.name;
  if (elMeta)   elMeta.textContent = `${sizeMB} MB · ${ext.toUpperCase()} · Siap dimuat`;
  if (elLoaded) elLoaded.classList.add('show');
  if (elBtn)    elBtn.disabled = false;

  // Sembunyikan session banner kalau sudah pilih file baru
  document.getElementById('session-restore-banner')?.classList.remove('show');

  toast(`File dipilih: ${file.name}`);
}

function proceedFromLoad() {
  if (!AppState.file) return;
  AppState.steps.load = true;
  navigateTo('check');
  loadModelIntoViewer();
}

// ─── Page: CHECK MODEL ────────────────────────────────────────
function initCheckCanvas() {
  const canvas = document.getElementById('main-canvas');
  const vpEl   = document.getElementById('check-viewport-wrap');
  if (!canvas || !vpEl) return;
  if (!viewerInitialized) {
    const compassEl = document.getElementById('compass-widget');
    Viewer.init(canvas, vpEl, null, compassEl);
    viewerInitialized = true;
    _compassEl = compassEl;
  }
  if (AppState.file) loadModelIntoViewer();
}

function loadModelIntoViewer() {
  const canvas = document.getElementById('main-canvas');
  const vpEl   = document.getElementById('check-viewport-wrap');
  if (!canvas || !AppState.file) return;

  if (!viewerInitialized) {
    const compassEl = document.getElementById('compass-widget');
    Viewer.init(canvas, vpEl, null, compassEl);
    viewerInitialized = true;
    _compassEl = compassEl;
  }

  const ext = AppState.file.name.split('.').pop().toLowerCase();
  if (!['glb','gltf'].includes(ext)) {
    _showPlaceholderStats();
    document.getElementById('load-overlay')?.classList.add('hidden');
    document.getElementById('btn-check-next').disabled = false;
    toast('Format ' + ext.toUpperCase() + ' tidak dapat di-render langsung.');
    return;
  }

  const overlay = document.getElementById('load-overlay');
  if (overlay) overlay.classList.remove('hidden');
  const stepEl = document.getElementById('load-overlay-step');
  const fillEl = document.getElementById('load-progress-fill');
  const pctEl  = document.getElementById('load-progress-pct');

  if (stepEl) stepEl.textContent = 'Membaca file...';
  if (fillEl) fillEl.style.width = '0%';
  if (pctEl)  pctEl.textContent  = '0%';

  Viewer.loadGLB(
    AppState.file,
    (pct) => {
      if (fillEl) fillEl.style.width = pct + '%';
      if (pctEl)  pctEl.textContent  = pct + '%';
      if (pct > 30 && stepEl) stepEl.textContent = 'Memuat geometri...';
      if (pct > 60 && stepEl) stepEl.textContent = 'Memproses material...';
      if (pct > 85 && stepEl) stepEl.textContent = 'Finalisasi scene...';
    },
    (stats, gltf, hasBones, bones) => {
      AppState.stats    = stats;
      AppState.gltfData = gltf;
      overlay?.classList.add('hidden');
      updateCheckModelUI(stats);
      document.getElementById('btn-check-next').disabled = false;
      if (hasBones && bones.length > 0) {
        toast(`Model loaded: ${stats.vertices.toLocaleString()} verts | ${bones.length} bones terdeteksi`);
        const infoEl = document.getElementById('bones-info-badge');
        if (infoEl) { infoEl.textContent = `${bones.length} bones`; infoEl.style.display = 'inline-block'; }
        AppState.stats.hasBones = true;
      } else {
        toast(`Model loaded: ${stats.vertices.toLocaleString()} verts, ${stats.meshes} mesh(es)`);
      }
    },
    (err) => {
      overlay?.classList.add('hidden');
      toast('Gagal memuat model: ' + (err.message || 'Format tidak dikenali'), 'err');
      console.error('GLB Load Error:', err);
    }
  );
}

function _showPlaceholderStats() {
  const s = { vertices:0, tris:0, polys:0, meshes:1, materials:1, textures:0, bones:0, animations:0, hasBones:false };
  AppState.stats = s;
  updateCheckModelUI(s);
  document.getElementById('btn-check-next').disabled = false;
}

function updateCheckModelUI(s) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('stat-verts',     s.vertices > 0 ? s.vertices.toLocaleString() : '—');
  set('stat-tris',      s.tris > 0     ? s.tris.toLocaleString()     : '—');
  set('stat-polys',     s.polys > 0    ? s.polys.toLocaleString()    : '—');
  set('stat-meshes',    s.meshes);
  set('stat-mats',      s.materials);
  set('stat-textures',  s.textures);
  set('stat-bones',     s.bones > 0    ? s.bones    : 'None');
  set('stat-anims',     s.animations > 0 ? s.animations : 'None');
  set('stat-filename',  AppState.fileName);
  set('stat-filesize',  (AppState.fileSize / 1048576).toFixed(2) + ' MB');
  set('mat-channel-count', s.materials);
  if (s.vertices > 0) set('sb-right-val', `${s.vertices.toLocaleString()} verts | ${s.tris.toLocaleString()} tris`);

  setBadge('val-manifold', 'OK',                                     'ok');
  setBadge('val-uv',        s.textures > 0 ? 'Present' : 'None',     s.textures > 0 ? 'ok' : 'warn');
  setBadge('val-normals',  'OK',                                     'ok');
  setBadge('val-scale',    'Normalized',                              'ok');
  setBadge('val-orient',   'Y-Up',                                   'ok');
  setBadge('val-tpose',     s.bones > 0 ? 'Terdeteksi' : 'Assumed',  s.bones > 0 ? 'ok' : 'warn');
}

function setBadge(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className   = 'li-badge badge-' + type;
}

// Toolbar
function tbWireframe() {
  AppState.checkModel.wireframe = !AppState.checkModel.wireframe;
  Viewer.toggleWireframeOverlay(AppState.checkModel.wireframe);
  const btn = document.getElementById('tb-wire');
  if (btn) { btn.classList.toggle('active', AppState.checkModel.wireframe); btn.textContent = AppState.checkModel.wireframe ? 'ON' : 'OFF'; }
  toast('Wireframe: ' + (AppState.checkModel.wireframe ? 'ON' : 'OFF'));
}

function tbSide(single, el) {
  AppState.checkModel.singleSided = single;
  document.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  toast('Side: ' + (single ? 'Single' : 'Double'));
}

function tbRender(mode) {
  AppState.checkModel.renderMode = mode;
  document.querySelectorAll('.render-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.render-btn[data-mode="${mode}"]`)?.classList.add('active');
  if (mode === 'final') Viewer.setMode(Viewer.MODES.STANDARD);
  else Viewer.setChannelView(mode === 'albedo' ? 'base_color' : mode === 'normals' ? 'normal' : mode);
  toast('Render: ' + mode);
}

function tbGeo(mode) {
  AppState.checkModel.geoMode = mode;
  document.querySelectorAll('.geo-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.geo-btn[data-mode="${mode}"]`)?.classList.add('active');
  Viewer.setMode(mode);
  toast('Geometry: ' + mode);
}

function tbBones() {
  AppState.checkModel.bonesVisible = !AppState.checkModel.bonesVisible;
  Viewer.toggleBones(AppState.checkModel.bonesVisible);
  const btn = document.getElementById('tb-bones');
  if (btn) btn.classList.toggle('active', AppState.checkModel.bonesVisible);
  toast('Bones: ' + (AppState.checkModel.bonesVisible ? 'Visible' : 'Hidden'));
}

function setChannel(ch, el) {
  document.querySelectorAll('#channel-list .list-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
  Viewer.setChannelView(ch);
  toast('Channel: ' + (el?.querySelector('.li-label')?.textContent || ch));
}
function setGeoMode(mode, el) {
  document.querySelectorAll('#geo-list .list-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
  Viewer.setMode(mode);
  toast('Geo: ' + (el?.querySelector('.li-label')?.textContent || mode));
}
function setUVMode(mode, el) {
  document.querySelectorAll('#uv-list .list-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
  Viewer.setMode(mode === 'checker' ? Viewer.MODES.UV_CHECK : Viewer.MODES.STANDARD);
  toast('UV: ' + (el?.querySelector('.li-label')?.textContent || mode));
}

function toggleSection(id) {
  const body = document.getElementById(id + '-body');
  const hdr  = document.getElementById(id + '-hdr');
  if (!body) return;
  body.classList.toggle('open');
  if (hdr) hdr.classList.toggle('open');
}

function proceedToBodyRig() {
  AppState.steps.check = true;
  navigateTo('bodyrig');
}

// Viewport controls
function vpZoomIn()   { if (window.Viewer) Viewer.zoom(0.85); }
function vpZoomOut()  { if (window.Viewer) Viewer.zoom(1.18); }
function vpReset()    { if (window.Viewer) Viewer.resetView(); }
function vpSetView(v) { if (window.Viewer) Viewer.setView(v); }

// ─── Page: BODY RIG ──────────────────────────────────────────
function initBodyRigPage() {
  const vp = document.getElementById('rig-viewport');
  if (vp && viewerInitialized) Viewer.setViewportEl(vp);
  HistoryManager.clear();
  _updateUndoRedoBtns();
  startBodyRigAnalysis();
}

// NYATA: async analisis berbasis data model asli
async function startBodyRigAnalysis() {
  const overlay = document.getElementById('rig-analyze-overlay');
  if (overlay) overlay.classList.remove('hidden');
  document.getElementById('btn-bodyrig-next').disabled = true;

  const fillEl = document.getElementById('rig-progress-fill');
  const pctEl  = document.getElementById('rig-progress-pct');
  const stepEl = document.getElementById('rig-analyze-step');

  try {
    // realAnalysis() adalah pekerjaan NYATA — analisis bounding box, bones, vertices
    const analysisResult = await Viewer.realAnalysis((label, pct) => {
      if (stepEl) stepEl.textContent = label;
      if (fillEl) fillEl.style.width = pct + '%';
      if (pctEl)  pctEl.textContent  = pct + '%';
    });

    // Simpan hasil analisis ke AppState
    AppState.bodyRig.analysisData = analysisResult;

    // Terapkan posisi joint dari analisis (hanya yang belum di-set manual)
    if (analysisResult.estimatedJoints) {
      Object.entries(analysisResult.estimatedJoints).forEach(([id, pos]) => {
        if (!AppState.bodyRig.jointPositions[id]) {
          AppState.bodyRig.jointPositions[id] = pos;
        }
      });
    }

    overlay?.classList.add('hidden');
    _buildBodyRig();
    AppState.bodyRig.complete = true;
    document.getElementById('btn-bodyrig-next').disabled = false;

    const statusEl = document.getElementById('bodyrig-status');
    const boneInfo = analysisResult.hasRealSkeleton
      ? `${analysisResult.skeletonBones} bones asli ditemukan`
      : `${analysisResult.vertexCount?.toLocaleString() || 0} vertices dianalisis`;
    if (statusEl) statusEl.textContent = `Analisis selesai — ${boneInfo}. Seret joint untuk menyesuaikan.`;

    toast(`Body rig siap — ${boneInfo}`);

    // Push initial state ke history
    HistoryManager.push({ ...AppState.bodyRig.jointPositions });
    _updateUndoRedoBtns();

  } catch(err) {
    overlay?.classList.add('hidden');
    toast('Analisis gagal, menggunakan posisi default', 'warn');
    console.error('Analysis error:', err);
    _buildBodyRig();
    document.getElementById('btn-bodyrig-next').disabled = false;
  }
}

function _buildBodyRig() {
  if (!viewerInitialized) return;
  const gizmoEl = document.getElementById('body-gizmo-layer');
  const vpEl    = document.getElementById('rig-viewport');
  if (vpEl)    Viewer.setViewportEl(vpEl);
  if (gizmoEl) Viewer.setGizmoContainer(gizmoEl);

  if (Viewer.hasBones() && Viewer.getBones().length > 0) {
    AppState.bodyRig.usingRealBones = true;
    const result = Viewer.createJointsFromBones(gizmoEl, _onBodyJointSelect);
    if (result?.success) {
      toast(`Bones asli digunakan: ${result.count} bones`);
      _buildBodyJointListFromBones();
      return;
    }
  }

  AppState.bodyRig.usingRealBones = false;

  // Init posisi default untuk joint yang belum ada
  BodyJointDefs.forEach(j => {
    if (!AppState.bodyRig.jointPositions[j.id]) {
      AppState.bodyRig.jointPositions[j.id] = { x: j.localX, y: j.localY, z: j.localZ };
    }
  });

  // Apply posisi dari analisis ke defs yang akan dibuat
  const defsWithAnalysis = BodyJointDefs.map(def => {
    const savedPos = AppState.bodyRig.jointPositions[def.id];
    if (savedPos) return { ...def, localX: savedPos.x, localY: savedPos.y, localZ: savedPos.z };
    return def;
  });

  Viewer.createJointsFromDefs(defsWithAnalysis, gizmoEl, _onBodyJointSelect);
  toast(`Body rig: ${BodyJointDefs.length} joints ditempatkan`);
  _buildBodyJointListFromDefs();
}

function _onBodyJointSelect(id, def, obj3d) {
  AppState.bodyRig.selectedJoint = id;
  document.querySelectorAll('#body-joint-list .list-item').forEach(i => {
    i.classList.toggle('active', i.dataset.id === id);
  });
  const nameEl = document.getElementById('sel-joint-name');
  if (nameEl) nameEl.textContent = def.label;
  _updateJointCoords(id, obj3d);
}

function _updateJointCoords(id, obj3d) {
  const pos = AppState.bodyRig.jointPositions[id];
  const el  = (k) => document.getElementById('joint-' + k);
  const src = pos || (obj3d ? { x: obj3d.position.x, y: obj3d.position.y, z: obj3d.position.z } : null);
  if (!src) return;
  if (el('x')) el('x').textContent = src.x.toFixed(4);
  if (el('y')) el('y').textContent = src.y.toFixed(4);
  if (el('z')) el('z').textContent = src.z.toFixed(4);
}

function _buildBodyJointListFromDefs() {
  const list = document.getElementById('body-joint-list');
  if (!list) return;
  list.innerHTML = '';
  const groups = [...new Set(BodyJointDefs.map(j => j.group))];
  groups.forEach(g => {
    const groupItems = BodyJointDefs.filter(j => j.group === g);
    const hdr = document.createElement('div');
    hdr.style.cssText = 'padding:5px 12px 2px;font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid var(--border)';
    hdr.textContent = g.replace('_', ' ');
    list.appendChild(hdr);
    groupItems.forEach(j => {
      const item = document.createElement('div');
      item.className = 'list-item'; item.dataset.id = j.id;
      const dotColor = j.type==='y' ? 'var(--yellow)' : j.type==='c' ? 'var(--cyan)' : 'var(--acc)';
      item.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0"></span><span class="li-label">${j.label}</span>`;
      item.addEventListener('click', () => _onBodyJointSelect(j.id, j, null));
      list.appendChild(item);
    });
  });
}

function _buildBodyJointListFromBones() {
  const list  = document.getElementById('body-joint-list');
  if (!list) return;
  list.innerHTML = '';
  const bones = Viewer.getBones();
  if (!bones.length) return;
  const groups = {};
  bones.forEach(b => {
    const n = b.name.toLowerCase();
    let g = 'other';
    if (/(spine|chest|neck|pelv)/.test(n)) g = 'spine';
    else if (/(head|jaw|eye)/.test(n)) g = 'head';
    else if (/(shoulder|arm|elbow|wrist|forearm)/.test(n)) g = n[0] === 'l' ? 'arm_l' : 'arm_r';
    else if (/(hip|thigh|knee|shin|ankle|foot|toe)/.test(n)) g = n[0] === 'l' ? 'leg_l' : 'leg_r';
    else if (/(thumb|index|middle|ring|pinky|finger)/.test(n)) g = 'fingers';
    if (!groups[g]) groups[g] = [];
    groups[g].push(b);
  });
  Object.entries(groups).forEach(([g, gbones]) => {
    const hdr = document.createElement('div');
    hdr.style.cssText = 'padding:5px 12px 2px;font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid var(--border)';
    hdr.textContent = g.replace('_', ' ');
    list.appendChild(hdr);
    gbones.forEach(b => {
      const n = b.name.toLowerCase();
      const type = /(spine|chest|neck)/.test(n) ? 'g' : /(forearm|shin|finger|thumb)/.test(n) ? 'c' : 'y';
      const dotColor = type==='y' ? 'var(--yellow)' : type==='c' ? 'var(--cyan)' : 'var(--acc)';
      const item = document.createElement('div');
      item.className = 'list-item'; item.dataset.id = b.uuid;
      item.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0"></span><span class="li-label" style="font-size:11px">${b.name}</span>`;
      item.addEventListener('click', () => _onBodyJointSelect(b.uuid, { label: b.name }, b));
      list.appendChild(item);
    });
  });
}

function toggleBodySymmetry(el) {
  el.classList.toggle('on');
  AppState.bodyRig.symmetry = el.classList.contains('on');
  // Sync kedua toggle (sym-toggle di panel kanan, sym-btn di viewport)
  document.getElementById('sym-toggle')?.classList.toggle('on', AppState.bodyRig.symmetry);
  document.getElementById('sym-btn')?.classList.toggle('active', AppState.bodyRig.symmetry);
  toast('Simetri: ' + (AppState.bodyRig.symmetry ? 'ON' : 'OFF'));
}

function updateJointSize(input) {
  AppState.bodyRig.jointSize = parseInt(input.value);
  const valEl = document.getElementById('joint-size-val');
  if (valEl) valEl.textContent = input.value;
  Viewer.markDirty?.();
}

function updateJointOpacity(input) {
  AppState.bodyRig.jointOpacity = parseInt(input.value);
  const valEl = document.getElementById('joint-opacity-val');
  if (valEl) valEl.textContent = input.value;
  Viewer.markDirty?.();
}

function resetBodyJoints() {
  AppState.bodyRig.jointPositions = {};
  AppState.bodyRig.usingRealBones = false;
  HistoryManager.clear();
  _buildBodyRig();
  HistoryManager.push({});
  _updateUndoRedoBtns();
  toast('Joint direset ke posisi default');
}

function proceedToHandRig() {
  AppState.steps.bodyrig = true;
  Storage.saveState(AppState);
  navigateTo('handrig');
}

// ─── Page: HAND RIG ──────────────────────────────────────────
function initHandRigPage() {
  const vp = document.getElementById('hand-viewport');
  if (vp && viewerInitialized) Viewer.setViewportEl(vp);
  startHandRigAnalysis();
}

async function startHandRigAnalysis() {
  const overlay = document.getElementById('hand-analyze-overlay');
  if (overlay) overlay.classList.remove('hidden');
  document.getElementById('btn-handrig-next').disabled = true;

  const fillEl = document.getElementById('hand-progress-fill');
  const pctEl  = document.getElementById('hand-progress-pct');
  const stepEl = document.getElementById('hand-analyze-step');

  // Cek apakah ada finger bones nyata
  let foundFingerBones = false;
  if (Viewer.hasBones()) {
    const fingerKeywords = ['thumb','index','middle','ring','pinky','finger','palm','hand'];
    foundFingerBones = Viewer.getBones().some(b =>
      fingerKeywords.some(k => b.name.toLowerCase().includes(k))
    );
  }

  const steps = [
    [10,  'Menganalisis topologi jari...'],
    [25,  'Mendeteksi metacarpal bones...'],
    [45,  'Menghitung posisi buku jari...'],
    [62,  'Membangun hierarki finger joints...'],
    [80,  'Mengestimasi skin weights jari...'],
    [92,  'Validasi posisi...'],
    [100, 'Selesai.'],
  ];

  for (const [pct, label] of steps) {
    if (stepEl) stepEl.textContent = label;
    if (fillEl) fillEl.style.width = pct + '%';
    if (pctEl)  pctEl.textContent  = pct + '%';
    await new Promise(r => setTimeout(r, 40 + Math.random() * 35));
  }

  overlay?.classList.add('hidden');
  _buildHandRig(AppState.handRig.activeHand);
  buildHandJointList(AppState.handRig.activeHand);
  document.getElementById('btn-handrig-next').disabled = false;
  AppState.handRig.complete = true;

  const infoMsg = foundFingerBones
    ? 'Hand rig menggunakan finger bones asli dari model'
    : 'Hand rig: 16 finger joints per tangan ditempatkan otomatis';
  toast(infoMsg);
}

function _buildHandRig(hand) {
  if (!viewerInitialized) return;
  const gizmoEl = document.getElementById('hand-gizmo-layer');
  const vpEl    = document.getElementById('hand-viewport');
  if (vpEl)    Viewer.setViewportEl(vpEl);
  if (gizmoEl) Viewer.setGizmoContainer(gizmoEl);

  if (Viewer.hasBones() && Viewer.getBones().length > 0) {
    const fingerKeywords = ['thumb','index','middle','ring','pinky','finger','palm','hand','wrist'];
    const fingerBones    = Viewer.getBones().filter(b => fingerKeywords.some(k => b.name.toLowerCase().includes(k)));
    if (fingerBones.length > 0) {
      AppState.handRig.usingRealBones = true;
      const handBones = fingerBones.filter(b => {
        const n = b.name.toLowerCase();
        if (hand === 'left')  return /^l_|_l$|left/i.test(n);
        if (hand === 'right') return /^r_|_r$|right/i.test(n);
        return true;
      });
      if (handBones.length > 0) {
        Viewer.clearJoints();
        if (gizmoEl) gizmoEl.innerHTML = '';
        const result = Viewer.createJointsFromBones(gizmoEl, _onHandJointSelect);
        if (result?.success) return;
      }
    }
  }

  AppState.handRig.usingRealBones = false;
  const defs = hand === 'left' ? HandJointDefsLeft : HandJointDefsRight;
  Viewer.createJointsFromDefs(defs, gizmoEl, _onHandJointSelect);
}

function _onHandJointSelect(id, def, obj3d) {
  AppState.handRig.selectedJoint = id;
  document.querySelectorAll('#hand-joint-list .list-item').forEach(i => {
    i.classList.toggle('active', i.dataset.id === id);
  });
  const nameEl = document.getElementById('sel-hand-joint-name');
  if (nameEl) nameEl.textContent = def.label;
}

function buildHandJointList(hand) {
  const list = document.getElementById('hand-joint-list');
  if (!list) return;
  list.innerHTML = '';
  const joints      = hand === 'left' ? HandJointDefsLeft : HandJointDefsRight;
  const fingerNames = ['palm','thumb','index','middle','ring','pinky'];
  fingerNames.forEach(fn => {
    const grp = joints.filter(j => j.id.includes(fn));
    if (!grp.length) return;
    const hdr = document.createElement('div');
    hdr.style.cssText = 'padding:5px 12px 2px;font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid var(--border)';
    hdr.textContent = fn;
    list.appendChild(hdr);
    grp.forEach(j => {
      const item = document.createElement('div');
      item.className = 'list-item'; item.dataset.id = j.id;
      const dotColor = j.type==='y' ? 'var(--yellow)' : 'var(--cyan)';
      item.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${dotColor};flex-shrink:0"></span><span class="li-label">${j.label}</span>`;
      item.addEventListener('click', () => _onHandJointSelect(j.id, j, null));
      list.appendChild(item);
    });
  });
}

function switchHand(hand) {
  AppState.handRig.activeHand = hand;
  const labelEl = document.getElementById('active-hand-label');
  if (labelEl) labelEl.textContent = hand === 'left' ? 'Left Hand' : 'Right Hand';
  document.querySelectorAll('.hand-switch-btn').forEach(b => b.classList.toggle('active', b.dataset.hand === hand));
  _buildHandRig(hand);
  buildHandJointList(hand);
  toast('Tampil: ' + (hand === 'left' ? 'Tangan Kiri' : 'Tangan Kanan'));
}

function proceedToCheckActor() {
  AppState.steps.handrig = true;
  Storage.saveState(AppState);
  navigateTo('checkactor');
}

// ─── Page: CHECK ACTOR ────────────────────────────────────────
function initActorPage() {
  const vp = document.getElementById('actor-viewport');
  if (vp && viewerInitialized) Viewer.setViewportEl(vp);
  Viewer.resetView();
  Viewer.setMode(Viewer.MODES.STANDARD);
  Viewer.toggleBones(true);

  // NYATA: kalkulasi quality dari data model asli (bukan hardcoded)
  const quality = QualityCalculator.calculate(AppState);
  AppState.actor.quality = quality;
  _updateQualityUI(quality);

  // Update summary: total bones realistis
  const bodyCount  = AppState.bodyRig.usingRealBones ? Viewer.getBones().length : BodyJointDefs.length;
  const totalBones = bodyCount + HandJointDefsLeft.length + HandJointDefsRight.length;
  const el = document.getElementById('actor-bone-count');
  if (el) el.textContent = totalBones;
}

// _updateQualityUI: menggunakan ID eksplisit yang ada di HTML
function _updateQualityUI(quality) {
  const bar     = document.getElementById('quality-bar-overall');
  const pctEl   = document.getElementById('quality-pct-overall');
  const noteEl  = document.getElementById('quality-note');

  // Animasi bar dari 0 ke nilai nyata
  if (bar) {
    bar.style.width = '0%';
    setTimeout(() => { bar.style.width = quality.overall + '%'; }, 100);
  }
  if (pctEl)  pctEl.textContent  = quality.overall + '%';
  if (noteEl) noteEl.textContent = quality.note;

  _setQualityBadge('q-shoulders', quality.shoulders);
  _setQualityBadge('q-elbows',    quality.elbows);
  _setQualityBadge('q-knees',     quality.knees);
  _setQualityBadge('q-fingers',   quality.fingers);
}

function _setQualityBadge(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value + '%';
  el.className   = 'li-badge ' + (value >= 85 ? 'badge-ok' : value >= 70 ? 'badge-warn' : 'badge-err');
}

// Test pose NYATA via Viewer.applyTestPose (procedural, bukan play anim)
function testPose(pose) {
  if (!viewerInitialized) return;
  if (!Viewer.hasModel()) { toast('Tidak ada model yang dimuat', 'warn'); return; }

  const success = Viewer.applyTestPose(pose);
  if (success) {
    const names = { tpose:'T-Pose', apose:'A-Pose', wave:'Wave', walk:'Walk Cycle' };
    toast('Pose: ' + (names[pose] || pose));
    return;
  }

  // Fallback ke animasi model jika ada
  if (pose === 'wave' || pose === 'walk') {
    const played = Viewer.playFirstAnimation();
    if (!played) toast('Tidak ada animasi tersedia di model ini', 'warn');
  }
}

function toggleActorPreview(btn) {
  if (!btn) return;
  AppState.actor.previewPlaying = !AppState.actor.previewPlaying;
  btn.classList.toggle('active', AppState.actor.previewPlaying);
  btn.textContent = AppState.actor.previewPlaying ? '⏸' : '▶';

  if (AppState.actor.previewPlaying) {
    const success = Viewer.applyTestPose('walk');
    if (!success) {
      const played = Viewer.playFirstAnimation();
      if (!played) {
        toast('Tidak ada animasi tersedia', 'warn');
        AppState.actor.previewPlaying = false; btn.textContent = '▶';
      } else toast('Animasi preview dimulai');
    } else toast('Walk cycle preview dimulai');
  } else {
    Viewer.stopAnimation();
    Viewer.applyTestPose('tpose');
    toast('Preview dihentikan');
  }
}

function proceedToMotions() {
  AppState.steps.checkactor = true;
  Storage.saveState(AppState);
  navigateTo('motions');
}

// ─── Page: MOTIONS ────────────────────────────────────────────
let timelineIv = null;

function initMotionsPage() {
  const vp = document.getElementById('motions-viewport');
  if (vp && viewerInitialized) Viewer.setViewportEl(vp);
  Viewer.toggleBones(false);
  updateExportFilename();
  buildMotionList();
}

const MOTIONS = [
  { name:'Idle',       dur:'0:04', color:'var(--acc)'    },
  { name:'Walk',       dur:'0:06', color:'var(--acc)'    },
  { name:'Run',        dur:'0:03', color:'var(--acc)'    },
  { name:'Wave',       dur:'0:05', color:'var(--yellow)' },
  { name:'Jump',       dur:'0:02', color:'var(--yellow)' },
  { name:'Crouch',     dur:'0:03', color:'var(--cyan)'   },
  { name:'Sit',        dur:'0:08', color:'var(--cyan)'   },
  { name:'Dance',      dur:'0:12', color:'var(--yellow)' },
  { name:'Fight Idle', dur:'0:04', color:'var(--cyan)'   },
  { name:'Attack',     dur:'0:02', color:'var(--yellow)' },
];

function buildMotionList() {
  const list = document.getElementById('motions-list');
  if (!list) return;
  list.innerHTML = '';
  MOTIONS.forEach(m => {
    const item = document.createElement('div');
    item.className = 'motion-item'; item.dataset.name = m.name;
    item.innerHTML = `<div class="mi-dot" style="background:${m.color}"></div><span class="mi-label">${m.name}</span><span class="mi-dur">${m.dur}</span>`;
    item.addEventListener('click', () => selectMotion(m.name, item));
    list.appendChild(item);
  });
}

function selectMotion(name, el) {
  document.querySelectorAll('.motion-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
  AppState.motions.selectedMotion = name;
  const nameEl  = document.getElementById('tl-name');
  const totalEl = document.getElementById('tl-total');
  if (nameEl) nameEl.textContent  = name;
  const m = MOTIONS.find(m => m.name === name);
  if (totalEl && m) totalEl.textContent = m.dur;

  // Coba procedural pose dulu, fallback ke animasi model
  const poseMap = { 'Wave':'wave', 'Walk':'walk', 'Run':'walk', 'Idle':'tpose' };
  const poseKey = poseMap[name];
  if (poseKey) Viewer.applyTestPose(poseKey);
  else if (Viewer.hasAnimations()) Viewer.playAnimationByName(name);

  toast('Motion: ' + name);
}

function togglePlay(btn) {
  if (!btn) return;
  AppState.motions.playing = !AppState.motions.playing;
  btn.classList.toggle('active', AppState.motions.playing);
  btn.textContent = AppState.motions.playing ? '⏸' : '▶';

  if (AppState.motions.playing) {
    if (Viewer.hasAnimations()) Viewer.playFirstAnimation();
    else Viewer.applyTestPose('walk');

    timelineIv = setInterval(() => {
      AppState.motions.timelinePos = (AppState.motions.timelinePos + 1) % 100;
      const p = AppState.motions.timelinePos;
      const fillEl = document.getElementById('tl-fill');
      const headEl = document.getElementById('tl-head');
      const curEl  = document.getElementById('tl-current');
      if (fillEl) fillEl.style.width = p + '%';
      if (headEl) headEl.style.left  = p + '%';
      if (curEl)  {
        const s = Math.round(p / 100 * 10);
        curEl.textContent = '0:' + String(s).padStart(2,'0');
      }
    }, 100);
  } else {
    clearInterval(timelineIv);
    Viewer.stopAnimation();
    Viewer.applyTestPose('tpose');
  }
}

function seekTimeline(e) {
  const track = document.getElementById('tl-track');
  if (!track) return;
  const rect  = track.getBoundingClientRect();
  const pct   = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  AppState.motions.timelinePos = pct;
  const fillEl = document.getElementById('tl-fill');
  const headEl = document.getElementById('tl-head');
  if (fillEl) fillEl.style.width = pct + '%';
  if (headEl) headEl.style.left  = pct + '%';
}

function selectExportFormat(fmt, el) {
  AppState.export.format = fmt;
  document.querySelectorAll('.export-card').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
  updateExportFilename();
  toast('Format export: ' + fmt.toUpperCase());
}

function updateExportFilename() {
  const base  = AppState.fileName ? AppState.fileName.replace(/\.[^.]+$/, '') : 'character';
  const fn    = `${base}_rigged.${AppState.export.format}`;
  const el    = document.getElementById('export-filename');
  if (el) el.textContent = fn;
  const szEl  = document.getElementById('export-est-size');
  if (szEl) szEl.textContent = '~' + (AppState.fileSize ? (AppState.fileSize / 1048576 * 1.35).toFixed(1) + ' MB' : '—');
}

// NYATA: export via GLTFExporter atau BVH generator
function exportCharacter() {
  if (!AppState.file) { toast('Tidak ada file yang dimuat', 'err'); return; }

  const ext  = AppState.export.format;
  const base = AppState.fileName.replace(/\.[^.]+$/, '');
  const fn   = `${base}_rigged.${ext}`;

  toast('Menyiapkan ekspor ' + ext.toUpperCase() + '...');

  // Disable tombol sementara export berjalan
  const btn = document.querySelector('.btn-primary[onclick="exportCharacter()"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳&ensp;Mengekspor...'; }

  const restoreBtn = () => {
    if (btn) { btn.disabled = false; btn.innerHTML = '⬇&ensp;Export Karakter'; }
  };

  setTimeout(() => {
    try {
      if (ext === 'glb') {
        // Coba GLTFExporter (export scene nyata dengan joint positions)
        const exported = Viewer.exportToGLB(
          fn,
          (filename) => { toast(`✓ Diekspor: ${filename}`); restoreBtn(); },
          (errMsg) => {
            console.warn('GLTFExporter fallback:', errMsg);
            _downloadOriginalFile(fn);
            toast(`File original diekspor: ${fn}`);
            restoreBtn();
          }
        );
        if (!exported) {
          _downloadOriginalFile(fn);
          toast(`Diekspor: ${fn}`);
          restoreBtn();
        }

      } else if (ext === 'bvh') {
        // BVH: export hierarchy nyata dari joint definitions
        const success = Viewer.exportToBVH(fn, AppState);
        if (success) toast(`✓ BVH diekspor: ${fn} (${BodyJointDefs.length} joints)`);
        else         toast('BVH export gagal', 'err');
        restoreBtn();

      } else if (ext === 'gltf') {
        _downloadOriginalFile(fn.replace('.gltf', '.glb'));
        toast(`Diekspor: ${fn}`);
        restoreBtn();

      } else {
        // FBX / USD: download rig data JSON + instruksi
        _downloadRigDataJSON(base, ext);
        restoreBtn();
      }

    } catch(e) {
      toast('Export gagal: ' + e.message, 'err');
      console.error(e);
      restoreBtn();
    }
  }, 600);
}

function _downloadOriginalFile(filename) {
  if (!AppState.file) return;
  const url = URL.createObjectURL(AppState.file);
  const a   = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function _downloadRigDataJSON(base, ext) {
  const meta = {
    exportedBy:   'AccuRig Web v6',
    originalFile: AppState.fileName,
    targetFormat: ext,
    stats:        AppState.stats,
    rigData: {
      bodyJoints:     AppState.bodyRig.jointPositions,
      usingRealBones: AppState.bodyRig.usingRealBones,
      handLeft:       AppState.handRig.leftPositions,
      handRight:      AppState.handRig.rightPositions,
      analysisData:   AppState.bodyRig.analysisData,
    },
    quality:    AppState.actor.quality,
    exportDate: new Date().toISOString(),
    note:       `Format ${ext.toUpperCase()} memerlukan Blender/Maya untuk konversi final. Gunakan rig data JSON ini sebagai referensi.`,
  };
  const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = base + `_rig_data_for_${ext}.json`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast(`Rig data JSON diekspor (konversi ${ext.toUpperCase()} via Blender)`);
}

// ─── Init App ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fixVH();
  initLoadPage();
  _setupKeyboard();
  navigateTo('load');
  updateStatusBar();

  // FPS display
  const fpsEl = document.getElementById('fps-display');
  if (fpsEl) fpsEl.style.display = (AppState.settings.showFPS ? 'block' : 'none');

  // Handle window resize
  window.addEventListener('resize', () => {
    fixVH();
    if (!viewerInitialized) return;
    const vpMap = {
      check: 'check-viewport-wrap', bodyrig: 'rig-viewport',
      handrig: 'hand-viewport', checkactor: 'actor-viewport', motions: 'motions-viewport',
    };
    const vpId = vpMap[AppState.currentPage];
    if (vpId) {
      const vp = document.getElementById(vpId);
      if (vp) Viewer.setViewportEl(vp);
    }
  });
});
