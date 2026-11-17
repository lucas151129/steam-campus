import * as THREE from '../vendor/three.module.js';

/* =====================================================================
   STEAM DAY 虛擬校園 —— 廣場與展館的場景美術
   ---------------------------------------------------------------------
   ・廣場所有同材質的零件都會合併成一個幾何體，控制 draw call。
   ・相片貼圖用模組層快取，相片牆與大螢幕共用同一張 THREE.Texture。
   ===================================================================== */

export const WORLD = { size: 56, plazaR: 22, gateR: 17 };

const TAU = Math.PI * 2;

const ROAD_HALF = 2.2; // 道路中線左右各 2.2 米保持淨空
const CENTER_CLEAR = 5.2; // 廣場中央 5 米範圍保持淨空
const GATE_R = WORLD.gateR;
const GATE_HALF = 4.2; // 展館的碰撞半徑（與原本一致）

const CJK = '"Noto Sans TC","Microsoft JhengHei","PingFang TC",system-ui,sans-serif';
const WHITE = new THREE.Color(0xffffff);

/* ===================== 共用小工具 ===================== */

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h === undefined ? w : h;
  return c;
}

function canvasTexture(cv, opt) {
  const o = opt || {};
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = o.aniso === undefined ? 8 : o.aniso;
  if (o.repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(o.repeat, o.repeat);
  }
  return tex;
}

/* 一個柔邊的圓形貼圖：樹影、燈光地面光暈、積水高光都靠它 */
let softTex = null;
function softCircleTexture() {
  if (softTex) return softTex;
  const S = 256;
  const cv = canvas2d(S);
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.42, 'rgba(255,255,255,.66)');
  grd.addColorStop(0.72, 'rgba(255,255,255,.2)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  softTex = canvasTexture(cv);
  return softTex;
}

/* =====================================================================
   幾何體批次：把大量小零件合成一個 BufferGeometry
   （不用 three 的 addons，自己拼 position / normal / uv / color）
   ===================================================================== */

class Batch {
  constructor() {
    this.items = [];
  }

  add(geo, opt) {
    this.items.push({ geo, opt: opt || {} });
    return this;
  }

  geometry() {
    const prepared = [];
    let total = 0;

    for (let k = 0; k < this.items.length; k++) {
      const geo = this.items[k].geo;
      const opt = this.items[k].opt;

      const g = geo.index ? geo.toNonIndexed() : geo.clone();

      const m = new THREE.Matrix4();
      if (opt.matrix) {
        m.copy(opt.matrix);
      } else {
        const q = new THREE.Quaternion().setFromEuler(
          /* YXZ：先做零件自身的傾斜，再整體轉向，道具才會朝向正確 */
          new THREE.Euler(opt.rx || 0, opt.ry || 0, opt.rz || 0, 'YXZ')
        );
        const s = opt.s === undefined ? 1 : opt.s;
        m.compose(
          new THREE.Vector3(opt.x || 0, opt.y || 0, opt.z || 0),
          q,
          new THREE.Vector3(
            opt.sx === undefined ? s : opt.sx,
            opt.sy === undefined ? s : opt.sy,
            opt.sz === undefined ? s : opt.sz
          )
        );
      }
      if (opt.parent) m.premultiply(opt.parent);
      g.applyMatrix4(m);

      /* 把 0..1 的 uv 重新對應到貼圖集的小格子 */
      if (opt.uv) {
        const uv = g.attributes.uv;
        const u0 = opt.uv[0];
        const v0 = opt.uv[1];
        const u1 = opt.uv[2];
        const v1 = opt.uv[3];
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
        }
      }

      const col = new THREE.Color();
      if (opt.color === undefined) col.copy(WHITE);
      else col.set(opt.color);

      prepared.push(g, col);
      total += g.attributes.position.count;
    }

    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    const cols = new Float32Array(total * 3);

    let o = 0;
    for (let k = 0; k < prepared.length; k += 2) {
      const g = prepared[k];
      const c = prepared[k + 1];
      const n = g.attributes.position.count;

      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      uvs.set(g.attributes.uv.array, o * 2);
      for (let i = 0; i < n; i++) {
        cols[(o + i) * 3] = c.r;
        cols[(o + i) * 3 + 1] = c.g;
        cols[(o + i) * 3 + 2] = c.b;
      }

      o += n;
      g.dispose();
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    out.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    out.computeBoundingSphere();
    return out;
  }

  mesh(material) {
    return new THREE.Mesh(this.geometry(), material);
  }
}

/* 以頂點色上色的 Lambert 材質：一個材質畫完整批零件 */
function vertexLambert() {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

/* 發光面片：不屬於燈光系統，只是看起來會亮 */
function vertexBasic() {
  return new THREE.MeshBasicMaterial({ vertexColors: true });
}

/* 疊加光暈（門縫光、路燈地面光斑） */
function addGlowMaterial(opacity) {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    map: softCircleTexture(),
  });
}

/* ===================== 廣場地面貼圖 ===================== */

