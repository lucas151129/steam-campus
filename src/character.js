import * as THREE from '../vendor/three.module.js';

/* ───────────────────────── 配色 ─────────────────────────
   校服：白襯衫、紫色領帶（男）／紫色緞帶與腰帶（女）、
   灰長褲（男）／白裙（女）、海軍藍鞋、胸口 MKPC。
   所有顏色最後都寫進頂點色，所以同一個動畫節點只需要一個 mesh。 */
const C = {
  white: 0xf9f8f5,
  white2: 0xeeeae1, // 衣領、襪頭等略深一點的白，靠明度差做出層次
  purple: 0x7a4e9e,
  purpleSoft: 0xb49ac9, // 袖口線
  purpleDark: 0x5b3a78,
  grey: 0x6e6f73,
  greyDark: 0x5c5d62,
  navy: 0x2b2b4a,
  navyLight: 0x3b3b60, // 鞋頭
  brown: 0x6b4a2f,
  mouth: 0xd8737c,
  ink: 0x2a2233, // 眼
  frame: 0x3b3350, // 眼鏡框
  sole: 0xe9e4d7, // 鞋底（米白）
  pleat: 0xdcd8cc, // 裙褶
  clip: 0xcf9fe0, // 髮夾
  buckle: 0xd6cfe0,
};

/* 三個 variant 的膚色：只做很細的差別，避免看起來像換了人種 */
const SKIN = [0xf3d3b5, 0xf7dcc4, 0xebc5a4];
/* 三個 variant 的身高倍率（±4%） */
const HEIGHT = [1.0, 1.04, 0.96];

/* 全體角色共用一種材質：顏色寫在頂點上。
   這樣「同一個動畫節點、不同顏色的方塊」也能併成同一個 draw call。 */
const BODY_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

/* ─────────────────── 幾何合併（自己寫，不用 addons） ───────────────────
   toNonIndexed() → 套 matrix（含法線）→ 串接 position / normal / uv / color
   → 一個 BufferGeometry。手臂、腿、頭各自一個節點，所以分開合併。 */
const _m4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _col = new THREE.Color();

function addGeo(list, geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  _euler.set(rx, ry, rz);
  _m4.compose(_pos.set(x, y, z), _quat.setFromEuler(_euler), _one);
  g.applyMatrix4(_m4);
  list.push({ g, color });
}

