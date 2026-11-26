export const STR = {
  zh: {
    title: 'STEAM DAY 虛擬校園',
    subtitle: '各項活動的成果與花絮',
    start: '開始參觀',
    facing: '面向',
    enter: '進入展館',
    back: '返回廣場',
    play: '播放影片',
    close: '關閉',
    soon: '影片即將上載',
    lang: 'English',
    genderBoy: '角色：男生',
    genderGirl: '角色：女生',
    fullscreen: '全螢幕',
    hint: '用 ◀ ▶ 轉身，▲ ▼ 前進後退，走近展館再按「進入」',
    exitHint: '按 Esc 或「返回廣場」離開',
    chooseGrade: '選擇活動',
    loading: '載入中…',
    closed: '未開放',
    open: '開放中',
    camFront: '轉到正面',
    camBack: '轉回背面',
    lookMaxUp: '已到最高',
    lookMaxDown: '已到最低',
    loadFail: '載入失敗，請用本機伺服器開啟（不要直接雙擊 index.html）',
    noWebGL: '這個瀏覽器不支援 WebGL',
    menu: '選單',
    eyebrow: 'STEAM DAY · 虛擬校園導覽',
    zonesUnit: '個展區',
    closedUnit: '個未開放',
    go: '參觀',
    clickPhoto: '點一下相片可以放大看',
  },
  en: {
    title: 'STEAM DAY Virtual Campus',
    subtitle: 'Projects and highlights from our activities',
    start: 'Start exploring',
    facing: 'Facing',
    enter: 'Enter',
    back: 'Back to plaza',
    play: 'Play video',
    close: 'Close',
    soon: 'Video coming soon',
    lang: '中文',
    genderBoy: 'Character: Boy',
    genderGirl: 'Character: Girl',
    fullscreen: 'Full screen',
    hint: 'Turn with ◀ ▶, walk with ▲ ▼, then step close and tap Enter',
    exitHint: 'Press Esc or "Back to plaza" to leave',
    chooseGrade: 'Choose an activity',
    loading: 'Loading…',
    closed: 'Not open yet',
    open: 'Open',
    camFront: 'Face me',
    camBack: 'Back view',
    lookMaxUp: 'Highest',
    lookMaxDown: 'Lowest',
    loadFail: 'Failed to load. Please run a local server (do not open index.html directly).',
    noWebGL: 'This browser does not support WebGL',
    menu: 'Menu',
    eyebrow: 'STEAM DAY · CAMPUS TOUR',
    zonesUnit: 'zones open',
    closedUnit: 'not open yet',
    go: 'Visit',
    clickPhoto: 'Tap a photo to enlarge it',
  },
};

let lang = 'zh';

export function setLang(v) {
  if (v === 'zh' || v === 'en') lang = v;
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
}

export function getLang() {
  return lang;
}

export function t(key) {
  return (STR[lang] && STR[lang][key]) || STR.zh[key] || key;
}

/** content.json 內的雙語欄位：{ zh, en } 或純字串 */
export function pick(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] || value.zh || '';
}