function groundTexture(zones) {
  const S = 2048;
  const W = WORLD.size;
  const s = S / W;
  const c = S / 2;
  const cv = canvas2d(S);
  const g = cv.getContext('2d');
  const n = zones.length || 6;

  /* 草地 */
  g.fillStyle = '#7fbe63';
  g.fillRect(0, 0, S, S);

  for (let i = 0; i < 170; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 26 + Math.random() * 150;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, i % 2 ? 'rgba(255,255,255,.055)' : 'rgba(56,112,46,.06)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  /* 放射道路：路肩 + 鋪面 + 接縫 + 中央白虛線 */
  zones.forEach((z, i) => {
    const th = (i * TAU) / n;
    g.save();
    g.translate(c, c);
    g.rotate(th);

    g.fillStyle = '#d8c8a7';
    g.fillRect(-2.34 * s, -20.0 * s, 4.68 * s, 20.0 * s);

    g.fillStyle = '#e9dcc0';
    g.fillRect(-2.0 * s, -20.0 * s, 4.0 * s, 20.0 * s);

    g.strokeStyle = 'rgba(188,170,138,.5)';
    g.lineWidth = 2;
    for (let r = 6.4; r < 19.6; r += 1.15) {
      g.beginPath();
      g.moveTo(-2.0 * s, -r * s);
      g.lineTo(2.0 * s, -r * s);
      g.stroke();
    }

    g.fillStyle = 'rgba(255,255,255,.92)';
    for (let r = 5.8; r < 18.6; r += 2.6) g.fillRect(-0.22 * s, -r * s, 0.44 * s, 1.15 * s);

    g.restore();
  });

  /* 中央廣場圓盤 */
  g.fillStyle = '#efe3ca';
  g.beginPath();
  g.arc(c, c, 5.2 * s, 0, TAU);
  g.fill();

  g.strokeStyle = 'rgba(150,120,180,.35)';
  g.lineWidth = 0.16 * s;
  g.beginPath();
  g.arc(c, c, 5.2 * s, 0, TAU);
  g.stroke();

  g.lineWidth = 0.1 * s;
  g.strokeStyle = 'rgba(150,120,180,.3)';
  g.beginPath();
  g.arc(c, c, 3.55 * s, 0, TAU);
  g.stroke();

  /* 中央徽章：紫色放射狀羅盤紋 */
  g.save();
  g.translate(c, c);
  g.fillStyle = 'rgba(122,78,158,.16)';
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    g.save();
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(1.9 * s, -0.28 * s);
    g.lineTo(1.9 * s, 0.28 * s);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.fillStyle = 'rgba(122,78,158,.55)';
  g.beginPath();
  g.arc(0, 0, 0.95 * s, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,.75)';
  g.beginPath();
  g.arc(0, 0, 0.5 * s, 0, TAU);
  g.fill();
  g.restore();

  /* 外緣過渡到遠景草地顏色，避免看到正方形的接縫 */
  const edge = g.createRadialGradient(c, c, 19.6 * s, c, c, 28.2 * s);
  edge.addColorStop(0, 'rgba(130,192,106,0)');
  edge.addColorStop(0.72, 'rgba(130,192,106,.55)');
  edge.addColorStop(1, 'rgba(130,192,106,1)');
  g.fillStyle = edge;
  g.fillRect(0, 0, S, S);

  return canvasTexture(cv, { aniso: 8 });
}

/* ===================== 天空與雲 ===================== */

function addSky(group) {
  const cv = canvas2d(4, 256);
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0.0, '#8ac6ef');
  grd.addColorStop(0.3, '#a9d9f6');
  grd.addColorStop(0.42, '#c6e8fb');
  grd.addColorStop(0.485, '#dcf1ff'); // 與 scene.fog 同色 → 地平線無接縫
  grd.addColorStop(0.52, '#dcf1ff');
  grd.addColorStop(0.62, '#e6f6ff');
  grd.addColorStop(1.0, '#f4fbf3');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);

  const tex = canvasTexture(cv, { aniso: 1 });
  tex.minFilter = THREE.LinearFilter;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(300, 24, 16),
    new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
  );
  dome.renderOrder = -3;
  group.add(dome);
}

function cloudTexture() {
  const W = 320;
  const H = 200;
  const cv = canvas2d(W, H);
  const g = cv.getContext('2d');

  const blob = (x, y, r, a) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,' + a + ')');
    grd.addColorStop(0.6, 'rgba(255,255,255,' + a * 0.72 + ')');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  };

  blob(96, 122, 62, 0.95);
  blob(152, 100, 74, 0.98);
  blob(212, 118, 58, 0.9);
  blob(124, 146, 70, 0.86);
  blob(190, 148, 54, 0.8);
  blob(66, 146, 42, 0.7);

  return canvasTexture(cv, { aniso: 4 });
}

function addClouds(group) {
  const tex = cloudTexture();
  const b = new Batch();
  const N = 7;

  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + 0.7;
    const r = 46 + ((i * 17) % 5) * 6;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    const y = 15 + ((i * 13) % 4) * 5;
    const w = 15 + ((i * 7) % 5) * 2.6;
    const h = w * 0.55;
    b.add(new THREE.PlaneGeometry(w, h), {
      x,
      y,
      z,
      ry: Math.atan2(-x, -z),
      rx: -0.06,
    });
  }

  const mesh = b.mesh(
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      fog: false,
    })
  );
  mesh.renderOrder = -2;
  group.add(mesh);
}

/* ===================== 樹 ===================== */

/* 兩種樹共用一套程式：錐形針葉樹、圓冠闊葉樹 */
function treeGeometries() {
  const coneCrown = new Batch();
  coneCrown.add(new THREE.ConeGeometry(1.62, 2.7, 7), { y: 2.05, color: 0x4e9b45 });
  coneCrown.add(new THREE.ConeGeometry(1.24, 2.3, 7), { y: 3.3, color: 0x57a94c });
  coneCrown.add(new THREE.ConeGeometry(0.88, 1.9, 7), { y: 4.45, color: 0x63b656 });

  const roundCrown = new Batch();
  roundCrown.add(new THREE.SphereGeometry(1.42, 9, 7), { y: 4.5, color: 0x62a94c });
  roundCrown.add(new THREE.SphereGeometry(1.06, 8, 6), { x: 1.0, y: 3.9, z: 0.34, color: 0x6cb654 });
  roundCrown.add(new THREE.SphereGeometry(0.96, 8, 6), { x: -0.9, y: 4.0, z: -0.3, color: 0x58a044 });
  roundCrown.add(new THREE.SphereGeometry(0.88, 8, 6), { x: 0.15, y: 5.5, z: -0.2, color: 0x71bd58 });

  return {
    coneCrown: coneCrown.geometry(),
    roundCrown: roundCrown.geometry(),
    trunkA: new THREE.CylinderGeometry(0.15, 0.24, 1.4, 6),
    trunkB: new THREE.CylinderGeometry(0.18, 0.32, 2.9, 6),
  };
}

function addTrees(group) {
  const geo = treeGeometries();

  const N = 54;
  const cones = [];
  const rounds = [];

  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + 0.13;
    const band = i % 4;
    const r = 24.6 + band * 1.05 + ((i * 37) % 7) * 0.24;
    const k = 0.84 + ((i * 53) % 13) / 30;
    const item = {
      x: Math.sin(a) * r,
      z: -Math.cos(a) * r,
      k,
      ry: ((i * 1.7) % TAU) * 0.5,
    };
    if ((i * 73) % 100 < 42) cones.push(item);
    else rounds.push(item);
  }

  const leafMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const barkA = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
  const barkB = new THREE.MeshLambertMaterial({ color: 0x7d5e42 });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  const build = (list, trunkGeo, trunkMat, crownGeo, crownMat, trunkY, crownY, seed) => {
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, list.length);
    const c = new THREE.Color();

    list.forEach((it, i) => {
      q.setFromEuler(new THREE.Euler(0, it.ry, 0));
      s.set(it.k, it.k, it.k);

      p.set(it.x, trunkY * it.k, it.z);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);

      p.set(it.x, crownY * it.k, it.z);
      m.compose(p, q, s);
      crowns.setMatrixAt(i, m);

      /* 每棵樹一點點色差，避免整排一模一樣 */
      const v = 0.9 + ((i * seed) % 9) * 0.022;
      c.setRGB(v, v * 0.99, v * 0.95);
      crowns.setColorAt(i, c);
    });

    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    return [trunks, crowns];
  };

  const gA = build(cones, geo.trunkA, barkA, geo.coneCrown, leafMat, 0.7, 0, 3);
  const gB = build(rounds, geo.trunkB, barkB, geo.roundCrown, leafMat, 1.45, 0, 5);
  group.add(gA[0], gA[1], gB[0], gB[1]);

  /* 地面陰影貼片（徑向漸變），全部合成一個 mesh */
  const shadows = new Batch();
  for (const it of cones.concat(rounds)) {
    shadows.add(new THREE.PlaneGeometry(3.2, 3.2), {
      x: it.x,
      y: 0.035,
      z: it.z,
      rx: -Math.PI / 2,
      s: it.k,
    });
  }
  const sh = shadows.mesh(
    new THREE.MeshBasicMaterial({
      map: softCircleTexture(),
      color: 0x2f4a2c,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    })
  );
  sh.renderOrder = 1;
  group.add(sh);
}

