// Workspace page: the Export and Share menus, and the window that asks before deleting.
const status = document.getElementById('menu-status');
const wraps = [...document.querySelectorAll('.menu-wrap')];
const said = {
  ics: 'Calendar file downloaded',
  csv: 'Spreadsheet downloaded',
  copy: 'Link copied',
  invite: 'Invite sent',
  embed: 'Embed code copied',
};

function closeMenus(except) {
  for (const wrap of wraps) {
    if (wrap === except) continue;
    wrap.querySelector('.menu').hidden = true;
    wrap.querySelector('button').setAttribute('aria-expanded', 'false');
  }
}

for (const wrap of wraps) {
  const button = wrap.querySelector('button');
  const menu = wrap.querySelector('.menu');
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    closeMenus(wrap);
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
  });
  // Picking an item does it and closes the menu.
  menu.addEventListener('click', (event) => {
    const item = event.target.closest('[role="menuitem"]');
    if (!item) return;
    status.textContent = said[item.dataset.action];
    closeMenus();
  });
}
document.addEventListener('click', () => closeMenus());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenus();
});

const backdrop = document.getElementById('delete-backdrop');
document.getElementById('delete-open').addEventListener('click', () => (backdrop.hidden = false));
document.getElementById('delete-cancel').addEventListener('click', () => (backdrop.hidden = true));
document.getElementById('delete-confirm').addEventListener('click', () => (backdrop.hidden = true));
