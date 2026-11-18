import * as THREE from '../vendor/three.module.js';
import { buildPlaza, buildRoom, blobShadow } from './world.js';
import { buildCharacter } from './character.js';
import { Controller } from './controller.js';
import { Hud } from './hud.js';
import { Npc } from './npc.js';
import { initMedia, openVideo } from './media.js';
import { initLightbox, openLightbox, closeLightbox } from './lightbox.js';
import { t, pick, setLang, getLang } from './i18n.js';

/* ---------------- 狀態 ---------------- */
const state = {
  mode: 'plaza',
  zone: null,
  gender: 'boy',
  menuOpen: false,
  videoOpen: false,
  photoOpen: false,
};

const hintedRooms = new Set();
let pendingPhoto = null;

const input = { fwd: false, back: false };
const roomCache = new Map();

let content = null;
let scene = null;
let camera = null;
let renderer = null;
let plaza = null;
let room = null;
let hud = null;
let player = null;
let avatar = null;
let boy = null;
let girl = null;

let colliders = [];
let bounds = null;
let npcs = [];

/* 廣場上的學生與志願者：站的會轉頭看你，走的沿路徑來回 */
const NPC_DEFS = [
  { x: 3.6, z: -2.4, gender: 'girl', hair: 0x2b2b4a },
  { x: 5.1, z: -3.3, gender: 'boy', hair: 0x4a3524 },
  { x: -4.9, z: 2.2, gender: 'boy', hair: 0x6b4a2f },
  { x: 1.9, z: -9.4, gender: 'girl', hair: 0x1f1a17 },
  { x: -6.6, z: -4.4, gender: 'girl', hair: 0x3a2a20 },
  {
    gender: 'boy',
    hair: 0x2b2b4a,
    path: { a: { x: 3.1, z: -1.8 }, b: { x: 9.4, z: -5.4 }, speed: 1.0 },
  },
  {
    gender: 'girl',
    hair: 0x4a3524,
    path: { a: { x: -3.1, z: -1.8 }, b: { x: -9.4, z: -5.4 }, speed: 0.85 },
  },
];

let fading = false;
let savedPos = new THREE.Vector3(0, 0, 5);
let savedYaw = 0;

/* 自動調節解析度：舊 iPad 掉幀時自動降 pixelRatio */
let pixelRatio = 1;
let perfFrames = 0;
let perfTime = 0;

const clock = new THREE.Clock();
const camGoal = new THREE.Vector3();
const lookAt = new THREE.Vector3();

/* 鏡頭俯仰：0 = 平視角色胸口，正數 = 擡頭，負數 = 低頭 */
const view = { pitch: 0, target: 0 };
const PITCH_MIN = -0.35;
const PITCH_MAX = 0.5;

const isPaused = () => state.menuOpen || state.videoOpen || state.photoOpen || fading;
const DEBUG = new URLSearchParams(location.search).has('debug');
const MAX_FRAMES = Number(new URLSearchParams(location.search).get('frames') || 0) || 0;
let frameCount = 0;