/* ===================== 展館門牌貼圖集 ===================== */

function gateSignAtlas(zones) {
  const CW = 720;
  const CH = 80;
  const COLS = 4;
  const rows = Math.max(1, Math.ceil(zones.length / COLS));
  const cv = canvas2d(CW * COLS, CH * rows);
  const g = cv.getContext('2d');

  g.clearRect(0, 0, cv.width, cv.height);

  zones.forEach((z, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * CW;
    const y = row * CH;
    const open = z.open !== false;
    const base = new THREE.Color(z.color || '#7a4e9e');
    const tint = open ? base : base.clone().lerp(new THREE.Color(0xc6c9d1), 0.62);

    /* 深色底板 */
    g.fillStyle = '#' + tint.clone().multiplyScalar(0.82).getHexString();
    g.fillRect(x + 3, y + 4, CW - 6, CH - 8);

    /* 上緣一條高光，讓門牌有一點厚度感 */
    g.fillStyle = 'rgba(255,255,255,.22)';
    g.fillRect(x + 3, y + 4, CW - 6, 4);

    const title = (z.title && z.title.zh) || z.id || '';
    g.font = '700 50px ' + CJK;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = open ? '#ffffff' : 'rgba(240,240,244,.78)';
    g.fillText(title, x + CW / 2, y + CH / 2 + 2);

    /* 左右小裝飾點 */
    g.fillStyle = open ? 'rgba(255,255,255,.6)' : 'rgba(255,255,255,.28)';
    const tw = g.measureText(title).width;
    const dx = Math.min(CW / 2 - 30, tw / 2 + 26);
    g.beginPath();
    g.arc(x + CW / 2 - dx, y + CH / 2 + 1, 4.5, 0, TAU);
    g.arc(x + CW / 2 + dx, y + CH / 2 + 1, 4.5, 0, TAU);
    g.fill();
  });

  const tex = canvasTexture(cv, { aniso: 8 });

  const cells = zones.map((z, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return [
      (col * CW) / cv.width,
      1 - ((row + 1) * CH) / cv.height,
      ((col + 1) * CW) / cv.width,
      1 - (row * CH) / cv.height,
    ];
  });

  return { tex, cells };
}

/* ===================== 一座展館 ===================== */

function buildGate(zone, i, n, ctx) {
  const th = (i * TAU) / n;
  const pos = new THREE.Vector3(Math.sin(th) * GATE_R, 0, -Math.cos(th) * GATE_R);

  /* 對外介面要求有 group，但實際幾何體已合併到廣場批次，這裡只保留定位點 */
  const group = new THREE.Group();
  group.position.copy(pos);
  group.rotation.y = -th;

  const M = new THREE.Matrix4().compose(
    pos.clone(),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -th, 0)),
    new THREE.Vector3(1, 1, 1)
  );

  const open = zone.open !== false;
  const base = new THREE.Color(zone.color || '#7a4e9e');
  const tint = open ? base.clone() : base.clone().lerp(new THREE.Color(0xc6c9d1), 0.62);
  const tintDeep = tint.clone().multiplyScalar(0.86);

  const wall = new THREE.Color(open ? 0xf4efe6 : 0xdedcd6);
  const wallDeep = new THREE.Color(open ? 0xe6ddcd : 0xd2d0ca);
  const cream = new THREE.Color(0xfcfaf5);
  const stone = new THREE.Color(0xd9cfbc);
  const glass = new THREE.Color(open ? 0x35406a : 0x71747f);
  const metal = new THREE.Color(0x9299a8);
  const gold = new THREE.Color(open ? 0xe3b95f : 0xbfc2ca);

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, seg) => new THREE.CylinderGeometry(rt, rb, h, seg);

  const add = (geo, opt) => {
    ctx.solid.add(geo, Object.assign({ parent: M }, opt));
  };

  /* --- 台基與量體 --- */
  add(box(9.6, 0.42, 7.6), { y: 0.21, color: stone });
  add(box(9.1, 0.16, 7.1), { y: 0.46, color: wallDeep });
  add(box(9, 4.2, 7), { y: 2.5, color: wall });

  /* --- 屋簷：加厚 + 收邊 + 屋脊小裝飾 --- */
  add(box(9.5, 0.22, 7.4), { y: 4.71, color: cream });
  add(box(10.6, 0.56, 8.5), { y: 5.09, color: tint });
  add(box(8.3, 0.86, 6.5), { y: 5.79, color: tintDeep });
  add(box(5.1, 0.42, 3.9), { y: 6.42, color: tint });
  add(box(5.3, 0.14, 0.36), { y: 6.7, color: cream });
  add(cyl(0.09, 0.11, 0.42, 8), { y: 6.92, color: metal });
  add(new THREE.SphereGeometry(0.19, 10, 8), { y: 7.18, color: gold });

  /* 屋簷四角的小裝飾塊 */
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(box(0.26, 0.5, 0.26), { x: sx * 5.05, y: 5.5, z: sz * 4.0, color: cream });
    }
  }

  /* --- 正立面：大門 --- */
  add(box(6.6, 0.18, 2.4), { y: 0.09, z: 4.6, color: stone });
  add(box(3.5, 3.5, 0.22), { y: 1.75, z: 3.52, color: cream });
  add(box(2.95, 3.05, 0.14), { y: 1.55, z: 3.6, color: glass });
  add(box(0.09, 3.05, 0.06), { y: 1.55, z: 3.68, color: cream });
  add(box(2.95, 0.09, 0.06), { y: 2.62, z: 3.68, color: cream });
  add(box(0.07, 0.5, 0.07), { x: 1.05, y: 1.5, z: 3.69, color: metal });

  /* --- 雨棚 --- */
  add(box(5.4, 0.26, 1.9), { y: 3.62, z: 4.15, color: tint });
  add(box(5.4, 0.13, 0.18), { y: 3.61, z: 5.05, color: cream });
  add(box(0.14, 0.52, 0.14), { x: -2.35, y: 3.36, z: 3.72, color: tintDeep });
  add(box(0.14, 0.52, 0.14), { x: 2.35, y: 3.36, z: 3.72, color: tintDeep });

  /* --- 深色玻璃窗 + 白色窗框 --- */
  for (const sx of [-1, 1]) {
    const wx = sx * 3.2;
    add(box(2.1, 1.95, 0.2), { x: wx, y: 2.4, z: 3.52, color: cream });
    add(box(1.82, 1.66, 0.14), { x: wx, y: 2.4, z: 3.6, color: glass });
    add(box(0.08, 1.66, 0.05), { x: wx, y: 2.4, z: 3.67, color: cream });
    add(box(1.82, 0.08, 0.05), { x: wx, y: 2.4, z: 3.67, color: cream });
    /* 窗台 */
    add(box(2.24, 0.12, 0.26), { x: wx, y: 1.4, z: 3.56, color: cream });
  }

  /* --- 門牌（文字由貼圖集提供） --- */
  add(box(6.0, 0.74, 0.2), { y: 4.22, z: 3.54, color: tintDeep });
  ctx.signs.add(new THREE.PlaneGeometry(5.6, 0.62), {
    parent: M,
    y: 4.22,
    z: 3.66,
    uv: ctx.atlas.cells[i],
  });

  /* --- 燈光：開放的館亮，未開放的館低調 --- */
  const target = open ? ctx.glowOpen : ctx.glowClosed;
  const doorGlow = new THREE.PlaneGeometry(2.75, 2.9);
  target.add(doorGlow, { parent: M, y: 1.6, z: 3.72, color: open ? 0xffd9a0 : 0x9fb0c8 });
  for (const sx of [-1, 1]) {
    target.add(new THREE.PlaneGeometry(1.7, 1.5), {
      parent: M,
      x: sx * 3.2,
      y: 2.4,
      z: 3.7,
      color: 0xffcf8c,
    });
  }
  if (open) {
    /* 燈光灑到地面的暖色光斑 */
    target.add(new THREE.PlaneGeometry(8.2, 8.2), {
      parent: M,
      y: 0.05,
      z: 5.2,
      rx: -Math.PI / 2,
      color: 0xffb968,
    });
  }

  const trigger = new THREE.Vector3(
    pos.x - Math.sin(th) * 5.6,
    0,
    pos.z + Math.cos(th) * 5.6
  );

  return {
    zone,
    group,
    pos,
    trigger,
    labelAnchor: new THREE.Vector3(pos.x, 7.75, pos.z),
  };
}

