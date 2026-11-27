// Film page: the tour at double speed, and the clip that opens over the page.
const fast = document.getElementById('fast-video');
const play = document.getElementById('fast-play');
play.addEventListener('click', () => {
  fast.playbackRate = 2;
  if (fast.paused) fast.play();
  else fast.pause();
});
fast.addEventListener('play', () => (play.textContent = 'Pause'));
fast.addEventListener('pause', () => (play.textContent = 'Play'));

const box = document.getElementById('clip-box');
const clip = box.querySelector('video');
document.getElementById('clip-open').addEventListener('click', () => (box.hidden = false));
document.getElementById('clip-close').addEventListener('click', () => {
  clip.pause();
  box.hidden = true;
});
