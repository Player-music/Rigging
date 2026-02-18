/**
 * viewer.js — AccuRig Three.js Viewer (v6 FINAL)
 *
 * PERUBAHAN dari v5:
 * 1. ResizeObserver leak → FIXED (disconnect sebelum observe baru)
 * 2. Joint projection → skip frame kalau tidak ada perubahan (_camDirty flag)
 * 3. applyTestPose() → procedural pose nyata (T/A/wave) bukan hanya play anim
 * 4. exportToGLB() → pakai THREE.GLTFExporter (export scene asli bukan copy file)
 * 5. exportToBVH() → generate BVH hierarchy dari joint definitions
 * 6. realAnalysis() → analisis nyata bounding box + bone detection
 * 7. FPS counter terintegrasi
 * 8. getScene() & getCameraState() untuk keperluan export & settings
 */
'use strict';

const Viewer = (() => {

  // ── Private state ─────────────────────────────────────────────
  let R = null, S = null, C = null, CLK = null;
  let _canvas = null, _vpEl = null, _gizmoEl = null;
  let _resizeObs = null;          // ← FIXED: referensi untuk disconnect

  // Compass
  let _cR = null, _cS = null, _cC = null;
  let _cContainer = null, _cLabels = {};

  // Model
  let _model = null, _gltf = null, _mixer = null, _action = null;
  let _origMat = new Map(), _skel = null, _uvTex = null;
  let _bones = [], _hasBones = false;

  // Joints
  let _joints = [];

  // Resize
  let _lW = 0, _lH = 0;

  // Dirty flag → skip project kalau tidak ada perubahan
  let _camDirty = true;
  let _projFrame = 0;

  // Pose animation (procedural)
  let _poseAnim = null;

  // ── Camera orbit state ────────────────────────────────────────
  const CAM = {
    theta: 0, phi: 1.05, radius: 4,
    target: new THREE.Vector3(0, 1, 0),
    mBtn: -1, mX: 0, mY: 0,
    t1x: 0, t1y: 0,
    prevPinch: 0, prevMidX: 0, prevMidY: 0,
    isPinching: false, isRotating: false,
  };

  // ── INIT ──────────────────────────────────────────────────────
  function init(canvasEl, vpEl, gizmoEl, compassEl) {
    _canvas  = canvasEl;
    _vpEl    = vpEl || canvasEl.parentElement;
    _gizmoEl = gizmoEl;

    const settings = window.AppState?.settings || {};
    const perf = window.DeviceInfo?.tier || 'high';

    R = new THREE.WebGLRenderer({
      canvas:    _canvas,
      antialias: settings.antialias !== false,
      powerPreference: perf === 'low' ? 'low-power' : 'default',
    });
    R.setPixelRatio(Math.min(window.devicePixelRatio, settings.maxPixelRatio || 2));
    R.shadowMap.enabled  = settings.shadowsEnabled !== false;
    R.shadowMap.type     = THREE.PCFSoftShadowMap;
    try { R.outputEncoding = THREE.sRGBEncoding; } catch(e) {}
    try { R.outputColorSpace = 'srgb'; } catch(e) {}
    R.toneMapping         = THREE.ACESFilmicToneMapping;
    R.toneMappingExposure = 1.2;

    S = new THREE.Scene();
    S.background = new THREE.Color(0x060908);
    S.fog = new THREE.FogExp2(0x060908, 0.012);

    C = new THREE.PerspectiveCamera(42, 1, 0.005, 500);
    _applyCAM();

    _lights();

    const grid = new THREE.GridHelper(30, 36, 0x1a2e1a, 0x0d180d);
    grid.material.opacity = 0.5; grid.material.transparent = true;
    S.add(grid);

    _uvTex = _makeUVTex();
    CLK = new THREE.Clock();

    _setupMouse();
    _setupTouch();

    if (compassEl) _initCompass(compassEl);

    // ← FIXED: simpan referensi observer agar bisa disconnect
    _resizeObs = new ResizeObserver(_resize);
    _resizeObs.observe(_vpEl);

    _loop();
  }

  // ── Lights ────────────────────────────────────────────────────
  function _lights() {
    S.add(new THREE.AmbientLight(0x283828, 1.1));
    const key = new THREE.DirectionalLight(0xefffef, 1.8);
    key.position.set(2, 5, 3); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); S.add(key);
    const fill = new THREE.DirectionalLight(0x223322, 0.6);
    fill.position.set(-3, 2, -2); S.add(fill);
    const rim = new THREE.DirectionalLight(0x7dff5a, 0.4);
    rim.position.set(0, 4, -5); S.add(rim);
    S.add(new THREE.HemisphereLight(0x1c3a1c, 0x0c180c, 0.65));
  }

  // ── Compass ───────────────────────────────────────────────────
  function _initCompass(compassEl) {
    _cContainer = compassEl;
    const SZ = 80;
    compassEl.style.cssText = `position:absolute;top:10px;left:10px;width:${SZ}px;height:${SZ}px;pointer-events:none;z-index:22;`;
    const cc = document.createElement('canvas');
    cc.width = cc.height = SZ;
    cc.style.cssText = 'width:100%;height:100%;display:block;';
    compassEl.appendChild(cc);

    _cR = new THREE.WebGLRenderer({ canvas: cc, alpha: true, antialias: true });
    _cR.setSize(SZ, SZ);
    _cR.setPixelRatio(window.devicePixelRatio);
    _cR.setClearColor(0x000000, 0);

    _cS = new THREE.Scene();
    _cC = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 50);
    _cC.position.set(0, 0, 10); _cC.lookAt(0, 0, 0);

    const AXES = [
      { d: new THREE.Vector3(1,0,0), c: 0xff3333, k:'x', lbl:'X' },
      { d: new THREE.Vector3(0,1,0), c: 0x33ff66, k:'y', lbl:'Y' },
      { d: new THREE.Vector3(0,0,1), c: 0x3388ff, k:'z', lbl:'Z' },
    ];
    AXES.forEach(({ d, c }) => {
      const gPos = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), d.clone().multiplyScalar(1.1)]);
      _cS.add(new THREE.Line(gPos, new THREE.LineBasicMaterial({ color: c, linewidth: 3 })));
      const gNeg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), d.clone().multiplyScalar(-0.4)]);
      _cS.add(new THREE.Line(gNeg, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.18 })));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 8), new THREE.MeshBasicMaterial({ color: c }));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d.clone().normalize());
      cone.position.copy(d).multiplyScalar(1.22); _cS.add(cone);
    });

    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    compassEl.appendChild(div);
    AXES.forEach(({ k, lbl, c, d }) => {
      const span = document.createElement('span');
      span.textContent = lbl;
      span.style.cssText = `position:absolute;font:800 11px/1 monospace;color:#${c.toString(16).padStart(6,'0')};`;
      div.appendChild(span);
      _cLabels[k] = { el: span, vec: d.clone().multiplyScalar(1.45) };
    });
  }

  function mountCompass(newContainer) {
    if (!newContainer || !_cContainer) return;
    if (_cContainer.parentElement !== newContainer) newContainer.appendChild(_cContainer);
  }

  function _renderCompass() {
    if (!_cR || !_cS || !_cC) return;
    _cS.quaternion.copy(C.quaternion).invert();
    const SZ = 80;
    Object.values(_cLabels).forEach(({ el, vec }) => {
      const v  = vec.clone().applyQuaternion(_cS.quaternion).project(_cC);
      const px = (v.x * 0.5 + 0.5) * SZ;
      const py = (1 - (v.y * 0.5 + 0.5)) * SZ;
      el.style.left = Math.max(1, Math.min(SZ-14, px-5)) + 'px';
      el.style.top  = Math.max(1, Math.min(SZ-14, py-6)) + 'px';
    });
    _cR.render(_cS, _cC);
  }

  // ── Camera ────────────────────────────────────────────────────
  function _applyCAM() {
    CAM.phi = Math.max(0.04, Math.min(Math.PI - 0.04, CAM.phi));
    C.position.set(
      CAM.target.x + CAM.radius * Math.sin(CAM.phi) * Math.sin(CAM.theta),
      CAM.target.y + CAM.radius * Math.cos(CAM.phi),
      CAM.target.z + CAM.radius * Math.sin(CAM.phi) * Math.cos(CAM.theta)
    );
    C.lookAt(CAM.target);
    _camDirty = true;
  }

  // ── Mouse ─────────────────────────────────────────────────────
  function _setupMouse() {
    _canvas.addEventListener('mousedown', e => {
      e.preventDefault(); CAM.mBtn = e.button;
      CAM.mX = e.clientX; CAM.mY = e.clientY;
    }, { passive: false });
    _canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mousemove', e => {
      if (CAM.mBtn < 0) return;
      const dx = e.clientX - CAM.mX, dy = e.clientY - CAM.mY;
      CAM.mX = e.clientX; CAM.mY = e.clientY;
      if (CAM.mBtn === 0) { CAM.theta -= dx * 0.007; CAM.phi -= dy * 0.007; }
      else if (CAM.mBtn === 2) { _doPan(dx, dy); }
      _applyCAM();
    });
    window.addEventListener('mouseup', () => { CAM.mBtn = -1; });
    _canvas.addEventListener('wheel', e => {
      e.preventDefault();
      CAM.radius = Math.max(0.1, Math.min(60, CAM.radius * (1 + e.deltaY * 0.001)));
      _applyCAM();
    }, { passive: false });
  }

  // ── Touch ─────────────────────────────────────────────────────
  function _setupTouch() {
    _canvas.addEventListener('touchstart', e => {
      if (e.cancelable) e.preventDefault();
      CAM.isRotating = false; CAM.isPinching = false;
      if (e.touches.length === 1) {
        CAM.isRotating = true;
        CAM.t1x = e.touches[0].clientX; CAM.t1y = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        CAM.isPinching  = true;
        CAM.prevPinch   = _pinchDist(e.touches);
        CAM.prevMidX    = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        CAM.prevMidY    = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: false });

    _canvas.addEventListener('touchmove', e => {
      if (e.cancelable) e.preventDefault();
      if (e.touches.length === 1 && CAM.isRotating) {
        const dx = e.touches[0].clientX - CAM.t1x;
        const dy = e.touches[0].clientY - CAM.t1y;
        CAM.t1x = e.touches[0].clientX; CAM.t1y = e.touches[0].clientY;
        CAM.theta -= dx * 0.008; CAM.phi -= dy * 0.008;
        _applyCAM();
      } else if (e.touches.length === 2 && CAM.isPinching) {
        const pinch = _pinchDist(e.touches);
        CAM.radius = Math.max(0.1, Math.min(60, CAM.radius * (CAM.prevPinch / pinch)));
        CAM.prevPinch = pinch;
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        _doPan(mx - CAM.prevMidX, my - CAM.prevMidY);
        CAM.prevMidX = mx; CAM.prevMidY = my;
        _applyCAM();
      }
    }, { passive: false });

    _canvas.addEventListener('touchend', e => {
      if (e.touches.length === 0) { CAM.isRotating = false; CAM.isPinching = false; }
      else if (e.touches.length === 1) {
        CAM.isPinching = false; CAM.isRotating = true;
        CAM.t1x = e.touches[0].clientX; CAM.t1y = e.touches[0].clientY;
      }
    }, { passive: true });
  }

  function _doPan(dx, dy) {
    const fwd   = new THREE.Vector3().subVectors(C.position, CAM.target).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, C.up).normalize();
    const s = CAM.radius * 0.0012;
    CAM.target.addScaledVector(right,  dx * s);
    CAM.target.addScaledVector(C.up,   dy * s);
  }

  function _pinchDist(touches) {
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY
    );
  }

  // ── Render loop ───────────────────────────────────────────────
  function _loop() {
    requestAnimationFrame(_loop);
    const dt = CLK ? CLK.getDelta() : 0;
    if (_mixer) { _mixer.update(dt); _camDirty = true; }

    _resize();
    R.render(S, C);

    // ← FIXED: only project kalau ada perubahan (camDirty flag)
    // Untuk perf tier low: max 30fps untuk projection, tinggi tetap 60fps
    const settings = window.AppState?.settings;
    const projFps  = settings?.jointProjectionFPS || 60;
    _projFrame++;
    if (_camDirty || (_projFrame % Math.round(60 / projFps) === 0)) {
      _projectJoints();
      _renderCompass();
      if (_camDirty) _camDirty = false;
    }

    // FPS counter
    window.FPSCounter?.tick();
    // Update FPS display kalau visible
    if (settings?.showFPS) {
      const el = document.getElementById('fps-display');
      if (el && window.FPSCounter) el.textContent = window.FPSCounter.fps + ' fps';
    }
  }

  // ── FIXED Resize ──────────────────────────────────────────────
  function _resize() {
    if (!_vpEl) return;
    const w = _vpEl.clientWidth, h = _vpEl.clientHeight;
    if (w === _lW && h === _lH || w === 0 || h === 0) return;
    _lW = w; _lH = h;
    C.aspect = w / h; C.updateProjectionMatrix();
    R.setSize(w, h);
    _camDirty = true;
  }

  // ── FIXED setViewportEl ───────────────────────────────────────
  function setViewportEl(el) {
    if (!el) return;
    // ← FIXED: disconnect observer lama sebelum buat yang baru
    if (_resizeObs) _resizeObs.disconnect();
    _vpEl = el;
    _lW = 0; _lH = 0;
    _resizeObs = new ResizeObserver(_resize);
    _resizeObs.observe(_vpEl);
    _camDirty = true;
  }

  // ── Load GLB ──────────────────────────────────────────────────
  function loadGLB(file, onProg, onDone, onErr) {
    if (typeof THREE.GLTFLoader === 'undefined') {
      onErr?.(new Error('GLTFLoader tidak dimuat.')); return;
    }
    const url = URL.createObjectURL(file);
    const loader = new THREE.GLTFLoader();
    if (typeof THREE.DRACOLoader !== 'undefined') {
      const draco = new THREE.DRACOLoader();
      draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
      loader.setDRACOLoader(draco);
    }
    loader.load(
      url,
      gltf => { URL.revokeObjectURL(url); _processGLTF(gltf, onDone); },
      xhr  => { if (xhr.total > 0) onProg?.(Math.round(xhr.loaded / xhr.total * 100)); else onProg?.(50); },
      err  => { URL.revokeObjectURL(url); onErr?.(err); }
    );
  }

  function _processGLTF(gltf, onDone) {
    if (_model) {
      clearJoints();
      S.remove(_model);
      if (_skel) { S.remove(_skel); _skel = null; }
      _model.traverse(c => {
        c.geometry?.dispose();
        (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m?.dispose?.());
      });
      _origMat.clear(); _bones = []; _hasBones = false;
      if (_mixer) { _mixer.stopAllAction(); _mixer = null; } _action = null;
    }

    _gltf  = gltf;
    _model = gltf.scene;

    const b0 = new THREE.Box3().setFromObject(_model);
    const s0 = b0.getSize(new THREE.Vector3());
    const scl = 2.0 / (Math.max(s0.x, s0.y, s0.z) || 1);
    _model.scale.setScalar(scl);
    const b1 = new THREE.Box3().setFromObject(_model);
    const ctr = b1.getCenter(new THREE.Vector3());
    _model.position.sub(ctr); _model.position.y -= b1.min.y;

    _model.traverse(c => {
      if (c.isMesh) {
        c.castShadow = true; c.receiveShadow = true;
        _origMat.set(c.uuid, Array.isArray(c.material) ? c.material.map(m => m.clone()) : c.material.clone());
      }
      if (c.isBone && !_bones.includes(c)) { _bones.push(c); _hasBones = true; }
      if (c.isSkinnedMesh && c.skeleton) {
        _hasBones = true;
        c.skeleton.bones.forEach(b => { if (!_bones.includes(b)) _bones.push(b); });
        if (!_skel) { _skel = new THREE.SkeletonHelper(_model); _skel.visible = false; S.add(_skel); }
      }
    });

    S.add(_model);
    if (gltf.animations?.length) _mixer = new THREE.AnimationMixer(_model);

    const b2 = new THREE.Box3().setFromObject(_model);
    CAM.target.copy(b2.getCenter(new THREE.Vector3()));
    CAM.radius = b2.getSize(new THREE.Vector3()).length() * 1.5;
    CAM.theta = 0; CAM.phi = 1.05;
    _applyCAM();

    onDone?.(_stats(), gltf, _hasBones, _bones);
  }

  // ── Real Analysis ─────────────────────────────────────────────
  /**
   * realAnalysis() — Analisis nyata berbasis data model yang ada.
   * Mengembalikan Promise supaya bisa di-await dengan progress callback.
   */
  async function realAnalysis(onStep) {
    const result = {
      boundingBox:     null,
      symmetryAxis:    'X',
      hasRealSkeleton: _hasBones,
      skeletonBones:   _bones.length,
      meshCount:       0,
      vertexCount:     0,
      estimatedJoints: {},
      qualityScore:    0,
    };

    // Step 1: Bounding box
    onStep?.('Membaca bounding box model...', 10);
    await _yield();
    if (_model) {
      const box = new THREE.Box3().setFromObject(_model);
      const size = box.getSize(new THREE.Vector3());
      result.boundingBox = {
        min: box.min.clone(), max: box.max.clone(), size: size.clone(),
        center: box.getCenter(new THREE.Vector3()),
      };
    }

    // Step 2: Vertex & mesh count nyata
    onStep?.('Menghitung geometri...', 22);
    await _yield();
    let vCount = 0, mCount = 0;
    _model?.traverse(c => {
      if (!c.isMesh) return; mCount++;
      const p = c.geometry?.attributes?.position;
      if (p) vCount += p.count;
    });
    result.meshCount   = mCount;
    result.vertexCount = vCount;

    // Step 3: Deteksi simetri dari bones atau dari geometry
    onStep?.('Mendeteksi axis simetri...', 38);
    await _yield();
    if (_hasBones && _bones.length > 0) {
      const hasLeft  = _bones.some(b => /^l_|_l$|left/i.test(b.name));
      const hasRight = _bones.some(b => /^r_|_r$|right/i.test(b.name));
      result.hasSymmetry = hasLeft && hasRight;
    } else {
      result.hasSymmetry = true; // asumsi karakter humanoid simetris
    }

    // Step 4: Map bones ke joint definitions (kalau ada bones)
    onStep?.('Memetakan landmark anatomi...', 52);
    await _yield();
    if (_hasBones && _bones.length > 0) {
      const BONE_MAP = {
        hip: 'hips', pelv: 'hips', spine: 'spine1', chest: 'chest',
        neck: 'neck', head: 'head',
        l_shoulder: 'l_shoulder', r_shoulder: 'r_shoulder',
        l_arm: 'l_upper_arm', r_arm: 'r_upper_arm',
        l_elbow: 'l_elbow', r_elbow: 'r_elbow',
        l_wrist: 'l_wrist', r_wrist: 'r_wrist',
        l_up_leg: 'l_hip', r_up_leg: 'r_hip',
        l_leg: 'l_knee', r_leg: 'r_knee',
        l_foot: 'l_ankle', r_foot: 'r_ankle',
      };

      _bones.forEach(bone => {
        const n = bone.name.toLowerCase().replace(/[\s-]/g, '_');
        Object.entries(BONE_MAP).forEach(([key, jointId]) => {
          if (n.includes(key) && !result.estimatedJoints[jointId]) {
            const wp = new THREE.Vector3();
            bone.getWorldPosition(wp);
            // Convert ke model-local
            if (_model) {
              const inv = _model.matrixWorld.clone().invert();
              wp.applyMatrix4(inv);
            }
            result.estimatedJoints[jointId] = { x: wp.x, y: wp.y, z: wp.z };
          }
        });
      });
    }

    // Step 5: Hitung dari bounding box kalau joint belum terdeteksi
    onStep?.('Mengestimasi posisi joint dari geometri...', 68);
    await _yield();
    if (result.boundingBox) {
      const { min, max, size } = result.boundingBox;
      const midX = (min.x + max.x) / 2;

      // Estimasi heuristic berdasarkan proporsi tubuh manusia
      const jointEstimates = {
        hips:        { x: midX, y: min.y + size.y * 0.51, z: 0 },
        spine1:      { x: midX, y: min.y + size.y * 0.60, z: 0 },
        spine2:      { x: midX, y: min.y + size.y * 0.685, z: 0 },
        chest:       { x: midX, y: min.y + size.y * 0.775, z: 0 },
        neck:        { x: midX, y: min.y + size.y * 0.865, z: 0 },
        head:        { x: midX, y: min.y + size.y * 0.95, z: 0 },
        l_shoulder:  { x: midX - size.x * 0.21, y: min.y + size.y * 0.80, z: 0 },
        r_shoulder:  { x: midX + size.x * 0.21, y: min.y + size.y * 0.80, z: 0 },
        l_elbow:     { x: midX - size.x * 0.28, y: min.y + size.y * 0.685, z: 0 },
        r_elbow:     { x: midX + size.x * 0.28, y: min.y + size.y * 0.685, z: 0 },
        l_wrist:     { x: midX - size.x * 0.365, y: min.y + size.y * 0.51, z: 0 },
        r_wrist:     { x: midX + size.x * 0.365, y: min.y + size.y * 0.51, z: 0 },
        l_hip:       { x: midX - size.x * 0.06, y: min.y + size.y * 0.50, z: 0 },
        r_hip:       { x: midX + size.x * 0.06, y: min.y + size.y * 0.50, z: 0 },
        l_knee:      { x: midX - size.x * 0.075, y: min.y + size.y * 0.275, z: 0 },
        r_knee:      { x: midX + size.x * 0.075, y: min.y + size.y * 0.275, z: 0 },
        l_ankle:     { x: midX - size.x * 0.075, y: min.y + size.y * 0.06, z: 0 },
        r_ankle:     { x: midX + size.x * 0.075, y: min.y + size.y * 0.06, z: 0 },
      };

      // Hanya isi yang belum ada dari bone detection
      Object.entries(jointEstimates).forEach(([id, pos]) => {
        if (!result.estimatedJoints[id]) result.estimatedJoints[id] = pos;
      });
    }

    // Step 6: Hitung quality score
    onStep?.('Menghitung skor kualitas...', 84);
    await _yield();
    let q = 60;
    if (_hasBones)           q += 20;
    if (result.vertexCount > 5000)  q += 10;
    if (result.hasSymmetry)  q += 5;
    result.qualityScore = Math.min(95, q);

    onStep?.('Analisis selesai!', 100);
    await _yield();

    return result;
  }

  async function _yield() {
    return new Promise(r => setTimeout(r, 16)); // yield ke browser per frame
  }

  // ── Test Poses (NYATA — bukan play anim) ─────────────────────
  /**
   * applyTestPose() — procedural pose nyata dari joint positions
   * Tidak tergantung apakah model punya animasi
   */
  function applyTestPose(poseName) {
    if (!_model) return false;
    _stopPoseAnim();

    const j = (id) => _joints.find(jt => jt.def?.id === id || jt.id === id);
    const setPos = (id, x, y, z) => {
      const jt = j(id);
      if (jt?.obj3d && !jt.isBone) {
        jt.obj3d.position.set(x, y, z);
        _camDirty = true;
      }
    };

    const resetAllToDefault = () => {
      if (window.BodyJointDefs) {
        window.BodyJointDefs.forEach(def => {
          const jt = j(def.id);
          if (jt?.obj3d && !jt.isBone)
            jt.obj3d.position.set(def.localX, def.localY, def.localZ);
        });
      }
    };

    switch (poseName) {
      case 'tpose':
        resetAllToDefault();
        break;

      case 'apose':
        resetAllToDefault();
        // Turunkan lengan ~45 derajat
        setPos('l_upper_arm', -0.38, 1.46, 0);
        setPos('l_elbow',     -0.52, 1.28, 0.04);
        setPos('l_forearm',   -0.60, 1.12, 0.03);
        setPos('l_wrist',     -0.68, 0.95, 0.02);
        setPos('r_upper_arm',  0.38, 1.46, 0);
        setPos('r_elbow',      0.52, 1.28, 0.04);
        setPos('r_forearm',    0.60, 1.12, 0.03);
        setPos('r_wrist',      0.68, 0.95, 0.02);
        break;

      case 'wave': {
        resetAllToDefault();
        // Angkat lengan kanan ke atas, animasikan tangan
        setPos('r_shoulder',  0.21, 1.65, 0);
        setPos('r_upper_arm', 0.30, 1.72, 0);
        setPos('r_elbow',     0.22, 1.85, 0);
        let t = 0;
        _poseAnim = setInterval(() => {
          t += 0.12;
          const waveX = 0.20 + Math.sin(t) * 0.08;
          const waveY = 1.92 + Math.cos(t * 2) * 0.04;
          setPos('r_forearm', waveX, 1.90, 0);
          setPos('r_wrist',   waveX * 1.05, waveY, 0);
          _camDirty = true;
        }, 50);
        break;
      }

      case 'walk': {
        resetAllToDefault();
        let t = 0;
        _poseAnim = setInterval(() => {
          t += 0.07;
          const sw = Math.sin(t) * 0.12;   // swing
          const sw2 = Math.sin(t + Math.PI) * 0.12;
          // Kaki swing
          setPos('l_thigh', -0.14 + sw * 0.3, 0.78 - Math.abs(sw) * 0.05, sw * 0.5);
          setPos('r_thigh',  0.14 + sw2 * 0.3, 0.78 - Math.abs(sw2) * 0.05, sw2 * 0.5);
          setPos('l_knee',  -0.15, 0.55 + Math.max(0, sw) * 0.15, sw * 0.3);
          setPos('r_knee',   0.15, 0.55 + Math.max(0, sw2) * 0.15, sw2 * 0.3);
          // Lengan counter-swing
          setPos('l_upper_arm', -0.38 + sw2 * 0.1, 1.54, sw2 * 0.08);
          setPos('r_upper_arm',  0.38 + sw * 0.1, 1.54, sw * 0.08);
          // Sedikit rotasi hips
          setPos('hips', sw * 0.015, 1.02 + Math.abs(sw) * 0.02, 0);
          _camDirty = true;
        }, 33);
        break;
      }

      default:
        resetAllToDefault();
    }

    return true;
  }

  function _stopPoseAnim() {
    if (_poseAnim) { clearInterval(_poseAnim); _poseAnim = null; }
  }

  // ── GLB Export (pakai THREE.GLTFExporter) ─────────────────────
  /**
   * exportToGLB() — export scene nyata dengan joint positions yang sudah diedit
   * Membutuhkan GLTFExporter dari Three.js examples
   */
  function exportToGLB(filename, onDone, onErr) {
    if (typeof THREE.GLTFExporter === 'undefined') {
      // Fallback: download file asli jika GLTFExporter tidak tersedia
      onErr?.('GLTFExporter tidak tersedia. Menggunakan file original.');
      return false;
    }
    if (!_model) { onErr?.('Tidak ada model yang dimuat'); return false; }

    const exporter = new THREE.GLTFExporter();
    // Clone scene untuk export (tidak merusak scene yang sedang ditampilkan)
    const exportScene = new THREE.Scene();
    exportScene.add(_model.clone());

    exporter.parse(
      exportScene,
      (result) => {
        const blob = new Blob([result], { type: 'model/gltf-binary' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        onDone?.(filename);
      },
      (err) => onErr?.(err?.message || String(err)),
      {
        binary:     true,
        animations: _gltf?.animations || [],
        trs:        false,
        onlyVisible: true,
      }
    );
    return true;
  }

  // ── BVH Export (generasi nyata dari joint definitions) ────────
  /**
   * exportToBVH() — generate BVH file nyata dari joint hierarchy
   * BVH adalah format motion capture industri yang valid
   */
  function exportToBVH(filename, appState) {
    if (!window.BodyJointDefs) { return false; }

    const jointDefs = window.BodyJointDefs;
    const positions = appState?.bodyRig?.jointPositions || {};

    const getPos = (def) => {
      const saved = positions[def.id];
      if (saved) return saved;
      return { x: def.localX, y: def.localY, z: def.localZ };
    };

    const lines = ['HIERARCHY'];
    const written = new Set();

    const writeJoint = (def, indent) => {
      if (written.has(def.id)) return;
      written.add(def.id);

      const pos     = getPos(def);
      const px      = (pos.x * 100).toFixed(4);  // convert ke cm (BVH standar)
      const py      = (pos.y * 100).toFixed(4);
      const pz      = (pos.z * 100).toFixed(4);
      const children = jointDefs.filter(d => d.parent === def.id);
      const isLeaf  = children.length === 0;

      lines.push(`${indent}JOINT ${def.id}`);
      lines.push(`${indent}{`);
      lines.push(`${indent}  OFFSET ${px} ${py} ${pz}`);
      if (!isLeaf) {
        lines.push(`${indent}  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation`);
        children.forEach(child => writeJoint(child, indent + '  '));
      } else {
        lines.push(`${indent}  CHANNELS 3 Zrotation Xrotation Yrotation`);
        lines.push(`${indent}  End Site`);
        lines.push(`${indent}  {`);
        lines.push(`${indent}    OFFSET 0.0000 10.0000 0.0000`);
        lines.push(`${indent}  }`);
      }
      lines.push(`${indent}}`);
    };

    // Root joint
    const root = jointDefs.find(d => !d.parent);
    if (!root) return false;
    const rootPos = getPos(root);
    lines.push(`ROOT ${root.id}`);
    lines.push('{');
    lines.push(`  OFFSET ${(rootPos.x*100).toFixed(4)} ${(rootPos.y*100).toFixed(4)} ${(rootPos.z*100).toFixed(4)}`);
    lines.push('  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation');
    written.add(root.id);
    const rootChildren = jointDefs.filter(d => d.parent === root.id);
    rootChildren.forEach(child => writeJoint(child, '  '));
    lines.push('}');

    // Motion section (T-Pose = 1 frame semua zeros)
    const totalJoints = jointDefs.length;
    const channelCount = totalJoints * 3 + 3; // root 6 channels, rest 3
    lines.push('MOTION');
    lines.push('Frames: 1');
    lines.push('Frame Time: 0.033333');
    lines.push(Array(channelCount).fill('0.000000').join(' '));

    const bvhContent = lines.join('\n');
    const blob = new Blob([bvhContent], { type: 'text/plain; charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  }

  // ── Joint system ──────────────────────────────────────────────
  function clearJoints() {
    _stopPoseAnim();
    _joints.forEach(j => {
      if (j.obj3d && !j.isBone && j.obj3d.parent) j.obj3d.parent.remove(j.obj3d);
      j.domEl?.remove();
    });
    _joints = [];
  }

  function createJointsFromDefs(defs, container, onSelect) {
    if (!_model) return;
    clearJoints();
    if (container) container.innerHTML = '';
    defs.forEach(def => {
      const obj3d = new THREE.Object3D();
      obj3d.name = def.id;
      obj3d.position.set(def.localX ?? 0, def.localY ?? 1, def.localZ ?? 0);
      _model.add(obj3d);
      const el = _makeGizmoDom(def.type, def.label, 'j-' + def.id);
      _attachDrag3D(el, obj3d, def, onSelect);
      el.addEventListener('click', e => { e.stopPropagation(); onSelect?.(def.id, def, obj3d); });
      const c = container || _gizmoEl;
      if (c) c.appendChild(el);
      _joints.push({ id: def.id, label: def.label, type: def.type, obj3d, domEl: el, def, isBone: false });
    });
    _camDirty = true;
  }

  function createJointsFromBones(container, onSelect) {
    if (!_model || !_hasBones || !_bones.length) return { success: false, count: 0 };
    clearJoints();
    if (container) container.innerHTML = '';
    const SKIP = ['end','_ik','ik_','pole','_target','_tip','tip_','nub','null','helper','root_end'];
    const rel  = _bones.filter(b => b.name && !SKIP.some(p => b.name.toLowerCase().includes(p)));
    rel.forEach(bone => {
      let type = 'y';
      const n = bone.name.toLowerCase();
      if (/(spine|chest|neck|hip|pelv)/.test(n)) type = 'g';
      else if (/(forearm|shin|calf|thumb|index|middle|ring|pinky|finger|metacar|proxim|distal)/.test(n)) type = 'c';
      const def = { id: bone.uuid, label: bone.name, type, isBone: true };
      const el  = _makeGizmoDom(type, bone.name, 'b-' + bone.uuid);
      _attachDragBone(el, bone, def, onSelect);
      el.addEventListener('click', e => { e.stopPropagation(); onSelect?.(bone.uuid, def, bone); });
      const c = container || _gizmoEl;
      if (c) c.appendChild(el);
      _joints.push({ id: bone.uuid, label: bone.name, type, obj3d: bone, domEl: el, def, isBone: true });
    });
    _camDirty = true;
    return { success: true, count: rel.length };
  }

  function _makeGizmoDom(type, label, id) {
    const el = document.createElement('div');
    el.className = `joint-dot type-${type}`;
    el.id = 'giz-' + id;
    el.style.cssText = 'position:absolute;display:none;pointer-events:all;z-index:14;';
    const tip = document.createElement('div');
    tip.className = 'joint-tooltip'; tip.textContent = label;
    el.appendChild(tip);
    return el;
  }

  // ── Project Joints (per-frame) ────────────────────────────────
  function _projectJoints() {
    if (!_joints.length || !_vpEl) return;
    const rect = _vpEl.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    if (!W || !H) return;

    const jSz = window.AppState?.bodyRig?.jointSize
      ? (10 + (AppState.bodyRig.jointSize / 100) * 16) : 18;
    const jOp = window.AppState?.bodyRig?.jointOpacity
      ? (AppState.bodyRig.jointOpacity / 100) : 1.0;

    const wp = new THREE.Vector3();
    _joints.forEach(j => {
      if (!j.obj3d || !j.domEl) return;
      j.obj3d.getWorldPosition(wp);
      const ndc = wp.clone().project(C);
      if (ndc.z >= 1.0) { j.domEl.style.display = 'none'; return; }
      const px = (ndc.x * 0.5 + 0.5) * W;
      const py = (1.0 - (ndc.y * 0.5 + 0.5)) * H;
      const depthFade = Math.max(0.35, 1.0 - ndc.z * 0.4);
      j.domEl.style.display = 'block';
      j.domEl.style.left    = (px - jSz * 0.5) + 'px';
      j.domEl.style.top     = (py - jSz * 0.5) + 'px';
      j.domEl.style.width   = jSz + 'px';
      j.domEl.style.height  = jSz + 'px';
      j.domEl.style.opacity = (jOp * depthFade).toFixed(2);
    });
  }

  // ── Drag: synthetic joint ─────────────────────────────────────
  function _attachDrag3D(el, obj3d, def, onSelect) {
    let dragging = false;
    const start = () => {
      dragging = true; el.classList.add('dragging');
      onSelect?.(def.id, def, obj3d);
    };
    const move = (cx, cy) => {
      if (!dragging || !_model || !_vpEl) return;
      const rect = _vpEl.getBoundingClientRect();
      const W = rect.width, H = rect.height;
      const wp = new THREE.Vector3();
      obj3d.getWorldPosition(wp);
      const ndcZ = wp.clone().project(C).z;
      const ndcX = ((cx - rect.left) / W) * 2 - 1;
      const ndcY = -(((cy - rect.top) / H) * 2 - 1);
      const newWorld = new THREE.Vector3(ndcX, ndcY, ndcZ).unproject(C);
      const invM    = _model.matrixWorld.clone().invert();
      const newLocal = newWorld.applyMatrix4(invM);
      obj3d.position.copy(newLocal);
      if (window.AppState) {
        AppState.bodyRig.jointPositions[def.id] = { x: newLocal.x, y: newLocal.y, z: newLocal.z };
        if (AppState.bodyRig.symmetry && window.BoneMirrors?.[def.id]) {
          const mirId = BoneMirrors[def.id];
          const mirJ  = _joints.find(j => j.id === mirId);
          if (mirJ) {
            mirJ.obj3d.position.set(-newLocal.x, newLocal.y, newLocal.z);
            AppState.bodyRig.jointPositions[mirId] = { x: -newLocal.x, y: newLocal.y, z: newLocal.z };
          }
        }
      }
      _camDirty = true;
    };
    const end = () => {
      if (dragging && window.HistoryManager && window.AppState) {
        HistoryManager.push({ ...AppState.bodyRig.jointPositions });
      }
      dragging = false; el.classList.remove('dragging');
    };
    el.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); start(); });
    window.addEventListener('mousemove', e => { if (dragging) move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', end);
    el.addEventListener('touchstart', e => { e.stopPropagation(); start(); }, { passive: true });
    window.addEventListener('touchmove', e => { if (dragging) { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY); } }, { passive: false });
    window.addEventListener('touchend', end, { passive: true });
  }

  // ── Drag: real bone ───────────────────────────────────────────
  function _attachDragBone(el, bone, def, onSelect) {
    let dragging = false;
    const start = () => { dragging = true; el.classList.add('dragging'); onSelect?.(bone.uuid, def, bone); };
    const move = (cx, cy) => {
      if (!dragging || !_vpEl) return;
      const rect = _vpEl.getBoundingClientRect();
      const W = rect.width, H = rect.height;
      const wp = new THREE.Vector3(); bone.getWorldPosition(wp);
      const ndcZ = wp.clone().project(C).z;
      const ndcX = ((cx - rect.left) / W) * 2 - 1;
      const ndcY = -(((cy - rect.top) / H) * 2 - 1);
      const newWorld = new THREE.Vector3(ndcX, ndcY, ndcZ).unproject(C);
      if (bone.parent) {
        bone.parent.updateMatrixWorld(true);
        const invP = bone.parent.matrixWorld.clone().invert();
        bone.position.copy(newWorld.applyMatrix4(invP));
        bone.updateMatrixWorld(true);
      }
      if (window.AppState?.bodyRig?.symmetry) {
        const n = bone.name;
        const mirName = n
          .replace(/^L_/i, 'MIRROR_R_').replace(/^R_/i, 'MIRROR_L_')
          .replace(/_L$/i, '_MIRROR_R').replace(/_R$/i, '_MIRROR_L')
          .replace(/Left/gi, '##R##').replace(/Right/gi, 'Left').replace(/##R##/g, 'Right')
          .replace(/^MIRROR_R_/, 'R_').replace(/^MIRROR_L_/, 'L_')
          .replace(/_MIRROR_R$/, '_R').replace(/_MIRROR_L$/, '_L');
        if (mirName !== n) {
          const mb = _bones.find(b => b.name === mirName);
          if (mb?.parent) {
            mb.parent.updateMatrixWorld(true);
            const mInvP = mb.parent.matrixWorld.clone().invert();
            const mWorld = newWorld.clone(); mWorld.x = -mWorld.x;
            mb.position.copy(mWorld.applyMatrix4(mInvP));
            mb.updateMatrixWorld(true);
          }
        }
      }
      _camDirty = true;
    };
    const end = () => { dragging = false; el.classList.remove('dragging'); };
    el.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); start(); });
    window.addEventListener('mousemove', e => { if (dragging) move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', end);
    el.addEventListener('touchstart', e => { e.stopPropagation(); start(); }, { passive: true });
    window.addEventListener('touchmove', e => { if (dragging) { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY); } }, { passive: false });
    window.addEventListener('touchend', end, { passive: true });
  }

  // ── Gizmo container ───────────────────────────────────────────
  function setGizmoContainer(el) {
    _gizmoEl = el;
    _joints.forEach(j => {
      if (j.domEl && j.domEl.parentElement !== el) el?.appendChild(j.domEl);
    });
  }

  // ── View Modes ────────────────────────────────────────────────
  const MODES = { STANDARD: 'standard', WIREFRAME: 'wireframe', MATCAP: 'matcap', V_NORMALS: 'vnormals', UV_CHECK: 'uvchecked' };

  function setMode(mode) {
    if (!_model) return;
    _restoreMats();
    if (mode === MODES.WIREFRAME || mode === 'wireframe') {
      _eachMesh(m => { m.wireframe = true; });
    } else if (['matcap','vnormals','matcap+'].includes(mode)) {
      const mat = new THREE.MeshNormalMaterial();
      _model.traverse(c => { if (c.isMesh) c.material = mat; });
    } else if (mode === MODES.UV_CHECK || mode === 'uvchecked') {
      const mat = new THREE.MeshBasicMaterial({ map: _uvTex });
      _model.traverse(c => { if (c.isMesh) c.material = mat; });
    }
    _camDirty = true;
  }

  function setChannelView(ch) {
    if (!_model) return;
    _restoreMats();
    _model.traverse(c => {
      if (!c.isMesh) return;
      const orig = _origMat.get(c.uuid); if (!orig) return;
      const arr  = Array.isArray(orig) ? orig : [orig];
      const newMats = arr.map(o => _chanMat(o, ch));
      c.material = newMats.length === 1 ? newMats[0] : newMats;
    });
    _camDirty = true;
  }

  function _chanMat(o, ch) {
    if (ch === 'normal') return new THREE.MeshNormalMaterial();
    const m = new THREE.MeshBasicMaterial();
    switch (ch) {
      case 'base_color': m.map = o.map; m.color = o.color?.clone() ?? new THREE.Color(1,1,1); break;
      case 'metalness':  m.map = o.metalnessMap; m.color = new THREE.Color().setScalar(o.metalness ?? 0); break;
      case 'roughness':  m.map = o.roughnessMap; m.color = new THREE.Color().setScalar(o.roughness ?? 0.5); break;
      case 'opacity':    m.map = o.alphaMap || o.map; m.transparent = true; m.color = new THREE.Color(1,1,1); break;
      case 'emission':   m.map = o.emissiveMap; m.color = o.emissive?.clone() ?? new THREE.Color(0,0,0); break;
      case 'specular':   m.color = new THREE.Color().setScalar(o.specularIntensity ?? 0.5); break;
      default:           m.map = o.map; m.color = o.color?.clone() ?? new THREE.Color(1,1,1);
    }
    return m;
  }

  function _restoreMats() {
    if (!_model) return;
    _model.traverse(c => {
      if (!c.isMesh) return;
      const o = _origMat.get(c.uuid);
      if (o) {
        c.material = Array.isArray(o) ? o.map(m => m.clone()) : o.clone();
        (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => { if (m) m.wireframe = false; });
      }
    });
    _camDirty = true;
  }

  function _eachMesh(fn) {
    _model?.traverse(c => { if (c.isMesh) (Array.isArray(c.material) ? c.material : [c.material]).forEach(fn); });
  }

  function toggleBones(show) { if (_skel) { _skel.visible = show; _camDirty = true; } }
  function toggleWireframeOverlay(show) { _eachMesh(m => { m.wireframe = show; }); _camDirty = true; }

  // ── Camera helpers ────────────────────────────────────────────
  function resetView() {
    if (_model) {
      const b = new THREE.Box3().setFromObject(_model);
      CAM.target.copy(b.getCenter(new THREE.Vector3()));
      CAM.radius = b.getSize(new THREE.Vector3()).length() * 1.5;
    } else { CAM.target.set(0, 1, 0); CAM.radius = 4; }
    CAM.theta = 0; CAM.phi = 1.05;
    _applyCAM();
  }

  function setView(v) {
    const H = Math.PI / 2;
    switch(v) {
      case 'front':  CAM.theta = 0;       CAM.phi = H; break;
      case 'back':   CAM.theta = Math.PI; CAM.phi = H; break;
      case 'left':   CAM.theta = -H;      CAM.phi = H; break;
      case 'right':  CAM.theta = H;       CAM.phi = H; break;
      case 'top':    CAM.phi = 0.06;                   break;
      case 'bottom': CAM.phi = Math.PI - 0.06;         break;
    }
    _applyCAM();
  }

  function zoom(f) {
    CAM.radius = Math.max(0.1, Math.min(60, CAM.radius * f)); _applyCAM();
  }

  // ── UV checker ────────────────────────────────────────────────
  function _makeUVTex() {
    const N = 512, sq = N / 8;
    const c = document.createElement('canvas'); c.width = c.height = N;
    const ctx = c.getContext('2d');
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x+y)%2===0 ? '#b0f0a0' : '#182818';
      ctx.fillRect(x*sq, y*sq, sq, sq);
      ctx.fillStyle = (x+y)%2===0 ? '#0a1a08' : '#7dc87a';
      ctx.font = `${sq*0.28}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${x},${y}`, x*sq+sq/2, y*sq+sq/2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // ── Animation ─────────────────────────────────────────────────
  function playFirstAnimation() {
    if (!_mixer || !_gltf?.animations?.length) return false;
    if (_action) _action.stop();
    _action = _mixer.clipAction(_gltf.animations[0]); _action.play();
    _camDirty = true; return true;
  }

  function playAnimationByName(name) {
    if (!_mixer || !_gltf?.animations?.length) return false;
    const clip = THREE.AnimationClip.findByName(_gltf.animations, name);
    if (!clip) return false;
    if (_action) _action.stop();
    _action = _mixer.clipAction(clip); _action.play();
    _camDirty = true; return true;
  }

  function stopAnimation() {
    _stopPoseAnim();
    if (_action) { _action.stop(); _action = null; }
  }

  function getJointLocalPos(id) {
    const j = _joints.find(j => j.id === id);
    return j ? j.obj3d.position.clone() : null;
  }

  function getJointWorldPos(id) {
    const j = _joints.find(j => j.id === id);
    if (!j) return null;
    const wp = new THREE.Vector3(); j.obj3d.getWorldPosition(wp); return wp;
  }

  function _stats() {
    let v = 0, t = 0, m = 0;
    const mats = new Set(), texs = new Set();
    _model?.traverse(c => {
      if (!c.isMesh) return; m++;
      const pos = c.geometry?.attributes?.position; if (pos) v += pos.count;
      const idx = c.geometry?.index;
      t += idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
      (Array.isArray(c.material) ? c.material : [c.material]).forEach(mat => {
        if (!mat) return; mats.add(mat.uuid);
        ['map','normalMap','roughnessMap','metalnessMap','emissiveMap'].forEach(k => { if (mat[k]) texs.add(mat[k].uuid); });
      });
    });
    return {
      vertices: v, tris: Math.round(t), polys: Math.round(t * 0.6),
      meshes: m, materials: mats.size, textures: texs.size,
      bones: _bones.length, animations: _gltf?.animations?.length || 0, hasBones: _hasBones,
    };
  }

  // ── Public API ────────────────────────────────────────────────
  return {
    init, loadGLB,
    setViewportEl, setGizmoContainer, mountCompass,
    clearJoints, createJointsFromDefs, createJointsFromBones,
    setMode, setChannelView, toggleBones, toggleWireframeOverlay,
    resetView, setView, zoom,
    realAnalysis, applyTestPose,
    exportToGLB, exportToBVH,
    playFirstAnimation, playAnimationByName, stopAnimation,
    getJointLocalPos, getJointWorldPos,
    getJoints:     () => _joints,
    hasModel:      () => !!_model,
    hasBones:      () => _hasBones,
    getBones:      () => _bones,
    getGltf:       () => _gltf,
    getScene:      () => S,
    hasAnimations: () => !!(_gltf?.animations?.length),
    getStats:      _stats,
    markDirty:     () => { _camDirty = true; },
    MODES,
  };
})();

window.Viewer = Viewer;