/* ===================== 廣場道具 ===================== */

/* 與每一條道路中線的垂直距離 */
function roadGap(x, z, n) {
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const th = (i * TAU) / n;
    const d = Math.abs(x * Math.cos(th) + z * Math.sin(th));
    if (d < best) best = d;
  }
  return best;
}

/* 由內往外找第一個合法位置：避開中央 5 米與道路 */
function findSpot(angle, r0, pad, n) {
  for (let r = r0; r < 13.2; r += 0.2) {
    const x = Math.sin(angle) * r;
    const z = -Math.cos(angle) * r;
    if (Math.hypot(x, z) < CENTER_CLEAR + pad) continue;
    if (roadGap(x, z, n) < ROAD_HALF + pad) continue;
    return { x, z, r, a: angle };
  }
  const x = Math.sin(angle) * r0;
  const z = -Math.cos(angle) * r0;
  return { x, z, r: r0, a: angle };
}

/* 以一個道具的落點建立它的區域座標系，零件用局部座標描述即可 */
function propMatrix(sp, ry) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(sp.x, 0, sp.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry || 0, 0, 'YXZ')),
    new THREE.Vector3(1, 1, 1)
  );
}

function addStreetProps(group, zones, n, batch) {
  const { solid, emissive, glow } = batch;
  const gapA = (gi) => (gi * TAU) / n + Math.PI / n;

  /* ---------- 路燈 ---------- */
  const lampSpots = [
    findSpot(gapA(0), 9.8, 0.5, n),
    findSpot(gapA(1), 12.0, 0.5, n),
    findSpot(gapA(2), 11.0, 0.5, n),
    findSpot(gapA(5), 11.2, 0.5, n),
    findSpot(gapA(6), 11.0, 0.5, n),
  ];

  const poleCol = 0x3c4152;
  const lampWarm = 0xffe6b4;

  lampSpots.forEach((sp) => {
    const PM = propMatrix(sp, -sp.a);
    const put = (geo, opt) => solid.add(geo, Object.assign({ parent: PM }, opt));

    put(new THREE.CylinderGeometry(0.22, 0.3, 0.28, 10), { y: 0.14, color: 0x4a4f60 });
    put(new THREE.CylinderGeometry(0.06, 0.08, 3.5, 8), { y: 1.95, color: poleCol });
    put(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 8), { y: 3.68, color: poleCol });
    /* 燈籠外框：底板 + 四根立柱 + 頂蓋，中間留空讓暖色燈罩透出來 */
    put(new THREE.BoxGeometry(0.4, 0.07, 0.4), { y: 3.76, color: 0x2f3444 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        put(new THREE.BoxGeometry(0.05, 0.45, 0.05), {
          x: sx * 0.17,
          y: 3.98,
          z: sz * 0.17,
          color: 0x2f3444,
        });
      }
    }
    put(new THREE.BoxGeometry(0.46, 0.08, 0.46), { y: 4.22, color: poleCol });
    put(new THREE.SphereGeometry(0.09, 8, 6), { y: 4.31, color: 0x4a4f60 });

    emissive.add(new THREE.BoxGeometry(0.31, 0.43, 0.31), {
      parent: PM,
      y: 3.99,
      color: lampWarm,
    });

    /* 燈下的暖色地面光斑 */
    glow.add(new THREE.PlaneGeometry(6.4, 6.4), {
      parent: PM,
      y: 0.045,
      rx: -Math.PI / 2,
      color: 0xffb968,
    });
  });

  /* ---------- 長椅 ---------- */
  const benchSpots = [
    findSpot(gapA(2), 8.4, 1.5, n),
    findSpot(gapA(4), 8.4, 1.5, n),
    findSpot(gapA(5), 8.6, 1.5, n),
    findSpot(gapA(6), 8.4, 1.5, n),
  ];

  const wood = 0xb07a4e;
  const steel = 0x4b5160;

  benchSpots.forEach((sp) => {
    const PM = propMatrix(sp, -sp.a);
    const put = (geo, opt) => solid.add(geo, Object.assign({ parent: PM }, opt));

    put(new THREE.BoxGeometry(2.2, 0.13, 0.64), { y: 0.47, color: wood });
    put(new THREE.BoxGeometry(2.2, 0.1, 0.5), { y: 0.36, color: 0x9c6b44 });
    put(new THREE.BoxGeometry(2.2, 0.52, 0.1), { y: 0.8, z: -0.27, rx: -0.18, color: wood });
    put(new THREE.BoxGeometry(2.24, 0.09, 0.16), { y: 1.04, z: -0.31, color: 0xa9754a });
    for (const sx of [-1, 1]) {
      put(new THREE.BoxGeometry(0.1, 0.47, 0.58), { x: sx * 0.92, y: 0.235, color: steel });
      put(new THREE.BoxGeometry(0.09, 0.6, 0.09), { x: sx * 0.92, y: 0.78, z: -0.24, color: steel });
    }
  });

  /* ---------- 花圃 ---------- */
  const bedSpots = [findSpot(gapA(1), 9.6, 1.9, n), findSpot(gapA(3), 12.4, 1.9, n)];
  const petals = [0xe06b7f, 0xf0a63c, 0xf6efe2, 0xc58be0, 0xf2d24e];
  let seed = 7;

  bedSpots.forEach((sp) => {
    const PM = propMatrix(sp, 0);
    const put = (geo, opt) => solid.add(geo, Object.assign({ parent: PM }, opt));

    put(new THREE.CylinderGeometry(1.72, 1.74, 0.34, 24), { y: 0.17, color: 0x6b503b });
    put(new THREE.CylinderGeometry(1.92, 1.96, 0.44, 24, 1, true), { y: 0.22, color: 0xcfc5b2 });
    put(new THREE.RingGeometry(1.7, 1.96, 24), { y: 0.44, rx: -Math.PI / 2, color: 0xdcd2be });

    for (let k = 0; k < 11; k++) {
      seed = (seed * 16807) % 2147483647;
      const a = (seed / 2147483647) * TAU;
      seed = (seed * 16807) % 2147483647;
      const rr = 0.35 + (seed / 2147483647) * 1.15;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      put(new THREE.SphereGeometry(0.14, 6, 5), {
        x,
        y: 0.52 + ((k % 3) * 0.09),
        z,
        color: petals[k % petals.length],
      });
      put(new THREE.SphereGeometry(0.3, 6, 5), { x: x * 0.7, y: 0.44, z: z * 0.7, color: 0x4f9440 });
    }
  });

  /* ---------- 邊界灌木籬 ---------- */
  const HEDGE_R = 22.5;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    /* 道路出口留空，讓視線可以穿出去 */
    let nearRoad = false;
    for (let k = 0; k < n; k++) {
      const th = (k * TAU) / n;
      let d = (a - th) % TAU;
      if (d < 0) d += TAU;
      if (d > Math.PI) d = TAU - d;
      if (d < 0.2) nearRoad = true;
    }
    if (nearRoad) continue;

    const x = Math.sin(a) * HEDGE_R;
    const z = -Math.cos(a) * HEDGE_R;
    solid.add(new THREE.BoxGeometry(5.15, 0.78, 0.9), {
      x,
      y: 0.39,
      z,
      ry: -a,
      color: i % 2 ? 0x4f9440 : 0x579a46,
    });
    solid.add(new THREE.BoxGeometry(5.1, 0.22, 0.98), {
      x,
      y: 0.8,
      z,
      ry: -a,
      color: i % 2 ? 0x63aa4d : 0x6bb052,
    });
  }

  /* ---------- 旗桿（紫白校色旗） ---------- */
  const flagSpot = findSpot(gapA(0), 7.4, 0.9, n);
  solid.add(new THREE.CylinderGeometry(0.46, 0.58, 0.34, 12), {
    x: flagSpot.x,
    y: 0.17,
    z: flagSpot.z,
    color: 0xd5cbb8,
  });
  solid.add(new THREE.CylinderGeometry(0.07, 0.1, 9, 10), {
    x: flagSpot.x,
    y: 4.6,
    z: flagSpot.z,
    color: 0xe4e7ee,
  });
  solid.add(new THREE.SphereGeometry(0.16, 10, 8), {
    x: flagSpot.x,
    y: 9.2,
    z: flagSpot.z,
    color: 0xe3b95f,
  });

  addFlag(group, flagSpot);

  /* ---------- 指示牌 ---------- */
  const signSpot = findSpot(gapA(4), 11.8, 1.4, n);
  addGuideSign(group, signSpot, zones);
}

