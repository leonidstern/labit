// Fills the changelog on the docs page from data/changelog.json.
const list = document.getElementById('changelog-list');
const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

fetch('data/changelog.json')
  .then((res) => res.json())
  .then((releases) => {
    for (const release of releases) {
      const heading = document.createElement('h3');
      heading.textContent = `${release.version} · ${day.format(new Date(release.date))}`;
      const notes = document.createElement('ul');
      for (const note of release.notes) {
        const item = document.createElement('li');
        item.textContent = note;
        notes.append(item);
      }
      list.append(heading, notes);
    }
  });
