# Spec: paste or drop an image onto a board

> **As built (local branch `local-paste-board`), where this spec changed.** Read these first; the sections below are the original text.
>
> - **One upload route, shared with comment pictures:** `POST /_lab/api/image?board=<name>[&page=/x][&x=&y=][&label=]` (not `/_lab/api/board/image`). Without `board` the same route stages a comment's picture (paste-image-comment). Same auth, sniff, 25 MB cap, 413/415 rules.
> - **Sniffer in `lib/images.mjs`** (`imageInfo`, `MAX_IMAGE`, `IMAGE_FILE`), not `lib/board.ts`. **No AVIF anywhere**: types are PNG, JPEG, WebP, GIF. The browser draws any other picture again as webp/jpeg before sending.
> - **Wifi guests may add a picture** (Leo): a guest with a valid pass cookie, same cap as the owner (25 MB), only on a board that is already stored (403 otherwise). Guests are Leo's own other devices: no count or tighter cap beyond the board's 60 frames (archived pictures are not counted toward them). The frame carries `guest: true` and the agent's text says `from a wifi guest`. Adding other frames, archiving, PUT and `board` POST stay owner-only. The client installs paste/drop/`+ image` for everyone (guests send their cookie, no key), so "no button for a guest" in the original browser test is gone.
> - **Client:** one lazy part `public/_lab/pics.js` (`src/widget/pics.ts`: `prep` + `send`) is shared with comment pictures; `mount.ts` loads it on the first picture. `comments.js` grows by 0 bytes.
> - **⌥ while pasting (Leo):** ⌥⌘V (or a drop with ⌥ held) also opens a pin composer on the new frame at its centre; plain ⌘V does not. A paste event doesn't carry ⌥, so `mount.ts` remembers it from the last key event. ⌥-click on an image frame comments like on any frame (tested). The browser tests drive ⌥⌘V with a synthetic paste; what each real browser does with ⌥⌘V is not tested (macOS Safari and Chrome may map it to paste-and-match-style).
> - **Overlap fix the spec missed:** an image lands at the pointer, usually on top of other frames, and the pin lookup picked the first (oldest) frame under the point. `anchor()` and `at()` now prefer the topmost frame.
> - **Unclear in the spec, decided here:** `x`/`y` in the request are the picture's centre (the lab converts to top-left); "the camera stays put (`moved` unchanged)" holds on a board's own address (its `#x,y,z` hash makes it moved); not checked in a half view.
> - **Tests:** `test/boardimage.test.mjs` (7), a guest test in `test/security.test.mjs`, `test/browser/boardimage.mjs` (WebKit + Chromium). Wired into `.github/workflows/test.yml` group c and `ci/affected.mjs`.
> - **Size (measured, vs main ac8d847):** page script +0, `boardview.js.br` +919 B, `pics.js.br` +637 B (new), `dist/local.mjs` +2.0 KB gzip, pack +3,749 B of the 4,096 B per-PR budget.