/* ---------------- 啟動 ---------------- */
async function boot() {
  const splash = document.getElementById('splash');
  const splashText = splash.querySelector('p');

  try {
    const res = await fetch('./content.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    content = await res.json();
  } catch (err) {
    console.error(err);
    splashText.textContent = t('loadFail');
    return;
  }

  const prefLang = localStorage.getItem('campus.lang');
  const prefGender = localStorage.getItem('campus.gender');
  setLang(prefLang === 'en' ? 'en' : 'zh');
  state.gender = prefGender === 'girl' ? 'girl' : 'boy';
  document.title = t('title');

  if (!initThree()) {
    splashText.textContent = t('noWebGL');
    return;
  }

  const q = new URLSearchParams(location.search);
  state.front = q.get('cam') === 'front';
  if (q.has('photo')) pendingPhoto = Number(q.get('photo')) || 0;
  if (q.has('pos')) {
    const [px, pz] = String(q.get('pos')).split(',').map(Number);
    if (Number.isFinite(px) && Number.isFinite(pz)) player.pos.set(px, 0, pz);
  }
  if (q.has('yaw')) {
    const deg = Number(q.get('yaw'));
    if (Number.isFinite(deg)) player.face((deg * Math.PI) / 180);
  }
  if (q.has('pitch')) {
    const p = Number(q.get('pitch'));
    if (Number.isFinite(p)) {
      view.pitch = view.target = Math.max(PITCH_MIN, Math.min(PITCH_MAX, p));
    }
  }
  snapCamera();

  hud = new Hud(camera, content.zones, {
    onZone: (zone) => enterZone(zone),
    onBack: () => exitRoom(),
    onLang: () => toggleLang(),
    onGender: () => toggleGender(),
    onFullscreen: () => toggleFullscreen(),
    onCam: () => toggleCam(),
    onMenu: (open) => {
      state.menuOpen = open;
      if (open) {
        hud.setGenderLabel(state.gender);
        hud.setCamLabel(state.front);
      }
    },
  });

  initMedia();
  initLightbox();
  bindInput();
  bindButtons();
  bindPhotoPicking();
  bindResize();
  applyGender();
  addGateLabels();
  hud.showBack(false);
  hud.setGenderLabel(state.gender);

  document.addEventListener('campus:video', (e) => {
    state.videoOpen = !!(e.detail && e.detail.open);
  });

  document.addEventListener('campus:photo', (e) => {
    state.photoOpen = !!(e.detail && e.detail.open);
  });

  renderer.setAnimationLoop(frame);

  requestAnimationFrame(() => {
    splash.classList.add('out');
    setTimeout(() => splash.remove(), 600);
  });

  setTimeout(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('nomenu')) hud.openMenu();
    hud.toast(t('hint'), 6000);

    const jump = params.get('zone');
    if (jump) {
      const z = content.zones.find((x) => x.id === jump);
      if (z) setTimeout(() => enterZone(z), 400);
    }

    // ?autotap：把第一張相片投影到螢幕座標再模擬點擊（驗證 raycast 用）
    if (params.has('autotap')) {
      setTimeout(() => {
        const spot = room && room.photoSpots ? room.photoSpots.find(Boolean) : null;
        if (!spot) {
          hud.toast('AUTOTAP no spot · n=' + (room && room.photoSpots ? room.photoSpots.length : -1), 12000);
          return;
        }
        const v = new THREE.Vector3();
        spot.getWorldPosition(v);
        v.project(camera);
        const x = (v.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
        hud.toast('AUTOTAP ' + Math.round(x) + ',' + Math.round(y), 12000);

        setTimeout(() => {
          const el = renderer.domElement;
          const ev = (type) =>
            new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse' });
          el.dispatchEvent(ev('pointerdown'));
          el.dispatchEvent(ev('pointerup'));
          setTimeout(() => hud.toast('TAP ' + (window.__lastPick || 'nofire'), 12000), 500);
        }, 400);
      }, 1900);
    }
  }, 700);
}

/* ---------------- three.js ---------------- */
function initThree() {
  const canvas = document.getElementById('scene');
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      // 截圖模式（?frames=N）停格後仍要保留最後一格畫面
      preserveDrawingBuffer: new URLSearchParams(location.search).has('frames'),
    });
  } catch (err) {
    console.error(err);
    return false;
  }

  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xdcf1ff, 46, 104);

  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, 2.8, 10);

  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0xd9d2c2, 1.5));

  const sun = new THREE.DirectionalLight(0xfff6e8, 2.2);
  sun.position.set(34, 58, 24);
  scene.add(sun);

  // 補光：避免背向陽光的一面死黑（角色正面朝北時全靠它）
  const fill = new THREE.DirectionalLight(0xdfeaff, 0.95);
  fill.position.set(-26, 30, -38);
  scene.add(fill);

  plaza = buildPlaza(content.zones);
  scene.add(plaza.group);
  colliders = plaza.colliders;
  bounds = plaza.bounds;

  npcs = NPC_DEFS.map((def, i) => {
    const n = new Npc(def);
    n.group.scale.setScalar(0.96 + ((i * 7) % 5) * 0.02);
    plaza.group.add(n.group);
    return n;
  });

  player = new Controller(0, 5, 0);

  boy = buildCharacter('boy');
  girl = buildCharacter('girl');
  boy.group.rotation.y = Math.PI;
  girl.group.rotation.y = Math.PI;

  avatar = new THREE.Group();
  avatar.add(boy.group, girl.group, blobShadow());
  avatar.position.copy(player.pos);
  scene.add(avatar);

  savedPos.copy(player.pos);
  savedYaw = player.yaw;
  applyFov();
  snapCamera();

  return true;
}

