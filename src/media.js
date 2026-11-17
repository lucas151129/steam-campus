let root = null;
let frame = null;
let isOpen = false;

export function initMedia() {
  root = document.getElementById('video');
  frame = document.getElementById('videoFrame');

  const close = document.getElementById('videoClose');
  if (close) close.addEventListener('click', closeVideo);

  root.addEventListener('click', (e) => {
    if (e.target === root) closeVideo();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closeVideo();
  });
}

export function openVideo(item, label) {
  if (!root) return;

  frame.innerHTML = '';

  const id = item && item.id ? String(item.id).trim() : '';

  if (!id) {
    const soon = document.createElement('div');
    soon.className = 'soon';
    soon.textContent = label;
    frame.appendChild(soon);
  } else {
    const iframe = document.createElement('iframe');
    iframe.setAttribute(
      'allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen'
    );
    iframe.allowFullscreen = true;
    iframe.src =
      item.type === 'drive'
        ? 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/preview'
        : 'https://www.youtube.com/embed/' +
          encodeURIComponent(id) +
          '?rel=0&modestbranding=1&playsinline=1&autoplay=1';
    frame.appendChild(iframe);
  }

  root.classList.remove('hidden');
  isOpen = true;
  document.dispatchEvent(new CustomEvent('campus:video', { detail: { open: true } }));
}

export function closeVideo() {
  if (!root || !isOpen) return;
  root.classList.add('hidden');
  frame.innerHTML = '';
  isOpen = false;
  document.dispatchEvent(new CustomEvent('campus:video', { detail: { open: false } }));
}
