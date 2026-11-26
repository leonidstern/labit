// npm shows the README that is in the package. GitHub's README has a picture per section; the one on npm is
// text only. `strip` (prepack) keeps the full README aside and drops every line that is only a picture;
// `restore` (postpack) puts the full one back.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const README = "README.md";
const FULL = ".README.full.md";

if (process.argv[2] === "strip") {
  if (!existsSync(FULL)) renameSync(README, FULL);
  const text = readFileSync(FULL, "utf8")
    .replace(/^(<picture>.*<\/picture>|!\[[^\]]*\]\([^)]*\))\n\n?/gm, "");
  writeFileSync(README, text);
} else if (process.argv[2] === "restore") {
  if (existsSync(FULL)) renameSync(FULL, README);
} else {
  console.error("usage: node scripts/readme-npm.mjs strip|restore");
  process.exit(1);
}
