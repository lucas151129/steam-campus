import * as THREE from '../vendor/three.module.js?v=202611261812';
import { buildCharacter } from './character.js?v=202611261812';

/* 角色分工 */
const ROLE = {
  CHAT: 'chat', // 兩人一組聊天：面對面 + 偶爾點頭
  WAVE: 'wave', // 走近會揮手打招呼
  SIGN: 'sign', // 手裏舉着指示牌
  WATCH: 'watch', // 單純閒站（原本的行為）
};

function shortAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 由座標產生固定的偽隨機種子：重載後行為一致，不是每次都不一樣 */
function seedOf(x, z) {
  const s = Math.sin((x + 12.3) * 91.7 + (z - 4.6) * 47.3) * 43758.5453;
  return s - Math.floor(s);
}

/* 全體 NPC 註冊表：用來就近配對成聊天小組 */
const registry = [];
let rolesReady = false;

/* ───────────────── 指示牌 ───────────────── */
let signTex = null;
function signTexture() {
  if (signTex) return signTex;
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#f7f5fa';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#7a4e9e';
  g.lineWidth = 14;
  g.strokeRect(16, 16, 224, 224);
  // 大箭頭，遠看也認得出是指示牌
  g.fillStyle = '#7a4e9e';
  g.beginPath();
  g.moveTo(48, 106);
  g.lineTo(146, 106);
  g.lineTo(146, 74);
  g.lineTo(214, 128);
  g.lineTo(146, 182);
  g.lineTo(146, 150);
  g.lineTo(48, 150);
  g.closePath();
  g.fill();
  g.font = '700 26px system-ui, "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.fillStyle = '#5b3a78';
  g.fillText('MKPC', 128, 220);
  signTex = new THREE.CanvasTexture(cv);
  signTex.colorSpace = THREE.SRGBColorSpace;
  return signTex;
}

let signBoardMat = null;
let signFaceMat = null;
function signMaterials() {
  if (!signBoardMat) signBoardMat = new THREE.MeshLambertMaterial({ color: 0xf9f8f5 });
  if (!signFaceMat) {
    signFaceMat = new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true });
  }
  return { board: signBoardMat, face: signFaceMat };
}

/**
 * 分配角色：先讓站得最近的兩人配成一組聊天，其餘的按距離玩家的遠近
 * 依次拿指示牌、當揮手的人，最後才是單純閒站。
 * 這樣即使 main.js 之後增減 NPC，分工也會自動重排。
 */
function assignRoles(playerPos) {
  const standers = registry.filter((n) => !n.path);

  // 先把距離近的兩兩配對（3.4 米內才算聊得起來）
  const cand = [];
  for (let i = 0; i < standers.length; i++) {
    for (let j = i + 1; j < standers.length; j++) {
      const a = standers[i].group.position;
      const b = standers[j].group.position;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 3.4) cand.push({ i, j, d });
    }
  }
  cand.sort((p, q) => p.d - q.d);

  const used = new Set();
  for (const c of cand) {
    if (used.has(c.i) || used.has(c.j)) continue;
    used.add(c.i);
    used.add(c.j);
    const a = standers[c.i];
    const b = standers[c.j];
    a.role = b.role = ROLE.CHAT;
    a.partner = b;
    b.partner = a;
    a.talkYaw = Math.atan2(
      -(b.group.position.x - a.group.position.x),
      -(b.group.position.z - a.group.position.z)
    );
    b.talkYaw = Math.atan2(
      -(a.group.position.x - b.group.position.x),
      -(a.group.position.z - b.group.position.z)
    );
    a.nodPhase = a.seed;
    b.nodPhase = (b.seed + 0.53) % 1;
  }

  // 剩下的單人：離玩家最近的先拿指示牌，第二個負責揮手
  const rest = [];
  for (let i = 0; i < standers.length; i++) if (!used.has(i)) rest.push(standers[i]);
  const px = playerPos ? playerPos.x : 0;
  const pz = playerPos ? playerPos.z : 0;
  rest.sort(
    (a, b) =>
      Math.hypot(a.group.position.x - px, a.group.position.z - pz) -
      Math.hypot(b.group.position.x - px, b.group.position.z - pz)
  );
  rest.forEach((n, k) => {
    n.role = k === 0 ? ROLE.SIGN : k === 1 ? ROLE.WAVE : ROLE.WATCH;
  });
}

