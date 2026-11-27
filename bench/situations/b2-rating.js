// <tide-rating score="4.8" reviews="2300">: the rating card. Its markup and styles live in a shadow root,
// so the page's own styles cannot reach it.
const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host { display: block; max-width: 420px; }
    .card { padding: 24px 28px; border: 1px solid #e4e2dc; border-radius: 16px; font: 17px/1.5 -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1b1d21; }
    .score { margin: 0; font-size: 20px; }
    .score b { font-size: 40px; }
    .count, .source { margin: 6px 0 0; color: #62605a; font-size: 15px; }
  </style>
  <div class="card">
    <p class="score"><b id="score"></b> out of 5</p>
    <p class="count">from <span id="reviews"></span> reviews by teams like yours</p>
    <p class="source">Collected by Capterra and updated weekly</p>
  </div>
`;

class TideRating extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    root.append(template.content.cloneNode(true));
    root.getElementById('score').textContent = this.getAttribute('score');
    root.getElementById('reviews').textContent = Number(this.getAttribute('reviews')).toLocaleString('en');
  }
}
customElements.define('tide-rating', TideRating);
