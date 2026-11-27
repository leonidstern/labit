// Sig 4. lib/dev.ts:101: the ETag is only size + mtime (rounded to ms). A file whose words change but whose size and
// mtime stay (cp -p, rsync -t, tar x, two saves in the same ms) gets "304 Not Modified" when the browser asks again,
// so the page's reload shows the old bytes. Plain HTTP, no browser.
import { repro, page, verdict, fs, path } from './_kit.mjs';
await repro('same-size-time', { 'index.html': page(), 's.css': 'main{}' }, async ({ B, dir }) => {
  const f = path.join(dir, 'app.js');
  fs.writeFileSync(f, 'var v="AAAA";');
  const st = fs.statSync(f);
  const first = await fetch(B + '/app.js');
  const etag = first.headers.get('etag');
  fs.writeFileSync(f, 'var v="BBBB";'); // same size
  fs.utimesSync(f, st.atime, st.mtime); // same time
  const again = await fetch(B + '/app.js', { headers: { 'if-none-match': etag } });
  verdict(again.status === 200, 'a changed file with the same size and mtime is served again', `If-None-Match ${etag} -> ${again.status} (disk has BBBB, browser keeps AAAA)`, '200 with the new bytes');
});