function applyGender() {
  boy.group.visible = state.gender === 'boy';
  girl.group.visible = state.gender === 'girl';
}

/* ---------------- 相機 ---------------- */
function cameraParams() {
  return state.mode === 'room' ? { dist: 4.3, h: 2.3 } : { dist: 5.4, h: 2.8 };
}

function aimHeight(dist, pitch) {
  // 基準 1.62 而不是胸口 1.35：鏡頭平視時才看得見館頂上方的浮動標籤
  const y = 1.62 + Math.tan(pitch) * dist * 0.9;
  return Math.max(-1.5, Math.min(20, y));
}

/** 目標鏡頭位置；在室內會夾在牆內，避免鏡頭穿牆看到外面 */
function cameraGoal(out) {
  const { dist, h } = cameraParams();
  const s = state.front ? -1 : 1;

  out.set(
    player.pos.x + Math.sin(player.yaw) * dist * s,
    h,
    player.pos.z + Math.cos(player.yaw) * dist * s
  );

  if (state.mode === 'room' && bounds && bounds.type === 'rect') {
    out.x = Math.min(bounds.maxX - 0.5, Math.max(bounds.minX + 0.5, out.x));
    out.z = Math.min(bounds.maxZ - 0.5, Math.max(bounds.minZ + 0.5, out.z));
  }
  return out;
}

function snapCamera() {
  camera.position.copy(cameraGoal(camGoal));
  lookAt.set(player.pos.x, aimHeight(cameraParams().dist, view.pitch), player.pos.z);
  camera.lookAt(lookAt);
}

function updateCamera(dt) {
  view.pitch += (view.target - view.pitch) * (1 - Math.exp(-10 * dt));

  camera.position.lerp(cameraGoal(camGoal), 1 - Math.exp(-9 * dt));
  lookAt.set(player.pos.x, aimHeight(cameraParams().dist, view.pitch), player.pos.z);
  camera.lookAt(lookAt);
}

function nudgePitch(dir) {
  view.target = Math.min(PITCH_MAX, Math.max(PITCH_MIN, view.target + dir * 0.13));
  if (view.target >= PITCH_MAX || view.target <= PITCH_MIN) {
    hud.toast(view.target > 0 ? t('lookMaxUp') : t('lookMaxDown'), 1100);
  }
}

function applyFov() {
  if (!camera) return;
  const target = state.mode === 'room' ? 66 : 58;
  if (camera.fov !== target) {
    camera.fov = target;
    camera.updateProjectionMatrix();
  }
}

/* ---------------- 主迴圈 ---------------- */
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const active = !isPaused();

  const wish = active ? (input.fwd ? 1 : 0) - (input.back ? 1 : 0) : 0;
  player.update(dt, wish, colliders, bounds);

  avatar.position.copy(player.pos);
  avatar.rotation.y = player.yaw;

  const ratio = Math.abs(player.speed) / player.maxSpeed;
  boy.update(dt, ratio);
  girl.update(dt, ratio);
  if (state.mode === 'plaza') {
    for (let i = 0; i < npcs.length; i++) npcs[i].update(dt, player.pos);
  } else if (room && room.tickSlides) {
    room.tickSlides(dt);
  }

  updateCamera(dt);
  hud.updateCompass(player.yaw);
  hud.updateLabels();
  updatePrompt();

  renderer.render(scene, camera);
  tunePerformance(dt);

  // ?frames=N：跑 N 幀後停住，方便無頭截圖（virtual-time 不會被 rAF 卡住）
  if (MAX_FRAMES && ++frameCount >= MAX_FRAMES) {
    renderer.setAnimationLoop(null);
    document.documentElement.setAttribute('data-still', '1');
  }

  if (DEBUG) {
    document.title =
      'calls ' +
      renderer.info.render.calls +
      ' · tris ' +
      Math.round(renderer.info.render.triangles / 1000) +
      'k · tex ' +
      renderer.info.memory.textures +
      ' · dpr ' +
      pixelRatio.toFixed(2) +
      ' · spots ' +
      (room && room.photoSpots ? room.photoSpots.filter(Boolean).length : 0) +
      ' · ' +
      (window.__lastPick || '-');
  }
}

