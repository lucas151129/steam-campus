let root = null;
let img = null;
let cap = null;
let prevBtn = null;
let nextBtn = null;

let list = [];
let idx = 0;
let caption = '';
let open = false;

/** 相片放大層：點相片牆或大螢幕時使用 */
export function initLightbox() {
  root = document.getElementById('photo');
  img = document.getElementById('photoImg');
  cap = document.getElementById('photoCap');
  prevBtn = document.getElementById('photoPrev');
  nextBtn = document.getElementById('photoNext');
  const closeBtn = document.getElementById('photoClose');

  if (!root || !img) return;

  closeBtn.addEventListener('click', closeLightbox);
  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    step(-1);
  });
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    step(1);
  });
  root.addEventListener('click', (e) => {
    if (e.target === root) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeLightbox();
    } else if (e.key === 'ArrowLeft') {
      step(-1);
    } else if (e.key === 'ArrowRight') {
      step(1);
    }
  });
}

export function openLightbox(photos, index, text) {
  if (!root || !photos || !photos.length) return;

  list = photos.slice();
  caption = text || '';
  idx = Math.max(0, Math.min(list.length - 1, Number(index) || 0));

  paint();
  root.classList.remove('hidden');
  open = true;
  document.dispatchEvent(new CustomEvent('campus:photo', { detail: { open: true } }));
}

export function closeLightbox() {
  if (!root || !open) return;
  root.classList.add('hidden');
  img.removeAttribute('src');
  open = false;
  document.dispatchEvent(new CustomEvent('campus:photo', { detail: { open: false } }));
}

export function isLightboxOpen() {
  return open;
}

function step(d) {
  if (list.length < 2) return;
  idx = (idx + d + list.length) % list.length;
  paint();
}

function paint() {
  img.src = list[idx];
  const n = list.length;
  cap.textContent = (caption ? caption + '　·　' : '') + (idx + 1) + ' / ' + n;
  const many = n > 1;
  prevBtn.disabled = !many;
  nextBtn.disabled = !many;
}
