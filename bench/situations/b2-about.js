// About page: the slides, and pictures that load when they come near the window.
const carousel = document.getElementById('shipped-carousel');
const track = carousel.querySelector('.track');
const count = carousel.querySelector('.count');
const total = track.children.length;
let slide = 0;

function show(index) {
  slide = (index + total) % total;
  track.style.transform = `translateX(-${slide * 100}%)`;
  count.textContent = `${slide + 1} / ${total}`;
}
carousel.querySelector('.prev').addEventListener('click', () => show(slide - 1));
carousel.querySelector('.next').addEventListener('click', () => show(slide + 1));

// Pictures with class "lazy" start as a tiny blurred file; the real one (data-src) is swapped in.
const lazy = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      img.src = img.dataset.src;
      img.classList.remove('lazy');
      lazy.unobserve(img);
    }
  },
  { rootMargin: '300px' },
);
for (const img of document.querySelectorAll('img.lazy')) lazy.observe(img);