/**
 * 場景中的其他學生 / 志願者。
 * 閒站的在 11 米內會轉頭望向走近的玩家 —— 這樣玩家永遠看得到校服正面。
 * 在此之上：兩人一組聊天、有人揮手、有人拿指示牌、走路的手臂自然擺動。
 */
export class Npc {
  constructor(opt = {}) {
    this.index = registry.length;
    this.variant = opt.variant != null ? opt.variant % 3 : this.index % 3;
    this.seed = seedOf(opt.x || 0, opt.z || 0);

    this.char = buildCharacter(opt.gender || 'boy', {
      hair: opt.hair,
      variant: this.variant,
    });
    this.char.group.rotation.y = Math.PI; // 模型面向 +Z，轉為面向 -Z

    this.group = new THREE.Group();
    this.group.add(this.char.group);
    this.group.position.set(opt.x || 0, 0, opt.z || 0);

    // 預設面向廣場中心，看起來像在圍着廣場活動
    this.baseYaw = opt.yaw != null ? opt.yaw : Math.atan2(opt.x || 0, opt.z || 0);
    this.yaw = this.baseYaw;
    this.group.rotation.y = this.yaw;

    this.path = opt.path || null;
    this.t = opt.t != null ? opt.t : 0.5;
    this.dir = 1;
    this.lookRange = opt.lookRange || 11;

    // 行為狀態
    this.role = ROLE.WATCH;
    this.partner = null;
    this.talkYaw = this.baseYaw;
    this.nodPhase = this.seed;
    this.time = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.waveT = 0;
    this.waveCool = 1.5 + this.seed * 2;
    this.armRaise = 0;
    this.sign = null;

    registry.push(this);
  }

