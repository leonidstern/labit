// An invite link for one person: node co/invite.mjs <name> <site url> [--owner]
// CO_SECRET must be the one the comments API has (vercel env pull, or the project's settings). --owner: your own link,
// which may also resolve, move and delete anyone's comments. Take a key back with CO_REVOKED on the API.
import { inviteKey } from './api/comments.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--owner');
const [name, site] = args;
if (!name || !site || !process.env.CO_SECRET) {
  console.error('usage: CO_SECRET=… node co/invite.mjs <name> <site url> [--owner]');
  process.exit(1);
}
const url = new URL(site);
url.hash = `co=${inviteKey(name.trim(), process.argv.includes('--owner'))}`;
console.log(url.href);
