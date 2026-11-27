// npm shows the README that is in the package. GitHub's README has a picture per section; the one on npm is
// text only. `strip` (prepack) keeps the full README aside and drops every line that is only a picture;
// `restore` (postpack) puts the full one back.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const README = "README.md";
const FULL = ".README.full.md";

const stripped = (t) => t.replace(/^(<picture>.*<\/picture>|!\[[^\]]*\]\([^)]*\))\n\n?/gm, "");

if (process.argv[2] === "strip") {
  // A full README left aside by a pack that stopped half way is the full one only while README is still its stripped
  // copy; a README edited since is the newer one, and it is what is kept aside.
  if (!existsSync(FULL) || readFileSync(README, "utf8") !== stripped(readFileSync(FULL, "utf8"))) renameSync(README, FULL);
  writeFileSync(README, stripped(readFileSync(FULL, "utf8")));
} else if (process.argv[2] === "restore") {
  if (existsSync(FULL)) renameSync(FULL, README);
} else {
  console.error("usage: node scripts/readme-npm.mjs strip|restore");
  process.exit(1);
}
