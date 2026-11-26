import * as THREE from '../vendor/three.module.js?v=202611261812';
import { t, pick } from './i18n.js?v=202611261812';

const DIR_NAMES = {
  0: '北 N',
  45: '東北 NE',
  90: '東 E',
  135: '東南 SE',
  180: '南 S',
  225: '西南 SW',
  270: '西 W',
  315: '西北 NW',
};

/* 每度對應的像素寬度：依螢幕寬度在 4.2–6.2 之間調整 */
const PX_MIN = 4.2;
const PX_MAX = 6.2;
const PX_DIV = 240;

/* 刻度帶的淡出半徑（度） */
const FADE_DEG = 100;

export class Hud {
  constructor(camera, zones, actions) {
    this.camera = camera;
    this.zones = zones;
    this.actions = actions;
    this.labels = [];
    this.ticks = [];
    this._promptAction = null;
    this._toastTimer = 0;
    this._header = null;

    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('hud'),
      facing: $('facing'),
      labels: $('labels'),
      tape: $('tape'),
      prompt: $('prompt'),
      promptBtn: $('promptBtn'),
      toast: $('toast'),
      menu: $('menu'),
      backdrop: $('menuBackdrop'),
      menuTitle: $('menuTitle'),
      menuEyebrow: $('menuEyebrow'),
      menuSub: $('menuSub'),
      menuMeta: $('menuMeta'),
      zoneList: $('zoneList'),
      langBtn: $('langBtn'),
      genderBtn: $('genderBtn'),
      camBtn: $('camBtn'),
      fsBtn: $('fsBtn'),
      closeMenu: $('closeMenu'),
      menuBtn: $('menuBtn'),
    };

    this._v = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._dir = new THREE.Vector3();