function addBox(list, w, h, d, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  addGeo(list, new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
}

/**
 * 把收集清單合併成單一 BufferGeometry。
 * 清單項：{ g: BufferGeometry（已套好矩陣）, color: 16 進位數字或 THREE.Color }
 */
function mergeBlocks(list) {
  let total = 0;
  for (const it of list) total += it.g.attributes.position.count;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const color = new Float32Array(total * 3);

  let o = 0;
  for (const it of list) {
    const attr = it.g.attributes;
    const count = attr.position.count;
    position.set(attr.position.array, o * 3);
    normal.set(attr.normal.array, o * 3);
    if (attr.uv) uv.set(attr.uv.array, o * 2);

    // Color.set() 會把 sRGB 的 16 進位顏色轉成線性工作色彩空間，
    // 跟 material.color 的行為一致，所以頂點色與原本的材質色看起來相同。
    _col.set(it.color);
    for (let i = 0; i < count; i++) {
      const k = (o + i) * 3;
      color[k] = _col.r;
      color[k + 1] = _col.g;
      color[k + 2] = _col.b;
    }
    o += count;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** 一個節點 = 一個 mesh */
function meshOf(list) {
  return new THREE.Mesh(mergeBlocks(list), BODY_MAT);
}

/* ───────────────────────── MKPC 名牌貼圖 ───────────────────────── */
let logoTex = null;
function logoTexture() {
  if (logoTex) return logoTex;
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 208;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 512, 208);

  // 名牌底：淡紫白 + 紫色細框，看起來像縫在襯衫上
  const rr = (x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  rr(7, 7, 498, 194, 24);
  g.fillStyle = '#f7f3fb';
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = '#7a4e9e';
  g.stroke();
  rr(22, 22, 468, 164, 14);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(122, 78, 158, 0.35)';
  g.stroke();

  g.fillStyle = '#5b3a78';
  g.font = 'italic 700 112px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('MKPC', 256, 106);

  logoTex = new THREE.CanvasTexture(cv);
  logoTex.colorSpace = THREE.SRGBColorSpace;
  logoTex.anisotropy = 4;
  return logoTex;
}

let badgeMat = null;
function badgeMaterial() {
  if (!badgeMat) {
    badgeMat = new THREE.MeshLambertMaterial({
      map: logoTexture(),
      transparent: true,
      depthWrite: false,
    });
  }
  return badgeMat;
}

/**
 * 低多邊形校服小人（模型面向 +Z）。
 * 由程式砌成，所以任何角度都成立；換成 Blender 模型時只要換掉 group 即可。
 *
 * opts.hair    髮色（16 進位數字），必須保留
 * opts.variant 0 / 1 / 2，決定髮型、膚色深淺、身高 ±4%
 * opts.skin    直接指定膚色（優先於 variant）
 * opts.height  直接指定身高倍率
 */
export function buildCharacter(gender = 'boy', opts = {}) {
  const girl = gender === 'girl';
  const variant = opts.variant === 1 || opts.variant === 2 ? opts.variant : 0;

  const skinHex = opts.skin != null ? opts.skin : SKIN[variant];
  const skin = new THREE.Color(skinHex);
  const skinNose = skin.clone().multiplyScalar(0.93); // 鼻子的淡淡陰影
  const brow = new THREE.Color(opts.hair != null ? opts.hair : girl ? C.navy : C.brown).multiplyScalar(0.8);
  const height = opts.height != null ? opts.height : HEIGHT[variant];
  const hair = opts.hair != null ? opts.hair : girl ? C.navy : C.brown;

  const root = new THREE.Group();
  root.scale.setScalar(height);
  const bob = new THREE.Group(); // 走路起伏 / 呼吸
  root.add(bob);

  /* ─────────── 腿與鞋（左右各自一個節點） ─────────── */
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.115, 0.62, 0);
    const L = [];

    if (girl) {
      addBox(L, 0.17, 0.36, 0.18, skin, 0, -0.14, 0); // 大腿（裙內）
      addBox(L, 0.175, 0.22, 0.185, C.white, 0, -0.41, 0); // 白襪
      addBox(L, 0.18, 0.028, 0.19, C.white2, 0, -0.3, 0); // 襪頭細邊
    } else {
      addBox(L, 0.185, 0.56, 0.2, C.grey, 0, -0.28, 0); // 灰長褲
      addBox(L, 0.195, 0.03, 0.21, C.greyDark, 0, -0.505, 0); // 褲腳反摺
    }

    // 鞋：鞋面 + 鞋底 + 鞋頭
    addBox(L, 0.2, 0.085, 0.29, C.navy, 0, -0.555, 0.045);
    addBox(L, 0.212, 0.045, 0.305, C.sole, 0, -0.5975, 0.045);
    addBox(L, 0.185, 0.05, 0.055, C.navyLight, 0, -0.565, 0.178);

    hip.add(meshOf(L));
    bob.add(hip);
    legs.push(hip);
  }

  /* ─────────── 軀幹 ─────────── */
  const T = [];

  if (girl) {
    // 連衣裙：上衣 + 裙 + 腰線（紫色腰帶）
    addBox(T, 0.48, 0.5, 0.3, C.white, 0, 0.94, 0);
    addBox(T, 0.53, 0.34, 0.33, C.white, 0, 0.715, 0); // 裙 0.545~0.885
    addBox(T, 0.545, 0.055, 0.345, C.white2, 0, 0.575, 0); // 裙腳摺邊
    addBox(T, 0.545, 0.05, 0.34, C.purple, 0, 0.878, 0); // 腰線
    addBox(T, 0.55, 0.016, 0.345, C.purpleDark, 0, 0.845, 0); // 腰線下方細影

    // 裙褶：正面三條、背面三條（玩家多數時間看見背面）
    for (const px of [-0.17, 0, 0.17]) addBox(T, 0.014, 0.25, 0.008, C.pleat, px, 0.72, 0.1665);
    for (const px of [-0.17, 0, 0.17]) addBox(T, 0.014, 0.25, 0.008, C.pleat, px, 0.72, -0.1665);

    // 衣領（緞帶下方的 V 字翻領）：跟襯衫同色，靠立體厚度做出領口邊線
    addBox(T, 0.225, 0.058, 0.205, C.white, 0, 1.156, 0);
    addBox(T, 0.082, 0.088, 0.02, C.white, -0.055, 1.116, 0.153, -0.22, 0, 0.45);
    addBox(T, 0.082, 0.088, 0.02, C.white, 0.055, 1.116, 0.153, -0.22, 0, -0.45);

    // 紫色緞帶：結 + 兩耳 + 兩條飄帶
    addBox(T, 0.045, 0.042, 0.032, C.purple, 0, 1.148, 0.174);
    addBox(T, 0.065, 0.062, 0.026, C.purple, -0.05, 1.151, 0.169, 0, 0, 0.3);
    addBox(T, 0.065, 0.062, 0.026, C.purple, 0.05, 1.151, 0.169, 0, 0, -0.3);
    addBox(T, 0.032, 0.085, 0.022, C.purple, -0.024, 1.085, 0.167, 0, 0, 0.18);
    addBox(T, 0.032, 0.085, 0.022, C.purple, 0.024, 1.085, 0.167, 0, 0, -0.18);
  } else {
    // 襯衫 + 皮帶
    addBox(T, 0.52, 0.56, 0.3, C.white, 0, 0.9, 0);
    addBox(T, 0.34, 0.16, 0.26, C.grey, 0, 0.6, 0); // 褲襠，避免兩腿之間穿幫
    addBox(T, 0.535, 0.055, 0.315, C.navy, 0, 0.645, 0);
    addBox(T, 0.07, 0.045, 0.02, C.buckle, 0, 0.645, 0.159);
    addBox(T, 0.52, 0.012, 0.005, C.white2, 0, 1.09, -0.152); // 背部過肩線

    // 衣領：領圈貼着脖子，兩片翻領在領帶後面收成 V 字
    addBox(T, 0.23, 0.058, 0.21, C.white, 0, 1.156, 0);
    addBox(T, 0.082, 0.092, 0.02, C.white, -0.057, 1.114, 0.153, -0.22, 0, 0.45);
    addBox(T, 0.082, 0.092, 0.02, C.white, 0.057, 1.114, 0.153, -0.22, 0, -0.45);

    // 領帶：結 + 帶身 + 尖端（結壓在翻領前面）
    addBox(T, 0.075, 0.065, 0.036, C.purple, 0, 1.125, 0.163);
    addBox(T, 0.062, 0.3, 0.03, C.purple, 0, 0.93, 0.156);
    addBox(T, 0.062, 0.062, 0.03, C.purple, 0, 0.775, 0.156, 0, 0, Math.PI / 4);
  }

  // 胸前的 MKPC 名牌：貼在角色左胸，避開領帶／緞帶
  const badgeW = girl ? 0.175 : 0.19;
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(badgeW, badgeW / 2.46), badgeMaterial());
  badge.position.set(0.14, 0.985, 0.1545);
  bob.add(badge);

  bob.add(meshOf(T));

  /* ─────────── 手臂：上臂一個節點、前臂一個節點（可以彎肘） ─────────── */
  const arms = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.3, 1.13, 0);
    const A = [];
    // 短袖：頂端與襯衫肩線齊平，從上面看是一片連續的肩
    addBox(A, 0.155, 0.19, 0.185, C.white, 0, -0.045, 0);
    addBox(A, 0.161, 0.028, 0.191, C.purpleSoft, 0, -0.132, 0); // 袖口線
    addBox(A, 0.13, 0.12, 0.145, skin, 0, -0.175, 0); // 上臂
    shoulder.add(meshOf(A));

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.25, 0);
    const B = [];
    addBox(B, 0.12, 0.22, 0.135, skin, 0, -0.1, 0); // 前臂
    addBox(B, 0.125, 0.095, 0.14, skin, 0, -0.245, 0.005); // 手掌
    elbow.add(meshOf(B));

    shoulder.add(elbow);
    bob.add(shoulder);
    arms.push({ shoulder, elbow, sx });
  }

  /* ─────────── 頭 ─────────── */
  const head = new THREE.Group();
  head.position.set(0, 1.2, 0);
  const H = [];

  addBox(H, 0.4, 0.4, 0.4, skin, 0, 0.215, 0); // 頭
  addBox(H, 0.15, 0.09, 0.15, skin, 0, -0.015, 0); // 頸
  addBox(H, 0.05, 0.085, 0.085, skin, -0.215, 0.205, 0); // 耳
  addBox(H, 0.05, 0.085, 0.085, skin, 0.215, 0.205, 0);

  // 眼睛（含高光）：眼白在高光位置留一點亮點，3~4 米外仍然有神
  for (const sx of [-1, 1]) {
    addBox(H, 0.06, 0.075, 0.018, C.ink, sx * 0.083, 0.215, 0.202);
    addBox(H, 0.017, 0.02, 0.012, C.white, sx * 0.083 - 0.012, 0.232, 0.209);
    // 眉毛：放在眼鏡框之上，顏色跟着髮色走
    addBox(H, 0.072, 0.019, 0.016, brow, sx * 0.083, 0.288, 0.202, 0, 0, sx * 0.09);
  }

  addBox(H, 0.03, 0.035, 0.022, skinNose, 0, 0.163, 0.203); // 鼻
  // 嘴：三段小方塊拼成的微笑
  addBox(H, 0.05, 0.019, 0.016, C.mouth, 0, 0.115, 0.203);
  addBox(H, 0.02, 0.017, 0.016, C.mouth, -0.028, 0.121, 0.203);
  addBox(H, 0.02, 0.017, 0.016, C.mouth, 0.028, 0.121, 0.203);

  if (girl) {
    buildGirlHair(H, hair, variant);
    addBox(H, 0.095, 0.02, 0.018, C.clip, -0.152, 0.31, 0.208, 0, 0, 0.45); // 髮夾（交叉兩條）
    addBox(H, 0.095, 0.02, 0.018, C.clip, -0.152, 0.31, 0.207, 0, 0, -0.45);
  } else {
    buildBoyHair(H, hair, variant);
    // 圓框眼鏡：細環 + 鼻樑 + 鏡腳
    for (const sx of [-1, 1]) {
      addGeo(H, new THREE.TorusGeometry(0.056, 0.0065, 4, 14), C.frame, sx * 0.083, 0.215, 0.216);
    }
    addBox(H, 0.046, 0.011, 0.011, C.frame, 0, 0.222, 0.216);
    addBox(H, 0.011, 0.011, 0.1, C.frame, -0.201, 0.226, 0.16);
    addBox(H, 0.011, 0.011, 0.1, C.frame, 0.201, 0.226, 0.16);
  }

  head.add(meshOf(H));
  bob.add(head);

  /* ─────────── 動作 ─────────── */
  const phase = { v: 0 };

  function update(dt, ratio, idle = false) {
    const r = Math.max(0, Math.min(1, ratio || 0));
    phase.v += dt * (2.1 + r * 9.0);

    const sw = Math.sin(phase.v) * 0.6 * r;
    legs[0].rotation.x = sw;
    legs[1].rotation.x = -sw;

    // 手臂與同側腿反向擺；前臂永遠微微內彎
    for (let i = 0; i < 2; i++) {
      const a = arms[i];
      const swing = (i === 0 ? -sw : sw) * 0.85;
      a.shoulder.rotation.x = swing;
      a.shoulder.rotation.z = a.sx * 0.045;
      a.elbow.rotation.x = -(0.12 + Math.max(0, -swing) * 0.55);
      a.elbow.rotation.z = 0;
    }

    // 走路時上下起伏；閒站時只剩呼吸與極輕微的重心左右移
    const breathe = idle ? Math.sin(phase.v * 0.5) * 0.009 : 0;
    bob.position.y = Math.abs(Math.sin(phase.v)) * 0.03 * r + breathe;
    bob.rotation.z = idle ? Math.sin(phase.v * 0.31) * 0.012 : 0;
  }

  return {
    group: root,
    update,
    // 給 npc.js 用的節點；main.js 只需要 group 與 update
    nodes: {
      bob,
      head,
      armL: arms[1].shoulder, // +X = 角色左臂
      armR: arms[0].shoulder, // -X = 角色右臂
      elbowL: arms[1].elbow,
      elbowR: arms[0].elbow,
      legL: legs[1],
      legR: legs[0],
    },
    gender: girl ? 'girl' : 'boy',
    variant,
  };
}

