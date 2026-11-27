// Drawings as quick actions: what the person draws on pricing.html, and how to tell from the edited page that the
// agent did the right thing. `check` gets the edited page's HTML (and the original) and returns true when it did.
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
// The lead paragraph's words; '' when it is gone.
const lead = (h) => text((h.match(/<p class="lead">[\s\S]*?<\/p>/) || [''])[0]);
// One plan's card: split at each card, so a match never runs from an earlier card into this one.
const plan = (h, name) => h.split('<article class="plan">').slice(1).map((a) => a.split('</article>')[0]).find((a) => a.includes(`<h3>${name}</h3>`)) || '';

export const SCENARIOS = [
  { id: 'x-fine', mark: 'x', on: '.hero .fine', ask: 'remove "No credit card required."', check: (h) => !h.includes('No credit card required') },
  { id: 'strike-li', mark: 'strike', on: 'text=Priority support', ask: 'remove the "Priority support" line', check: (h) => !h.includes('Priority support') && h.includes('Unlimited guests') },
  { id: 'scribble-note', mark: 'scribble', on: '#plans .note', ask: 'remove the prices note', check: (h) => !h.includes('billed yearly') && h.includes('<h2>Plans</h2>') },
  { id: 'x-solo-li', mark: 'x', on: 'text=90 days of history', ask: 'remove "90 days of history"', check: (h) => !h.includes('90 days of history') && h.includes('3 calendars') },
  { id: 'wavy-typo', mark: 'wavy', on: 'text=Unlimted history', ask: 'fix "Unlimted"', check: (h) => !h.includes('Unlimted') && plan(h, 'Team').includes('Unlimited history') },
  { id: 'circle-button', mark: 'circle', on: 'a[href="/signup?plan=team"]', ask: 'fix "Start free trail"', check: (h) => !h.includes('free trail') && h.includes('href="/signup?plan=team">Start free trial') },
  { id: 'box-heading', mark: 'box', on: 'h3:has-text("Stuido")', ask: 'fix "Stuido"', check: (h) => !h.includes('Stuido') && h.includes('<h3>Studio</h3>') },
  { id: 'underline-blurb', mark: 'underline', on: 'text=For teams who plans together', ask: 'rewrite the Team blurb', check: (h) => !h.includes('who plans together') && /<p class="blurb">[^<]{8,}<\/p>/.test(plan(h, 'Team')) },
  { id: 'side-lead', mark: 'side', on: '.hero .lead', ask: 'rework the lead paragraph', check: (h, o) => lead(h) !== '' && lead(h) !== lead(o) },
  { id: 'caret-team', mark: 'caret', on: 'text=Up to 50 guests per event', ask: 'add an item to the Team list', check: (h, o) => (plan(h, 'Team').match(/<li>/g) || []).length > (plan(o, 'Team').match(/<li>/g) || []).length },
  { id: 'arrow-li', mark: 'arrow', on: 'text=Priority support', to: 'text=Shared availability >> nth=0', ask: 'move "Priority support" into the Team plan', check: (h) => plan(h, 'Team').includes('Priority support') && plan(h, 'Team').includes('Shared availability') && !(plan(h, 'Stuido') + plan(h, 'Studio')).includes('Priority support') }, // the card may have had its typo fixed too
  { id: 'circle-price', mark: 'circle', on: '.plan:nth-child(3) .price', ask: 'nothing is wrong with the Studio price: it should say so or ask, not invent a change', check: (h) => h.includes('<p class="price"><b>€11</b> per person / month</p>') },
];