    this.buildCompass();
    this.buildBackButton();
    this.bind();
  }

  /* ---------------- 指南針 ---------------- */
  buildCompass() {
    for (let d = 0; d < 360; d += 15) {
      const major = d % 45 === 0;
      let el;
      if (major) {
        // 大刻度：中文方位 + 英文縮寫 + 角度讀數 + 長刻度線
        const parts = DIR_NAMES[d].split(' ');
        el = document.createElement('div');
        el.className = 'tk major';
        el.innerHTML =
          '<b><span class="cjk">' + parts[0] + '</span>' +
          '<span class="latin">' + (parts[1] || '') + '</span></b>' +
          '<i class="deg">' + String(d).padStart(3, '0') + '°</i>' +
          '<span class="bar"></span>';
      } else {
        // 小刻度：短刻度線
        el = document.createElement('i');
        el.className = 'tk minor';
        el.innerHTML = '<span class="bar"></span>';
      }
      el.dataset.deg = String(d);
      this.el.tape.appendChild(el);
      this.ticks.push({ el, deg: d });
    }
  }

  bearing(yaw) {
    return (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
  }

  directionName(bearing) {
    const i = Math.round(bearing / 45) % 8;
    return DIR_NAMES[i * 45];
  }

  updateCompass(yaw) {
    const b = this.bearing(yaw);
    this.el.facing.textContent = this._header != null ? this._header : t('facing') + '：' + this.directionName(b);

    // 刻度帶寬度隨螢幕縮放，窄螢幕仍可讀
    const px = Math.max(PX_MIN, Math.min(PX_MAX, window.innerWidth / PX_DIV));
    const tilt = 0.1;
    const fade = FADE_DEG;

    for (let i = 0; i < this.ticks.length; i++) {
      const tk = this.ticks[i];
      const d = ((tk.deg - b + 540) % 360) - 180;
      const x = d * px;
      const a = Math.abs(d);
      tk.el.style.transform =
        'translate(-50%,0) translateX(' + x.toFixed(1) + 'px) rotate(' + (d * tilt).toFixed(1) + 'deg)';
      tk.el.style.opacity = a > fade ? '0' : Math.max(0, 1 - Math.pow(a / fade, 2.6)).toFixed(3);
    }
  }

  /** 展館內把頂部徽章改成展館名稱；傳 null 回復「面向」 */
  setHeader(text) {
    this._header = text || null;
  }

  /* ---------------- 3D 標籤 ---------------- */
  addLabel(anchor, getText, cls = '') {
    const el = document.createElement('div');
    el.className = 'label ' + cls;
    const span = document.createElement('span');
    el.appendChild(span);
    this.el.labels.appendChild(el);
    const rec = { el, span, anchor, getText };
    this.labels.push(rec);
    this.refreshLabels();
    this.updateLabels();
    return rec;
  }

  clearLabels() {
    for (const l of this.labels) l.el.remove();
    this.labels.length = 0;
  }

  refreshLabels() {
    for (const l of this.labels) l.span.textContent = l.getText();
  }

  updateLabels() {
    if (!this.labels.length) return;
    const cam = this.camera;
    cam.getWorldDirection(this._dir);

    for (const l of this.labels) {
      this._v.copy(l.anchor).sub(cam.position);
      const dist = this._v.length();
      if (this._v.dot(this._dir) < 0.4) {
        l.el.style.opacity = '0';
        continue;
      }
      this._p.copy(l.anchor).project(cam);
      const x = (this._p.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-this._p.y * 0.5 + 0.5) * window.innerHeight;
      if (x < 90 || x > window.innerWidth - 90 || y < 70 || y > window.innerHeight + 40) {
        l.el.style.opacity = '0';
        continue;
      }
      // 每幀只改 transform，避免觸發版面重排
      l.el.style.transform = 'translate(-50%,-50%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      l.el.style.opacity = String(Math.max(0, Math.min(1, (78 - dist) / 26)));
    }
  }

  /* ---------------- 提示 ---------------- */
  showPrompt(text, fn) {
    this._promptAction = fn;
    this.el.root.classList.add('has-prompt');
    if (this.el.prompt.classList.contains('hidden') || this.el.promptBtn.textContent !== text) {
      this.el.promptBtn.textContent = text;
      this.el.prompt.classList.remove('hidden');
      // 主要動作優先，暫時收起提示條
      this._hideToast();
    }
  }

  hidePrompt() {
    this._promptAction = null;
    this.el.prompt.classList.add('hidden');
    this.el.root.classList.remove('has-prompt');
  }

  toast(text, ms = 4200) {
    this.el.toast.textContent = text;
    this.el.toast.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.el.toast.classList.add('hidden'), ms);
  }

  _hideToast() {
    clearTimeout(this._toastTimer);
    this.el.toast.classList.add('hidden');
  }

  /* ---------------- 選單 ---------------- */
  buildBackButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'back-btn';
    b.textContent = '← ' + t('back');
    b.hidden = true;
    b.addEventListener('click', () => this.actions.onBack && this.actions.onBack());
    this.el.root.appendChild(b);
    this.el.backBtn = b;
  }

  showBack(show, label) {
    this.el.backBtn.hidden = !show;
    if (label) this.el.backBtn.textContent = label;
  }

  refreshMenu() {
    this.el.menuTitle.textContent = t('title');
    this.el.menuEyebrow.textContent = t('eyebrow');
    this.el.menuSub.textContent = t('subtitle');

    const opened = this.zones.filter((z) => z.open !== false).length;
    this.el.menuMeta.textContent =
      opened + ' ' + t('zonesUnit') + (opened < this.zones.length ? ' · ' + (this.zones.length - opened) + ' ' + t('closedUnit') : '');

    this.el.langBtn.textContent = t('lang');
    this.el.genderBtn.textContent = t('genderBoy');

    this.el.zoneList.innerHTML = '';
    for (const z of this.zones) {
      const open = z.open !== false;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'zone-item' + (open ? '' : ' closed');
      b.disabled = !open;

      // 左側色條：以展館主色標示
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = open ? z.color || '#7a4e9e' : '#c8ccd4';

      const txt = document.createElement('span');
      txt.className = 'zone-text';
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = pick(z.title);
      const th = document.createElement('span');
      th.className = 'th';
      th.textContent = pick(z.theme);
      txt.appendChild(n);
      txt.appendChild(th);

      const tag = document.createElement('span');
      tag.className = 'tag ' + (open ? 'open' : 'closed');
      tag.textContent = open ? t('open') : t('closed');

      b.appendChild(sw);
      b.appendChild(txt);
      b.appendChild(tag);

      if (open) {
        b.addEventListener('click', () => {
          this.closeMenu();
          this.actions.onZone && this.actions.onZone(z);
        });
      }

      this.el.zoneList.appendChild(b);
    }
  }

  openMenu() {
    this.refreshMenu();
    this.el.menu.classList.remove('hidden');
    this.el.backdrop.classList.remove('hidden');
    this.el.menuBtn.setAttribute('aria-expanded', 'true');
    this.actions.onMenu && this.actions.onMenu(true);
    // 讓鍵盤使用者一開啟就能用 Tab 在卡片內移動
    if (typeof this.el.menu.focus === 'function') this.el.menu.focus({ preventScroll: true });
  }

  closeMenu() {
    this.el.menu.classList.add('hidden');
    this.el.backdrop.classList.add('hidden');
    this.el.menuBtn.setAttribute('aria-expanded', 'false');
    this.actions.onMenu && this.actions.onMenu(false);
    if (typeof this.el.menuBtn.focus === 'function') this.el.menuBtn.focus({ preventScroll: true });
  }

  setGenderLabel(gender) {
    this.el.genderBtn.textContent = gender === 'girl' ? t('genderGirl') : t('genderBoy');
  }

  setCamLabel(front) {
    this.el.camBtn.textContent = front ? t('camBack') : t('camFront');
  }

  bind() {
    this.el.menuBtn.addEventListener('click', () => this.openMenu());
    this.el.closeMenu.addEventListener('click', () => this.closeMenu());
    this.el.langBtn.addEventListener('click', () => this.actions.onLang && this.actions.onLang());
    this.el.genderBtn.addEventListener('click', () => this.actions.onGender && this.actions.onGender());
    this.el.fsBtn.addEventListener('click', () => this.actions.onFullscreen && this.actions.onFullscreen());
    this.el.camBtn.addEventListener('click', () => this.actions.onCam && this.actions.onCam());
    this.el.promptBtn.addEventListener('click', () => {
      if (this._promptAction) this._promptAction();
    });

    // 點背幕或右上角 ✕ 也可關閉選單
    this.el.backdrop.addEventListener('click', () => this.closeMenu());
    const menuX = this.el.menu.querySelector('.menu-x');
    if (menuX) menuX.addEventListener('click', () => this.closeMenu());
  }
}