/* 校旗：紫底白帶，帶一點風的弧度 */
function addFlag(group, spot) {
  const cv = canvas2d(256, 160);
  const g = cv.getContext('2d');
  g.fillStyle = '#7a4e9e';
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 58, 256, 34);
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.9;
  g.beginPath();
  g.arc(196, 46, 17, 0, TAU);
  g.fill();
  g.globalAlpha = 1;

  const tex = canvasTexture(cv, { aniso: 4 });
  const geo = new THREE.PlaneGeometry(2.3, 1.42, 18, 6);
  geo.translate(1.15, 0, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const k = x / 2.3;
    p.setZ(i, Math.sin(k * 5.2 + 0.7) * 0.19 * k + Math.sin(k * 2.1) * 0.05);
    p.setY(i, y * (1 - 0.06 * k));
  }
  geo.computeVertexNormals();

  const flag = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })
  );
  flag.position.set(spot.x, 7.55, spot.z);
  flag.rotation.y = -spot.a;
  group.add(flag);
}

/* 指示牌：手繪校園導覽圖（七個展館的位置用各館代表色標出） */
function addGuideSign(group, spot, zones) {
  const W = 512;
  const H = 320;
  const cv = canvas2d(W, H);
  const g = cv.getContext('2d');

  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#7a4e9e';
  g.lineWidth = 10;
  g.strokeRect(5, 5, W - 10, H - 10);

  /* 頂部標題帶 */
  g.fillStyle = '#7a4e9e';
  g.fillRect(10, 10, W - 20, 76);
  g.fillStyle = '#ffffff';
  g.font = '700 42px ' + CJK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('STEAM DAY 校園導覽', W / 2, 48);

  /* 中央的放射小地圖 */
  const cx = W / 2;
  const cy = 190;
  g.fillStyle = 'rgba(122,78,158,.14)';
  g.beginPath();
  g.arc(cx, cy, 96, 0, TAU);
  g.fill();

  g.strokeStyle = 'rgba(122,78,158,.55)';
  g.lineWidth = 8;
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU - Math.PI / 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30);
    g.lineTo(cx + Math.cos(a) * 76, cy + Math.sin(a) * 76);
    g.stroke();
  }

  zones.forEach((z, i) => {
    const a = (i / 7) * TAU - Math.PI / 2;
    g.fillStyle = z.open === false ? '#a9adb9' : z.color || '#7a4e9e';
    g.beginPath();
    g.arc(cx + Math.cos(a) * 84, cy + Math.sin(a) * 84, 12, 0, TAU);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    g.stroke();
  });

  g.fillStyle = '#7a4e9e';
  g.beginPath();
  g.arc(cx, cy, 20, 0, TAU);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx, cy, 9, 0, TAU);
  g.fill();

  /* 底部說明帶 */
  g.fillStyle = '#7a4e9e';
  g.fillRect(10, 286, W - 20, 24);
  g.font = '700 21px ' + CJK;
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.fillText('沿放射道路前往各展館', W / 2, 298);

  const tex = canvasTexture(cv, { aniso: 8 });

  const ry = -spot.a;
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 2.7, 0.14),
    new THREE.MeshLambertMaterial({ color: 0x5b5f6e })
  );
  post.position.set(spot.x, 1.35, spot.z);
  post.rotation.y = ry;

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(2.9, 1.85, 0.1),
    new THREE.MeshLambertMaterial({ color: 0xf7f4ee })
  );
  board.position.set(spot.x, 2.25, spot.z);
  board.rotation.y = ry;

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 1.75),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  face.position.set(spot.x, 2.25, spot.z);
  face.rotation.y = ry;
  face.translateZ(0.056);

  group.add(post, board, face);
}