/* ───────────────────────── 頭髮 ─────────────────────────
   全部用方塊疊出來，保持低多邊形的方塊感。
   髮線（前額下緣）都留在眉毛之上，免得蓋住表情；
   後腦一定要蓋到頸背，否則背影會像禿了一塊。 */

function buildBoyHair(H, hair, variant) {
  if (variant === 1) {
    // 側分：一邊厚、一邊薄，瀏海斜斜掃過去
    addBox(H, 0.42, 0.08, 0.42, hair, 0, 0.383, 0);
    addBox(H, 0.42, 0.3, 0.09, hair, 0, 0.26, -0.19);
    addBox(H, 0.045, 0.11, 0.28, hair, -0.2, 0.335, -0.06);
    addBox(H, 0.045, 0.11, 0.28, hair, 0.2, 0.335, -0.06);
    addBox(H, 0.22, 0.06, 0.025, hair, -0.09, 0.338, 0.206);
    addBox(H, 0.16, 0.045, 0.025, hair, 0.115, 0.355, 0.206);
    addBox(H, 0.1, 0.05, 0.025, hair, 0.02, 0.348, 0.208, 0, 0, 0.22);
  } else if (variant === 2) {
    // 圓頭：厚瀏海 + 兩側蓋住耳朵
    addBox(H, 0.43, 0.1, 0.43, hair, 0, 0.375, 0);
    addBox(H, 0.34, 0.05, 0.34, hair, 0, 0.437, 0);
    addBox(H, 0.43, 0.05, 0.03, hair, 0, 0.335, 0.203);
    addBox(H, 0.05, 0.2, 0.4, hair, -0.21, 0.28, -0.03);
    addBox(H, 0.05, 0.2, 0.4, hair, 0.21, 0.28, -0.03);
    addBox(H, 0.43, 0.3, 0.1, hair, 0, 0.25, -0.19);
  } else {
    // 短髮：乾淨的平頭，後面蓋到頸背
    addBox(H, 0.42, 0.09, 0.42, hair, 0, 0.378, 0);
    addBox(H, 0.42, 0.32, 0.09, hair, 0, 0.25, -0.19);
    addBox(H, 0.045, 0.12, 0.3, hair, -0.2, 0.33, -0.06);
    addBox(H, 0.045, 0.12, 0.3, hair, 0.2, 0.33, -0.06);
    addBox(H, 0.4, 0.045, 0.02, hair, 0, 0.345, 0.206);
  }
}

