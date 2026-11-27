// Puts the page in the visitor's language. The words in the HTML are the English fallback;
// every element with data-i18n gets its text from locales/<language>.json.
const SUPPORTED = ['en', 'de'];
const wanted = (navigator.language || 'en').slice(0, 2).toLowerCase();
const language = SUPPORTED.includes(wanted) ? wanted : 'en';

const lookup = (strings, key) => key.split('.').reduce((node, part) => (node ? node[part] : undefined), strings);

fetch(`locales/${language}.json`)
  .then((res) => res.json())
  .then((strings) => {
    document.documentElement.lang = language;
    for (const node of document.querySelectorAll('[data-i18n]')) {
      const text = lookup(strings, node.dataset.i18n);
      if (typeof text === 'string') node.textContent = text;
    }
  });