/**
 * 每 90 幀檢查一次平均幀時；太慢就降解析度，夠快就慢慢升回去。
 * 目標：投影機 / 舊 iPad 都不會卡成幻燈片。
 */
function tunePerformance(dt) {
  perfFrames++;
  perfTime += dt;
  if (perfFrames < 90) return;

  const avg = perfTime / perfFrames;
  perfFrames = 0;
  perfTime = 0;

  if (isPaused()) return;

  const maxRatio = Math.min(window.devicePixelRatio || 1, 2);
  if (avg > 1 / 38 && pixelRatio > 0.8) {
    pixelRatio = Math.max(0.8, pixelRatio - 0.2);
    renderer.setPixelRatio(pixelRatio);
  } else if (avg < 1 / 57 && pixelRatio < maxRatio) {
    pixelRatio = Math.min(maxRatio, pixelRatio + 0.1);
    renderer.setPixelRatio(pixelRatio);
  }
}

function updatePrompt() {
  if (state.menuOpen || state.videoOpen || fading) return;

  if (state.mode === 'plaza') {
    let near = null;
    let best = 1e9;
    for (const g of plaza.gates) {
      if (g.zone.open === false) continue;
      const d = Math.hypot(player.pos.x - g.trigger.x, player.pos.z - g.trigger.z);
      if (d < 2.9 && d < best) {
        best = d;
        near = g;
      }
    }
    if (near) {
      hud.showPrompt(t('enter') + ' · ' + pick(near.zone.title), () => enterZone(near.zone));
    } else {
      hud.hidePrompt();
    }
  } else if (state.zone) {
    if (room && room.hasVideo) {
      hud.showPrompt(t('play') + ' · ' + pick(state.zone.title), () => playZoneVideo(state.zone));
    } else {
      hud.hidePrompt();
    }
  }
}

/* ---------------- 進出展館 ---------------- */
function fadeTo(fn) {
  if (fading) return;
  fading = true;
  const el = document.getElementById('fade');
  el.classList.add('on');

  setTimeout(() => {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
    snapCamera();
    requestAnimationFrame(() => {
      el.classList.remove('on');
      setTimeout(() => {
        fading = false;
      }, 340);
    });
  }, 280);
}

function enterZone(zone) {
  if (!zone || zone.open === false) return;
  if (state.mode === 'room' && state.zone && state.zone.id === zone.id) return;
  hud.hidePrompt();

  fadeTo(() => {
    if (state.mode === 'plaza') {
      savedPos.copy(player.pos);
      savedYaw = player.yaw;
    }
    if (room) {
      scene.remove(room.group);
      room = null;
    }
    scene.remove(plaza.group);

    let r = roomCache.get(zone.id);
    if (!r) {
      r = buildRoom(zone);
      roomCache.set(zone.id, r);
    }
    room = r;
    scene.add(room.group);

    state.mode = 'room';
    state.zone = zone;
    applyFov();

    player.pos.copy(room.spawn);
    player.face(room.yaw);
    colliders = room.colliders;
    bounds = room.bounds;

    avatar.position.copy(player.pos);
    avatar.rotation.y = player.yaw;

    hud.clearLabels();
    hud.setHeader(pick(zone.title) + ' · ' + pick(zone.theme));
    hud.showBack(true, '← ' + t('back'));

    // 第一次進入有相片的展館，提示可以點相片放大
    if (zone.photos && zone.photos.length && !hintedRooms.has(zone.id)) {
      hintedRooms.add(zone.id);
      setTimeout(() => hud.toast(t('clickPhoto'), 4200), 700);
    }

    if (pendingPhoto != null && zone.photos && zone.photos.length) {
      const at = pendingPhoto;
      pendingPhoto = null;
      setTimeout(() => openLightbox(zone.photos, at, pick(zone.title) + ' · ' + pick(zone.theme)), 500);
    }
  });
}