/* ===================== 廣場 ===================== */

export function buildPlaza(zones) {
  const group = new THREE.Group();
  const n = zones.length || 6;

  addSky(group);

  const far = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: 0x82c06a })
  );
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.06;
  group.add(far);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size, WORLD.size),
    new THREE.MeshLambertMaterial({ map: groundTexture(zones) })
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  addTrees(group);
  addClouds(group);

  const solid = new Batch();
  const emissive = new Batch();
  const glowOpen = new Batch();
  const glowClosed = new Batch();
  const signs = new Batch();
  const atlas = gateSignAtlas(zones);

  const gates = [];
  const colliders = [];

  zones.forEach((zone, i) => {
    const gate = buildGate(zone, i, n, { solid, signs, atlas, glowOpen, glowClosed });
    gates.push(gate);
    group.add(gate.group);
    /* 碰撞體只保留七道門 */
    colliders.push({ x: gate.pos.x, z: gate.pos.z, r: GATE_HALF });
  });

  addStreetProps(group, zones, n, { solid, emissive, glow: glowOpen });

  group.add(solid.mesh(vertexLambert()));
  group.add(emissive.mesh(vertexBasic()));
  group.add(signs.mesh(new THREE.MeshBasicMaterial({ map: atlas.tex })));
  group.add(glowOpen.mesh(addGlowMaterial(0.5)));
  if (glowClosed.items.length) group.add(glowClosed.mesh(addGlowMaterial(0.16)));

  return { group, gates, colliders, bounds: { type: 'circle', r: WORLD.plazaR } };
}

/* ===================== 室內 ===================== */

/* 地板磚 */
let floorTex = null;

function floorTexture() {
  if (floorTex) return floorTex;

  const S = 512;
  const n = 4;
  const t = S / n;
  const cv = canvas2d(S);
  const g = cv.getContext('2d');

  g.fillStyle = '#efe8db';
  g.fillRect(0, 0, S, S);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = 236 + Math.floor(Math.random() * 9);
      g.fillStyle = 'rgb(' + v + ',' + (v - 6) + ',' + (v - 16) + ')';
      g.fillRect(i * t, j * t, t, t);
      g.fillStyle = 'rgba(255,255,255,.055)';
      g.fillRect(i * t + 5, j * t + 5, t - 10, (t - 10) * 0.4);
    }
  }

  g.strokeStyle = 'rgba(152,142,126,.5)';
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath();
    g.moveTo(i * t, 0);
    g.lineTo(i * t, S);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * t);
    g.lineTo(S, i * t);
    g.stroke();
  }

  floorTex = canvasTexture(cv, { repeat: 6 });
  return floorTex;
}

