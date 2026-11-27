// Docs: folded parts of a code block open and close with their button.
for (const button of document.querySelectorAll('pre.folds .fold')) {
  const hidden = button.nextElementSibling;
  button.addEventListener('click', () => {
    hidden.hidden = !hidden.hidden;
    button.setAttribute('aria-expanded', String(!hidden.hidden));
  });
}