function buildGirlHair(H, hair, variant) {
  if (variant === 1) {
    // 長髮側分：髮尾到腰，末端收窄
    addBox(H, 0.44, 0.09, 0.44, hair, 0, 0.38, 0);
    addBox(H, 0.42, 0.62, 0.14, hair, 0, 0.1, -0.215);
    addBox(H, 0.36, 0.14, 0.12, hair, 0, -0.28, -0.21);
    addBox(H, 0.06, 0.54, 0.4, hair, -0.215, 0.14, -0.01);
    addBox(H, 0.06, 0.54, 0.4, hair, 0.215, 0.14, -0.01);
    addBox(H, 0.24, 0.055, 0.03, hair, -0.07, 0.335, 0.203, 0, 0, 0.1);
    addBox(H, 0.18, 0.045, 0.03, hair, 0.12, 0.35, 0.203);
  } else if (variant === 2) {
    // 高馬尾：髮圈 + 一束往後下方垂
    addBox(H, 0.44, 0.09, 0.44, hair, 0, 0.38, 0);
    addBox(H, 0.42, 0.38, 0.13, hair, 0, 0.21, -0.205);
    addBox(H, 0.05, 0.2, 0.34, hair, -0.215, 0.3, -0.03);
    addBox(H, 0.05, 0.2, 0.34, hair, 0.215, 0.3, -0.03);
    addBox(H, 0.44, 0.05, 0.03, hair, 0, 0.327, 0.203);
    addBox(H, 0.075, 0.055, 0.075, C.purple, 0, 0.4, -0.245); // 髮圈
    addBox(H, 0.13, 0.14, 0.12, hair, 0, 0.46, -0.28);
    addBox(H, 0.11, 0.2, 0.1, hair, 0.01, 0.34, -0.31);
    addBox(H, 0.09, 0.14, 0.09, hair, 0.02, 0.2, -0.33);
  } else {
    // 短鮑伯 + 齊瀏海，髮尾微微收窄
    addBox(H, 0.44, 0.1, 0.44, hair, 0, 0.375, 0);
    addBox(H, 0.42, 0.38, 0.14, hair, 0, 0.21, -0.215);
    addBox(H, 0.36, 0.12, 0.13, hair, 0, -0.04, -0.21);
    addBox(H, 0.06, 0.4, 0.4, hair, -0.215, 0.21, -0.01);
    addBox(H, 0.06, 0.4, 0.4, hair, 0.215, 0.21, -0.01);
    addBox(H, 0.44, 0.05, 0.03, hair, 0, 0.327, 0.203);
  }
}