export function buildRoom(zone) {
  const group = new THREE.Group();
  const H = 9;
  const S = 12;
  const tint = new THREE.Color(zone.color || '#7a4e9e');
  const wallTint = tint.clone().lerp(WHITE, 0.8);

  /* --- 地板 --- */
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(S * 2, 0.4, S * 2),
    new THREE.MeshLambertMaterial({ map: floorTexture() })
  );
  floor.position.y = -0.2;
  group.add(floor);

  const shell = new Batch();
  const emis = new Batch();
  const add = (geo, opt) => shell.add(geo, opt);

  /* --- 地板拼色：沿牆一圈深色走道 + 內圈細線 --- */
  const bandInner = S - 0.2 - 2.0; // 9.8：走道內緣
  const bandMid = S - 0.2 - 1.0; // 10.8：走道中線
  for (const sz of [-1, 1]) {
    /* 南北兩條（整幅寬度） */
    add(new THREE.BoxGeometry(23.6, 0.02, 2.0), {
      y: 0.012,
      z: sz * bandMid,
      color: 0xd2c4ae,
    });
    /* 東西兩條（只到內緣，避免與南北兩條共面重疊） */
    add(new THREE.BoxGeometry(2.0, 0.02, 19.6), {
      y: 0.012,
      x: sz * bandMid,
      color: 0xd2c4ae,
    });
  }
  /* 內圈細線 */
  const lineCol = tint.clone().lerp(WHITE, 0.35).getHex();
  for (const sz of [-1, 1]) {
    add(new THREE.BoxGeometry(19.8, 0.03, 0.14), {
      y: 0.016,
      z: sz * bandInner,
      color: lineCol,
    });
    add(new THREE.BoxGeometry(0.14, 0.03, 19.8), {
      y: 0.016,
      x: sz * bandInner,
      color: lineCol,
    });
  }

  /* 展示區的地面鑲邊：中央一個紫色方框，遠看就是地板的拼色邊框 */
  const inlayCol = tint.clone().lerp(WHITE, 0.18).getHex();
  for (const sz of [-1, 1]) {
    add(new THREE.BoxGeometry(14.7, 0.014, 0.28), {
      y: 0.02,
      z: sz * 7.2,
      color: inlayCol,
    });
    add(new THREE.BoxGeometry(0.28, 0.014, 14.7), {
      y: 0.02,
      x: sz * 7.2,
      color: inlayCol,
    });
  }

  /* --- 牆體 --- */
  const wallCol = new THREE.Color(0xf7f4ed);
  add(new THREE.BoxGeometry(S * 2, H, 0.4), { y: H / 2, z: -S + 0.2, color: wallTint });
  add(new THREE.BoxGeometry(0.4, H, S * 2), { y: H / 2, x: -S + 0.2, color: wallCol });
  add(new THREE.BoxGeometry(0.4, H, S * 2), { y: H / 2, x: S - 0.2, color: wallCol });

  /* 前牆（中間留門） */
  add(new THREE.BoxGeometry(S - 2.6, H, 0.4), { y: H / 2, x: -(S / 2 + 1.3), z: S - 0.2, color: wallCol });
  add(new THREE.BoxGeometry(S - 2.6, H, 0.4), { y: H / 2, x: S / 2 + 1.3, z: S - 0.2, color: wallCol });
  add(new THREE.BoxGeometry(5.2, H - 3.6, 0.4), { y: 3.6 + (H - 3.6) / 2, z: S - 0.2, color: wallCol });

  /* --- 牆腳線（踢腳板） --- */
  const skirt = new THREE.Color(0xe2d8c8);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.16, 0.36, 23.2), {
      x: sx * (S - 0.48),
      y: 0.18,
      color: skirt,
    });
  }
  for (const sz of [-1, 1]) {
    /* 後牆：大螢幕左右兩段 */
    add(new THREE.BoxGeometry(4.0, 0.36, 0.16), {
      x: sz * (7.6 + 2.0),
      y: 0.18,
      z: -S + 0.48,
      color: skirt,
    });
    /* 前牆：門的左右兩段 */
    add(new THREE.BoxGeometry(9.2, 0.36, 0.16), {
      x: sz * (2.6 + 4.6),
      y: 0.18,
      z: S - 0.48,
      color: skirt,
    });
  }

  /* --- 天花與線腳 --- */
  add(new THREE.BoxGeometry(S * 2, 0.3, S * 2), { y: H, color: 0xece7dd });
  for (const sz of [-1, 1]) {
    add(new THREE.BoxGeometry(23.4, 0.26, 0.3), {
      y: H - 0.24,
      z: sz * (S - 0.35),
      color: 0xf5f0e7,
    });
    add(new THREE.BoxGeometry(0.3, 0.26, 23.4), {
      x: sz * (S - 0.35),
      y: H - 0.24,
      color: 0xf5f0e7,
    });
  }

  /* --- 天花燈帶（自發光面片） --- */
  for (const lx of [-7.2, -2.4, 2.4, 7.2]) {
    add(new THREE.BoxGeometry(0.94, 0.14, 18.2), {
      x: lx,
      y: H - 0.28,
      color: 0xdcd5c8,
    });
    emis.add(new THREE.BoxGeometry(0.64, 0.06, 17.8), {
      x: lx,
      y: H - 0.35,
      color: 0xfff3de,
    });
  }
  for (const lz of [-8.6, 8.6]) {
    add(new THREE.BoxGeometry(15.6, 0.14, 0.94), {
      z: lz,
      y: H - 0.28,
      color: 0xdcd5c8,
    });
    emis.add(new THREE.BoxGeometry(15.2, 0.06, 0.64), {
      z: lz,
      y: H - 0.35,
      color: 0xfff3de,
    });
  }

  /* --- 側牆的木色壁柱，給相片牆一點分隔 --- */
  for (const sx of [-1, 1]) {
    for (const z of [-9.9, -3.3, 3.3, 9.9]) {
      add(new THREE.BoxGeometry(0.1, 6.4, 0.3), {
        x: sx * (S - 0.42),
        y: 3.3,
        z,
        color: 0xefe7d8,
      });
    }
  }

  /* --- 大螢幕 --- */
  add(new THREE.BoxGeometry(15.6, 8.9, 0.36), { y: 4.3, z: -S + 0.58, color: 0x241f33 });
  add(new THREE.BoxGeometry(16.1, 9.3, 0.12), {
    y: 4.3,
    z: -S + 0.44,
    color: tint.clone().lerp(WHITE, 0.5),
  });
  /* 螢幕上緣的微光條 */
  emis.add(new THREE.BoxGeometry(14.7, 0.08, 0.06), {
    y: 8.62,
    z: -S + 0.8,
    color: 0x8a5cb0,
  });

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(14.4, 8.1),
    new THREE.MeshBasicMaterial({ color: 0x0d1220 })
  );
  screen.position.set(0, 4.2, -S + 0.78);
  group.add(screen);

  const play = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 32),
    new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.55 })
  );
  play.position.set(0, 4.2, -S + 0.8);
  group.add(play);

  const tri = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 3),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  tri.position.set(0.16, 4.2, -S + 0.81);
  group.add(tri);

  const hasVideo = !!(zone.videos && zone.videos[0] && zone.videos[0].id);
  play.visible = hasVideo;
  tri.visible = hasVideo;

  /* --- 展示台 --- */
  const pedMat = 0xeae2d4;
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const z = -5 + k * 5;
      add(new THREE.BoxGeometry(2.2, 1.0, 2.2), { x: sx * 8.4, y: 0.5, z, color: pedMat });
      add(new THREE.BoxGeometry(2.36, 0.12, 2.36), { x: sx * 8.4, y: 1.06, z, color: 0xf6f1e7 });
      add(new THREE.BoxGeometry(1.5, 0.16, 1.5), { x: sx * 8.4, y: 1.18, z, color: tint.clone().lerp(WHITE, 0.15) });
      add(new THREE.SphereGeometry(0.3, 10, 8), {
        x: sx * 8.4,
        y: 1.62,
        z,
        color: tint.clone().lerp(WHITE, 0.55),
      });
    }
  }

  /* 展示玻璃罩（六個合成一個 mesh） */
  const caseBatch = new Batch();
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      caseBatch.add(new THREE.BoxGeometry(1.15, 1.25, 1.15), {
        x: sx * 8.4,
        y: 1.9,
        z: -5 + k * 5,
      });
    }
  }
  group.add(
    caseBatch.mesh(
      new THREE.MeshLambertMaterial({
        color: 0xcfe6f2,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      })
    )
  );

  /* --- 出口門（門板嵌在牆洞內，外加白色門套） --- */
  add(new THREE.BoxGeometry(4.6, 3.5, 0.16), { y: 1.75, z: S - 0.42, color: 0x2f2b46 });
  add(new THREE.BoxGeometry(5.3, 0.26, 0.18), { y: 3.62, z: S - 0.48, color: 0xfaf7f0 });
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.26, 3.7, 0.18), {
      x: sx * 2.5,
      y: 1.85,
      z: S - 0.48,
      color: 0xfaf7f0,
    });
  }
  add(new THREE.BoxGeometry(0.1, 0.5, 0.1), { x: 1.62, y: 1.6, z: S - 0.52, color: 0x8d93a3 });
  /* 門上方的綠色出口指示燈 */
  emis.add(new THREE.BoxGeometry(1.5, 0.34, 0.06), { y: 4.1, z: S - 0.5, color: 0x8fd6a8 });

  group.add(shell.mesh(vertexLambert()));
  group.add(emis.mesh(vertexBasic()));

  /* --- 大螢幕的相片輪播（與相片牆共用貼圖快取） --- */
  let tickSlides = () => {};

  if (!hasVideo && zone.photos && zone.photos.length) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    mesh.position.set(0, 4.2, -S + 0.82);
    mesh.visible = false;
    group.add(mesh);

    const slides = { items: [], i: -1, t: 0, shown: false };

    const show = (item) => {
      mesh.scale.set(item.w, item.h, 1);
      mesh.material.map = item.tex;
      mesh.material.needsUpdate = true;
      mesh.visible = true;
    };

    zone.photos.forEach((src, idx) => {
      loadPhoto(src, (tex) => {
        if (!tex || !tex.image || !tex.image.width) return;
        const fit = fitBox(tex.image.width / tex.image.height, 14.2, 8.0);
        /* 依內容次序插入，載入完成的先後不影響輪播順序 */
        let at = slides.items.length;
        while (at > 0 && slides.items[at - 1].idx > idx) at--;
        slides.items.splice(at, 0, { tex, w: fit.w, h: fit.h, idx });
        if (!slides.shown) {
          slides.shown = true;
          slides.i = 0;
          show(slides.items[0]);
        }
      });
    });

    tickSlides = (dt) => {
      if (slides.items.length < 2) return;
      slides.t += dt;
      if (slides.t < 4.5) return;
      slides.t = 0;
      slides.i = (slides.i + 1) % slides.items.length;
      show(slides.items[slides.i]);
    };
  }

  if (zone.photos && zone.photos.length) addPhotoWall(group, zone.photos, S);

  group.add(new THREE.AmbientLight(0xffffff, 0.5));
  const lamp = new THREE.PointLight(tint, 60, 45, 2);
  lamp.position.set(0, 7, -6);
  group.add(lamp);
  const warm = new THREE.PointLight(0xfff0dd, 34, 42, 2);
  warm.position.set(0, 7, 5);
  group.add(warm);

  return {
    group,
    spawn: new THREE.Vector3(0, 0, 6.5),
    yaw: 0,
    hasVideo,
    tickSlides,
    bounds: { type: 'rect', minX: -11.4, maxX: 11.4, minZ: -11.4, maxZ: 11.4 },
    colliders: [
      { x: -8.4, z: -5, r: 2.0 },
      { x: -8.4, z: 0, r: 2.0 },
      { x: -8.4, z: 5, r: 2.0 },
      { x: 8.4, z: -5, r: 2.0 },
      { x: 8.4, z: 0, r: 2.0 },
      { x: 8.4, z: 5, r: 2.0 },
    ],
    anchors: {
      title: new THREE.Vector3(0, 8.55, -11),
      screen: new THREE.Vector3(0, 4.2, -11.2),
    },
    screenPos: new THREE.Vector3(0, 0, -9),
  };
}