function exitRoom() {
  if (state.mode !== 'room') return;
  hud.hidePrompt();
  closeLightbox();
  if (renderer) renderer.domElement.style.cursor = '';

  fadeTo(() => {
    if (room) {
      scene.remove(room.group);
      room = null;
    }
    scene.add(plaza.group);

    state.mode = 'plaza';
    state.zone = null;
    applyFov();

    player.pos.copy(savedPos);
    player.face(savedYaw);
    colliders = plaza.colliders;
    bounds = plaza.bounds;

    avatar.position.copy(player.pos);
    avatar.rotation.y = player.yaw;

    hud.showBack(false);
    hud.setHeader(null);
    addGateLabels();
  });
}

function playZoneVideo(zone) {
  const v = (zone.videos && zone.videos[0]) || {};
  openVideo(v, t('soon'));
}

/* ---------------- 標籤 ---------------- */
function addGateLabels() {
  hud.clearLabels();
  for (const g of plaza.gates) {
    const open = g.zone.open !== false;
    hud.addLabel(g.labelAnchor, () =>
      pick(g.zone.title) + ' · ' + (open ? pick(g.zone.theme) : t('closed'))
    );
  }
}

/* ---------------- 語言 / 角色 / 全螢幕 ---------------- */
function toggleLang() {
  const next = getLang() === 'zh' ? 'en' : 'zh';
  setLang(next);
  localStorage.setItem('campus.lang', next);
  document.title = t('title');
  hud.refreshMenu();
  hud.setGenderLabel(state.gender);
  hud.setCamLabel(state.front);
  if (state.mode === 'room' && state.zone) {
    hud.setHeader(pick(state.zone.title) + ' · ' + pick(state.zone.theme));
    hud.showBack(true, '← ' + t('back'));
  } else {
    hud.setHeader(null);
    addGateLabels();
  }
}

function toggleGender() {
  state.gender = state.gender === 'boy' ? 'girl' : 'boy';
  applyGender();
  hud.setGenderLabel(state.gender);
  localStorage.setItem('campus.gender', state.gender);
}

function toggleCam() {
  state.front = !state.front;
  snapCamera();
  hud.setCamLabel(state.front);
}

function toggleFullscreen() {  const d = document.documentElement;
  if (!document.fullscreenElement) {
    if (d.requestFullscreen) d.requestFullscreen().catch(() => {});
  } else if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

/* ---------------- 相片點擊放大 ---------------- */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let tapX = 0;
let tapY = 0;
let tapT = 0;

function pickPhotoAt(cx, cy) {
  if (!room) return null;

  const targets = [];
  if (room.photoSpots) {
    for (const m of room.photoSpots) if (m && m.visible && m.parent) targets.push(m);
  }
  if (room.screenPick && room.screenPick.mesh && room.screenPick.mesh.visible) {
    targets.push(room.screenPick.mesh);
  }
  if (!targets.length) return null;

  ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return null;

  if (room.screenPick && hit.object === room.screenPick.mesh) {
    return { index: room.screenPick.index() };
  }
  return { index: hit.object.userData.photoIndex || 0 };
}

function bindPhotoPicking() {
  const canvas = renderer.domElement;
  let hoverAt = 0;

  canvas.addEventListener('pointerdown', (e) => {
    tapX = e.clientX;
    tapY = e.clientY;
    tapT = performance.now();
  });

  // 輕點（不是拖曳）才當作「點相片」
  canvas.addEventListener('pointerup', (e) => {
    if (state.mode !== 'room' || isPaused()) {
      if (DEBUG) window.__lastPick = 'blocked mode=' + state.mode + ' paused=' + isPaused();
      return;
    }
    if (Math.hypot(e.clientX - tapX, e.clientY - tapY) > 14) return;
    if (performance.now() - tapT > 700) return;

    const hit = pickPhotoAt(e.clientX, e.clientY);
    const zone = state.zone;
    if (DEBUG) window.__lastPick = hit ? 'HIT ' + hit.index : 'MISS';
    if (!hit || !zone || !zone.photos || !zone.photos.length) return;

    openLightbox(zone.photos, hit.index, pick(zone.title) + ' · ' + pick(zone.theme));
  });

  // 桌面：滑過相片時換游標
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (state.mode !== 'room') {
      canvas.style.cursor = '';
      return;
    }
    const now = performance.now();
    if (now - hoverAt < 120) return;
    hoverAt = now;
    canvas.style.cursor = pickPhotoAt(e.clientX, e.clientY) ? 'zoom-in' : '';
  });
}