Status: ready to build. Repo state read: `dbdb606` (#372).

## Behaviour

On a board (own address `/_lab/board/<name>` or the `#board=<name>` view over a page), in **this computer's browser**:

- **Paste** (⌘V / Ctrl+V) an image from the clipboard, or **drop** one or more image files on the board's box, and a new frame showing the picture appears. It goes at the pointer (paste: last pointer position over the box; drop: the drop point), else at the view's centre.
- A **"+ image"** button in the corner cluster (`.zm`) opens a file picker: the fallback for touch screens and for anyone who doesn't know about paste. Placement: view centre.
- The frame is a bare picture: no iframe, no widget, never "entered" (double tap / Enter do nothing on it). Pins on it are ordinary board pins (`anchor: {kind:'board', board, frame, fx, fy}`).
- The agent reads a pin on it as "near: frame c (pasted image .lab/boards/<b>/c.png, 2400×1600 px shown at 1440×960) …" and can open the file.
- The agent can add one too: `labit board add <board> shot.png [--label …] [--after <frame>]`.
- Image frames are archived like any frame, never deleted (frame or file).

## Data shape (`.lab/boards/<name>.json`)

```json
{"id":"c","src":"/_lab/board/hero/c","kind":"image","file":"c.png","iw":2400,"ih":1600,"w":1440,"h":960,"x":312,"y":-40,"state":"live","label":"from clipboard"}
```

- `kind: 'image'` (absent = a page, as today). `file` is `<id>.<ext>`, ext ∈ `png jpg webp gif avif`. `iw`/`ih`: the stored image's pixel size.
- `src` stays the board route `/_lab/board/<name>/<id>`, so `labPath`, the "own variant" rule in `check()` and every `src.startsWith('/_lab/')` path keep working.
- `w`/`h`: world px. Long side = `min(longSide(iw,ih), 1440)`, aspect kept, then each axis clamped 200..4000 by `check()` (a 3000×150 banner gets a 200 px tall frame; the `<img>` uses `object-fit: contain`, so nothing distorts).
- `x`/`y` are explicit (not `auto`): the frame's centre at the requested point.

## Server

### `lib/board.ts`
- `Frame` type: add `kind?: 'image'; file?: string; iw?: number; ih?: number`.
- `export const IMAGE_EXT = /^(png|jpg|webp|gif|avif)$/`, `export const MAX_IMAGE = 8 * 1024 * 1024`.
- `export function imageInfo(buf: Buffer): { ext, type, w, h } | null`: magic-byte sniff plus header size read, no deps, ~40 lines. PNG (`89 50 4E 47`, IHDR at 16), GIF (`GIF87a/89a`, LE u16 at 6), JPEG (`FF D8 FF`, walk markers to SOF0..SOF15 except C4/C8/CC), WebP (`RIFF….WEBP`, chunks VP8 / VP8L / VP8X), AVIF (`ftyp` at 4 with brand `avif`/`avis` major or compatible; first `ispe` box in the first 64 KB: u32 w, h at +8/+12). Anything else (SVG, HTML, HEIC, truncated) is `null`. Also `null` when a side is 0, a side is over 16384, or w×h is over 50 MP.
- `check()`: for `f.kind === 'image'`, require `f.src === /_lab/board/${name}/${f.id}` and `f.file` matching `^${f.id}\.(png|jpg|webp|gif|avif)$`, else return `frame ${id}: an image frame is its own file <id>.<ext>`. Copy `kind`, `file`, `iw`, `ih` (iw/ih via `px(…,1,16384)`). This also covers PUT and hand edits: a stored frame can only ever point at `<id>.<ext>` in its own board folder.
- `export const imageFile = (root, name, file) => path.join(dirOf(root), safeName(name), file)`, which throws unless `file` matches `^[a-z][a-z0-9]{0,5}\.(png|jpg|webp|gif|avif)$`.
- `export function addImage(root, b, bytes, info, at?: {x,y}, opts?: {label, after})`: picks the id with `nextId`, skipping any id with a leftover `<id>.*` in the folder. Then writes the file (`writeAtomic`), inserts the frame, bumps `rev` and calls `save`. Fully synchronous, so nothing can interleave between read and write (the PUT's rule). It refuses when `frames.length >= MAX_FRAMES`, returning `'A board holds at most 60 frames.'`. Shared by the route and `act('add')`.

### `lib/boardact.ts`
- `export const shown = (b, f) => f.kind === 'image' ? `pasted image .lab/boards/${b.name}/${f.file}` : f.src.startsWith('/_lab/') ? `${f.id}.html` : f.src`. Use it in `text()` (the frame line), in `frameLine()` (add `iw×ih px shown at w×h` for images) and in `local.mjs` `boardText` (line ~802, the `near:` / `seen on:` rewrite).
- `frameLine` / pick: `copy(g)` must exclude `kind === 'image'`. Otherwise picking an image would print "Put c's change into /page", and archiving one would print "Delete the variant files (… c.html)" with the wrong name, against the never-delete rule. A picked image says: `picked: c is a pasted image (path): make <page> match it, then resolve it with no words`. `gonecopies` and "files kept" ignore images.
- `act('add')`: before the `.html` branch, if the target is an existing file and its first 64 KB give `imageInfo`, it must be ≤ `MAX_IMAGE`. Then call `addImage` (auto-placed: no `at`) and answer `Added c (pasted image .lab/boards/<b>/c.png)`. The same path rules as the html copy-in apply (the agent is trusted, keyed). The usage strings in `lib/commands.ts:158` and the `local.mjs` help (line ~104) change to `<frame|/page|file.html|image>`.

### `local.mjs`
1. **JSON gate** (line 2219): non-GET `/_lab/` requests must be `application/json`. Add one exception: `pathname === '/_lab/api/board/image'` with content-type exactly `image/(png|jpeg|webp|gif|avif)`. `sameOrigin` still applies. These types are not CORS-safelisted, so a cross-site page can't send one without a preflight, and the lab answers no preflight.
2. **`sentWithin`** returns the `Buffer` (`sent()` does `.toString()`), so the image route can read raw bytes with `MAX_IMAGE`.
3. **Route** in the board block (line 2590): add `|| pathname === '/_lab/api/board/image'` and dispatch to `boardImage(req, res, url)`:

| | |
|---|---|
| Method / path | `POST /_lab/api/board/image?name=<board>[&page=/x][&x=<wx>&y=<wy>][&label=…]` |
| Request headers | `content-type: image/png\|jpeg\|webp\|gif\|avif`; `x-lab-admin: <TOKEN>` (browser) or the agent pair (`x-lab-agent: 1` + agent key); same `origin`; body = raw bytes |
| Order | Auth first, then the query, then `content-length`, then the body. A guest's bytes are never buffered |
| 403 | not `isAgent(req)` and not `isLoopback(req) && keyOk(req)`. Every `--wifi` guest gets this, cookie or not |
| 400 | `name` fails `NAME`, `page` fails `labPath`, x/y given but not finite |
| 413 | `content-length` > 8 MB (answered at once), or the streamed body passes 8 MB (rest drained and dropped) |
| 415 | `imageInfo(bytes)` is null, or its type ≠ the declared content-type (SVG is never sniffed as anything) |
| 404 | no stored board and no `page` |
| 422 | 60 frames already; `{error, text}` like the board POST |
| 200 | `{ board: B.place(board), frame, text }` |

   With no stored board and a valid `page`, the route first creates the board the GET shows (`of: page`, frame `a` = the page at 1440×900), then adds the image. After saving it does what the board POST does: `boardCache.delete(name)`, `boardList = null`, `watchBoards()`. The watcher's regex ignores `.png` and `.tmp`. The JSON change bumps `boards` and the board reloads.
4. **Frame route** (line 2592): before the `.html` branch, look up `boardGet(m[1])?.frames.find(id)`. If `kind === 'image'`, send `imageFile(ROOT, m[1], f.file)` through `sendFile` with extra headers: `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; sandbox`, `content-disposition: inline`. That needs an optional `extra` headers argument on `sendFile` in `lib/dev.ts`. The type comes from the extension map (never `.svg`, which `IMAGE_EXT` excludes). There is no `inject`/`widget`, so no `markOpened`. The `etag` / 304 / range handling comes with `sendFile`; images are not in `SQUEEZE`. A missing file goes to `notFound`.

## Client (`src/board/mount.ts`, built into the lazy `boardview.js`)

- `admin = document.querySelector<HTMLScriptElement>('script[data-admin]')?.dataset.admin || ''`. The widget tag carries `data-admin` only for loopback (`widget()` line 1885). **Without it nothing below is installed**: no listeners, no button.
- **Rendering**: in `show()`/`card()`, an image frame's `.b` holds `<img src=f.src alt=label draggable=false decoding=async loading=lazy>` with `object-fit:contain; width/height:100%; pointer-events:none`. `wake()` / `live()` / `enter()` skip `kind === 'image'` (no iframe, no CAP slot), and `at()`/`anchor()` stay unchanged, so pins work as on any frame. The phone layout (the `coarse` re-layout) shows images at 390 wide like pages.
- **Pointer**: keep `last = {x, y}` from the existing capture `pointermove` / `pointerdown` when `inBox`.
- **Paste**: `on('paste', fn, true)`. Ignore it (no `preventDefault`) when any of these holds:
  - the composed path has an editable element (generalize the existing `typing()` to take an `Event`: INPUT, TEXTAREA, contenteditable, `[data-lab-comments]`, the comment composer and chat);
  - a frame is entered, or an iframe has focus (the paste then belongs to that document anyway);
  - in a half view (`#board=` over a page), `last` is not inside the box, since that paste belongs to the page underneath;
  - `clipboardData` has no `kind === 'file'` item with `type` starting `image/` (a text paste stays untouched).

  Otherwise `preventDefault` + `stopImmediatePropagation` and upload the first image at `last` (or the centre).
- **Drop**: `dragover` on `mine(e)` with `dataTransfer.types.includes('Files')` calls `preventDefault`, sets `dropEffect='copy'` and adds class `drop` (a 2 px inset outline on the box). `dragleave`/`drop` remove it. `drop` takes up to 6 `image/*` files, uploaded one after another; each one after the first goes 40 world px down-right. Stop at the first error. A drop over an entered frame goes to the iframe and is not ours.
- **Prepare** (`prep(blob)`, ~30 lines): decode with `createImageBitmap`, falling back to `<img>` + object URL. Send the original bytes when the type is png/webp/gif/avif, the long side is ≤ 2400 and the size is ≤ 8 MB. GIF animation survives that way. Otherwise draw onto a canvas scaled to a 2400 long side and use `toBlob`: png/gif/webp sources ask for `image/webp` 0.9 (Safari returns PNG: accept `blob.type`); if the result is still over 8 MB, use `image/jpeg` 0.88. JPEG and anything else, HEIC included (Safari decodes it), always go to `image/jpeg` 0.88, which bakes the EXIF orientation in. Undecodable: show the error "That file isn't an image the board can show."
- **Upload**: `fetch('/_lab/api/board/image?name=…&page=…&x=…&y=…', {method:'POST', headers:{'content-type': blob.type, 'x-lab-admin': admin}, body: blob})`. While it runs, a ghost box ("adding image…") sits at the point. On 200, call `load()` right away (don't wait for the stream). The camera stays put (`moved` unchanged). On an error, the server's `error` text shows for 3 s in a `.none`-style note.
- **"+ image" button**: a `.zc`-style button in `zoomBox`, shown always when `admin` is set (not only `coarse`). It opens a hidden `<input type=file accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple>`. On iOS / iPadOS that offers Photos and Camera and converts HEIC.

## Security notes
- Who can write: loopback with the admin key, or the agent. It's the board POST's rule, stricter than PUT's loopback-only check, because this route writes a file. A LAN guest never gets `data-admin`, and the server refuses the guest even if the client is bypassed.
- Bytes are typed by their magic, never by name or header alone. Extension and type both come from the sniff, and a mismatch is refused. SVG can't be stored or served, so no stored image can run script. Served images also carry `nosniff` and `sandbox` CSP, in case a file is replaced on disk with HTML.
- Paths: the name is checked by `NAME` and `safeName`, the id comes from `nextId` (it fits `FRAME`), and the file name is built by the server and re-checked by `imageFile` and `check()`. The client never names a path. Dot-segment requests are already refused upstream.
- Resource limits: 8 MB per request, checked before buffering; a 50 MP / 16384 px header limit; 60 frames. Worst case is about 480 MB of disk per board, which is accepted (archived files are kept by design).

## Edge cases
- Pasting on a page's board that was never saved creates it (see the route). Pasting in a `--proxy` lab works the same (the path is `/_lab/`).
- Two tabs paste at once: each request is read-then-write with no `await` between, and ids never collide.
- A hand-deleted image file: the frame route returns 404 and the `<img>` shows the browser's broken state. Not repaired.
- A leftover `c.html` / `c.png` from an older board with the same id: skipped by `addImage`.
- The board is at 60 frames: 422, and the note says so; the client doesn't pre-check.
- A text paste or a paste in a composer is unaffected. ⌘V while a frame is entered goes to that frame's page.
- A 1×1 or tiny image: the frame is clamped to 200 px and the image is centred inside it.

## Tests
**`test/boardimage.test.mjs`** (node --test, harness `spawnLab`, a board seeded by PUT as in `board.test.mjs`). Fixtures are built in the test: a valid PNG via `zlib.deflateSync` + CRC, a 2-frame GIF, and minimal JPEG/WebP(VP8, VP8L, VP8X)/AVIF headers.
1. `imageInfo` (imported from `lib/board.ts`): the right `{ext,w,h}` for each fixture; `null` for SVG, HTML, truncated PNG, HEIC `ftyp`, a 20000 px PNG header.
2. POST a PNG at x=500,y=300 → 200; the frame has `kind:'image'`, `file:'b.png'`, its centre at 500,300; the bytes on disk are identical; `rev` went up.
3. GET `/_lab/board/<b>/b` → `image/png`, `nosniff`, the CSP sandbox header, the body equal to the upload, no `<script`; HEAD → 200 with no body; `if-none-match` → 304.
4. Refusals: no key → 403 (no file written); a foreign `origin` → 403; `image/svg+xml` → 403; a PNG header with SVG bytes → 415; JPEG declared but PNG sent → 415; 8 MB + 1 → 413; `name=../x` → 400; a 61st frame → 422.
5. A PUT changing `file` to `../../package.json` or `a.png` on frame b → 422.
6. Agent: POST `{action:'add', name, target:'shot.png'}` → an image frame, and the text names `.lab/boards/<b>/c.png`. A board-anchor pin on it (`/_lab/api/comments`), then `/_lab/agent/_board/<b>` contains `near: frame c (pasted image .lab/boards/<b>/c.png`. Pick another frame: the image is archived, its file still exists, and the text does not say "Delete".

**`test/security.test.mjs`**, inside the existing `--wifi` block: a guest *with* a valid pass cookie POSTs an image → 403, and the board folder is unchanged.

**`test/browser/boardimage.mjs`** (harness like `boardpins.mjs`, WebKit + Chromium). Add it to group `c` in `.github/workflows/test.yml` and to the `src/board/mount.ts` / `overlay.ts` REACH lists in `ci/affected.mjs`.
- `setInputFiles` on the "+ image" input → a new `.f[data-id=b] img` with `naturalWidth > 0`.
- A synthetic `paste` (`new ClipboardEvent('paste', {clipboardData: dt})` with a `DataTransfer` holding a PNG `File`) with the pointer over the board → a frame near the pointer. If the engine drops `clipboardData` from the init, the check is reported as skipped, not passed.
- The same paste with focus in the comment textarea → no new frame, and the text pasted normally.
- Click on the image in comment mode → the saved anchor is `{kind:'board', frame:'b'}`.
- The page as a guest (no `data-admin`): no "+ image" button.

## Size budget
The caps (from `ci/metrics.mjs`): `pageScriptGzipBytes` measures `public/_lab/comments.js` gzip -9 (max 80,000, +2,048 per PR). `npmPackBytes` measures the `npm pack` tarball, which holds `dist/local.mjs` and the `.js.br` parts including `boardview.js.br` (max 180,000, +4,096 per PR). The 180 KB cap is the package, not a server gzip.

- `comments.js`: **+0** (no changes under `src/comments.js` / `src/widget/`; all client code is in `src/board/mount.ts`, which ships in `boardview.js`).
- `boardview.js`: about +1.3 KB gzip (prep, paste/drop, button, img card).
- `dist/local.mjs`: about +1.5 KB compressed (`imageInfo`, `addImage`, the route, the header tweaks).
- Pack total: about +3 KB, within the 4 KB per-PR budget. **Measure with `npm run build && node ci/metrics.mjs`** (not run while writing this).

## Non-goals
- No uploads from LAN guests or phones on `--wifi`. Phones only get the button on this computer's touch screens; guest writes would need their own decision.
- No SVG, HEIC storage, PDF or video. No server-side resizing or re-encoding (no deps).
- No moving or resizing frames by hand (the existing rule), and no cropping or annotating on the image beyond pins and drawings.
- No copy out (⌘C of a frame) and no paste of HTML or URLs as frames.
- No deleting images or frames; no garbage collection of archived files.
- No hot reload when an image file is replaced on disk (a reload shows it via the etag).
- No per-frame pin counts for image frames in `labit board list` (board-anchor pins aren't counted there today either).
- No change to the skill's other rules. The Boards section of `skills/labit/SKILL.md` gains one bullet: a pasted image is a frame whose file the agent reads; it never edits or deletes it; `LAB board add <board> <image>` shows one itself.