/* ===================== 相片貼圖快取 ===================== */

/* 同一個網址只解碼、只上載一次；相片牆與大螢幕共用同一個 Texture */
const texLoader = new THREE.TextureLoader();
const texCache = new Map();

function loadPhoto(src, cb) {
  const hit = texCache.get(src);
  if (hit) {
    if (hit.tex) cb(hit.tex);
    else if (hit.failed) cb(null);
    else hit.cbs.push(cb);
    return;
  }

  const rec = { tex: null, failed: false, cbs: [cb] };
  texCache.set(src, rec);

  texLoader.load(
    src,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      rec.tex = tex;
      const cbs = rec.cbs;
      rec.cbs = [];
      for (const f of cbs) f(tex);
    },
    undefined,
    () => {
      /* 載入失敗就從快取移除，之後仍可重試；同時讓等待者繼續 */
      rec.failed = true;
      texCache.delete(src);
      const cbs = rec.cbs;
      rec.cbs = [];
      for (const f of cbs) f(null);
    }
  );
}

/* 依圖片比例放進一個外框，不裁切 */
function fitBox(aspect, maxW, maxH) {
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w, h };
}

/* ===================== 相片牆 ===================== */

function addPhotoWall(group, photos, S) {
  const slots = [];
  const zs = [-6.6, 0, 6.6];
  const ys = [2.0, 4.9];
  for (const side of [-1, 1]) {
    for (const y of ys) {
      for (const z of zs) slots.push({ side, y, z });
    }
  }

  const picks = photos.slice(0, slots.length);
  if (!picks.length) return;

  const MAXW = 4.6;
  const MAXH = 2.3;
  const BAR = 0.13; // 木框邊寬
  const frames = new Batch();
  const woodMat = vertexLambert();
  let pending = picks.length;
  let frameMesh = null;

  const flushFrames = () => {
    if (pending > 0 || frameMesh) return;
    frameMesh = frames.mesh(woodMat);
    group.add(frameMesh);
  };

  picks.forEach((src, i) => {
    const s = slots[i];
    const fx = s.side * (S - 0.46); // 畫框中心貼住牆面
    const px = s.side * (S - 0.5); // 相片略為凹入畫框

    loadPhoto(src, (tex) => {
      pending--;

      if (tex && tex.image && tex.image.width) {
        const fit = fitBox(tex.image.width / tex.image.height, MAXW, MAXH);
        const w = fit.w;
        const h = fit.h;

        /* 四條木條圍出畫框，尺寸完全跟著圖片比例 */
        frames.add(new THREE.BoxGeometry(0.14, BAR, w + BAR * 2), {
          x: fx,
          y: s.y + h / 2 + BAR / 2,
          z: s.z,
          color: 0xb08155,
        });
        frames.add(new THREE.BoxGeometry(0.14, BAR, w + BAR * 2), {
          x: fx,
          y: s.y - h / 2 - BAR / 2,
          z: s.z,
          color: 0x9c6f47,
        });
        frames.add(new THREE.BoxGeometry(0.14, h, BAR), {
          x: fx,
          y: s.y,
          z: s.z + w / 2 + BAR / 2,
          color: 0xa9764c,
        });
        frames.add(new THREE.BoxGeometry(0.14, h, BAR), {
          x: fx,
          y: s.y,
          z: s.z - w / 2 - BAR / 2,
          color: 0xa9764c,
        });
        /* 相片後面的白色襯紙，讓木框和相片之間有留白 */
        frames.add(new THREE.BoxGeometry(0.05, h + 0.06, w + 0.06), {
          x: fx + s.side * 0.01,
          y: s.y,
          z: s.z,
          color: 0xfbf8f1,
        });

        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ map: tex })
        );
        plane.position.set(px, s.y, s.z);
        plane.rotation.y = (-s.side * Math.PI) / 2;
        group.add(plane);
      }

      flushFrames();
    });
  });
}

/* ===================== 腳下陰影 ===================== */

export function blobShadow() {
  const size = 128;
  const cv = canvas2d(size);
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(30,30,40,.45)');
  grd.addColorStop(0.55, 'rgba(30,30,40,.22)');
  grd.addColorStop(1, 'rgba(30,30,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.renderOrder = 2;
  return mesh;
}