  /** 舉起指示牌：白板 + 版面，用左手托在胸前 */
  attachSign() {
    if (this.sign) return;
    const mat = signMaterials();
    const holder = new THREE.Group();
    holder.position.set(0.12, 1.0, 0.42);

    const board = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.022), mat.board);
    holder.add(board);

    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.29), mat.face);
    face.position.z = 0.0125;
    holder.add(face);

    this.char.group.add(holder);
    this.sign = holder;
  }

  /** 聊天的點頭節奏：每輪 0.26 的「有動作」時間，其餘時間靜止 */
  _nod() {
    const c = (this.time * 0.32 + this.nodPhase) % 1;
    if (c > 0.26) return 0;
    const u = c / 0.26;
    return Math.sin(u * Math.PI) * Math.sin(u * Math.PI * 5) * 0.15;
  }

  update(dt, playerPos) {
    if (!rolesReady) {
      assignRoles(playerPos);
      rolesReady = true;
      for (const n of registry) if (n.role === ROLE.SIGN) n.attachSign();
    }

    this.time += dt;
    const gx = this.group.position.x;
    const gz = this.group.position.z;
    const dx = (playerPos ? playerPos.x : 0) - gx;
    const dz = (playerPos ? playerPos.z : 0) - gz;
    const dist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(-dx, -dz);

    let targetYaw = this.baseYaw;
    let ratio = 0;

    if (this.path) {
      // 走路的：沿用原本的路徑來回
      const { a, b, speed = 1.05 } = this.path;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      this.t += (this.dir * speed * dt) / len;

      if (this.t >= 1) {
        this.t = 1;
        this.dir = -1;
      } else if (this.t <= 0) {
        this.t = 0;
        this.dir = 1;
      }

      const x = a.x + (b.x - a.x) * this.t;
      const z = a.z + (b.z - a.z) * this.t;
      this.group.position.set(x, 0, z);

      targetYaw = Math.atan2(-(b.x - a.x) * this.dir, -(b.z - a.z) * this.dir);
      ratio = 0.9;
    } else if (this.role === ROLE.CHAT) {
      // 聊天的兩人互相面對；玩家走近時只是轉頭看，不會打斷對話
      targetYaw = this.talkYaw;
    } else if (dist < this.lookRange) {
      targetYaw = toPlayer; // ← 核心行為：走近就轉向你
    }

    this.yaw += shortAngle(this.yaw, targetYaw) * (1 - Math.exp(-6.5 * dt));
    this.group.rotation.y = this.yaw;

    /* ── 頭部：轉頭看玩家 / 聊天點頭 / 沒人時左右張望 ── */
    let headYawWant = 0;
    let pitchWant = 0;

    if (this.path) {
      headYawWant = dist < 7 ? clamp(shortAngle(this.yaw, toPlayer), -0.5, 0.5) * 0.7 : 0;
    } else if (this.role === ROLE.CHAT) {
      if (dist < this.lookRange && dist > 0.4) {
        headYawWant = clamp(shortAngle(this.yaw, toPlayer), -0.9, 0.9);
      } else {
        headYawWant = Math.sin(this.time * 0.45 + this.seed * 6.28) * 0.18;
      }
      pitchWant = this._nod();
    } else if (dist < this.lookRange) {
      // 身體已經轉向玩家，頭再稍微領先一點，轉身看起來更自然
      headYawWant = clamp(shortAngle(this.yaw, toPlayer), -0.45, 0.45);
    } else {
      headYawWant = Math.sin(this.time * 0.33 + this.seed * 6.28) * 0.3;
    }

    this.headYaw += (headYawWant - this.headYaw) * (1 - Math.exp(-9 * dt));
    this.headPitch += (pitchWant - this.headPitch) * (1 - Math.exp(-12 * dt));
    const head = this.char.nodes.head;
    head.rotation.y = this.headYaw;
    head.rotation.x = this.headPitch;

    /* ── 揮手：玩家走近就舉手打招呼 ── */
    if (this.role === ROLE.WAVE) {
      this.waveCool -= dt;
      if (this.waveCool <= 0 && this.waveT <= 0 && dist < 8.5) {
        this.waveT = 2.6;
        this.waveCool = 8 + this.seed * 5;
      }
      if (this.waveT > 0) this.waveT -= dt;
    }
    const wantRaise = this.waveT > 0 ? 1 : 0;
    this.armRaise += (wantRaise - this.armRaise) * (1 - Math.exp(-7 * dt));

    /* ── 基本動作 ── */
    this.char.update(dt, ratio, true);

    /* ── 在基本動作之上疊加個別行為 ── */
    const nodes = this.char.nodes;

    if (this.role === ROLE.SIGN) {
      // 左手把牌子舉在胸前
      nodes.armL.rotation.x = -0.62;
      nodes.armL.rotation.z = 0.05;
      nodes.elbowL.rotation.x = -0.95;
      nodes.elbowL.rotation.z = 0;
    }

    if (this.armRaise > 0.01) {
      // 右手舉起擺動：上臂往外抬，前臂再折向上，
      // 手掌在頭側左右劃（只彎肘關節，所以不會擋住臉）
      const k = this.armRaise;
      nodes.armR.rotation.z = -1.15 * k;
      nodes.armR.rotation.x = -0.12 * k;
      nodes.elbowR.rotation.x = -0.08 * k;
      nodes.elbowR.rotation.z = (-1.75 + Math.sin(this.time * 9.5) * 0.38) * k;
      nodes.bob.rotation.z += 0.035 * k;
    }

    if (!this.path) {
      // 每個人呼吸／重心微移的節奏都不一樣，避免一排人同步
      nodes.bob.position.y += Math.sin(this.time * 0.9 + this.seed * 6.28) * 0.006;
      nodes.bob.rotation.z += Math.sin(this.time * 0.53 + this.seed * 9.7) * 0.012;
    }
  }
}