/* ---------------- 輸入 ---------------- */
function bindInput() {
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') {
      input.fwd = true;
      e.preventDefault();
    } else if (k === 'arrowdown' || k === 's') {
      input.back = true;
      e.preventDefault();
    } else if (k === 'arrowleft' || k === 'a') {
      if (!e.repeat && !isPaused()) player.turnLeft();
      e.preventDefault();
    } else if (k === 'arrowright' || k === 'd') {
      if (!e.repeat && !isPaused()) player.turnRight();
      e.preventDefault();
    } else if (k === 'pageup' || k === 'q') {
      if (!isPaused()) nudgePitch(1);
      e.preventDefault();
    } else if (k === 'pagedown' || k === 'z') {
      if (!isPaused()) nudgePitch(-1);
      e.preventDefault();
    } else if (k === 'e' || k === 'enter') {
      if (!isPaused()) hud.el.promptBtn.click();
    } else if (k === 'escape') {
      if (state.photoOpen) return; // 放大層自己處理 Esc
      if (state.videoOpen) return;
      if (state.menuOpen) hud.closeMenu();
      else if (state.mode === 'room') exitRoom();
    }
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') input.fwd = false;
    if (k === 'arrowdown' || k === 's') input.back = false;
  });

  window.addEventListener('blur', () => {
    input.fwd = false;
    input.back = false;
  });
}

function bindButtons() {
  const hold = (el, fn) => {
    let t1 = 0;
    let t2 = 0;
    const start = (e) => {
      e.preventDefault();
      if (isPaused()) return;
      fn();
      el.classList.add('on');
      t1 = setTimeout(() => {
        t2 = setInterval(() => {
          if (!isPaused()) fn();
        }, 180);
      }, 380);
    };
    const end = () => {
      clearTimeout(t1);
      clearInterval(t2);
      el.classList.remove('on');
    };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', end);
  };

  hold(document.getElementById('turnL'), () => player.turnLeft());
  hold(document.getElementById('turnR'), () => player.turnRight());
  hold(document.getElementById('lookUp'), () => nudgePitch(1));
  hold(document.getElementById('lookDown'), () => nudgePitch(-1));

  const press = (el, set) => {
    const start = (e) => {
      e.preventDefault();
      set(true);
      el.classList.add('on');
    };
    const end = () => {
      set(false);
      el.classList.remove('on');
    };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', end);
  };

  press(document.getElementById('fwd'), (v) => {
    input.fwd = v;
  });
  press(document.getElementById('back'), (v) => {
    input.back = v;
  });
}

function bindResize() {
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
}

/* ---------------- go ---------------- */
boot();

window.__CAMPUS__ = {
  goZone: (id) => {
    const z = content && content.zones.find((x) => x.id === id);
    if (z) enterZone(z);
  },
  plaza: () => exitRoom(),
  info: () => ({
    calls: renderer ? renderer.info.render.calls : 0,
    tris: renderer ? renderer.info.render.triangles : 0,
    textures: renderer ? renderer.info.memory.textures : 0,
    ratio: pixelRatio,
  }),
  state,
};
