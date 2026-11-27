# Motion

Everything in the widget that moves uses one set of durations and curves: tokens, next to the colour tokens in the
`:host` block of `src/widget/styles.css`. The same names, as `--lab-*`, are in `src/lab.css` (served minified as `/_lab/lab.css`) for lab pages, and
a page that sets a `--lab-*` one changes the widget's, as it does for the colours.

Code that needs a number (a timer, a Web Animation, which can't read a `var()`) reads the same tokens:
`ms('slow')` and `ease('settle')` in `src/widget/anchoring.ts`. No duration or curve is written anywhere else.

## Tokens

| Token (`--lab-*` hook) | Value | For |
| --- | --- | --- |
| `--_t-quick` (`--lab-t-quick`) | 120 ms | a hover, a colour, a small fade, a press: small and local |
| `--_t-base` (`--lab-t-base`) | 200 ms | something appears or moves a little: a card, a message, a fade-in, a box changing size |
| `--_t-slow` (`--lab-t-slow`) | 300 ms | the biggest movements: a sheet, a pin changing face |
| `--_t-loop` (`--lab-t-loop`) | 1200 ms | one turn of something that goes on: the agent's ring |
| `--_t-hold` (`--lab-t-hold`) | 1000 ms | how long a highlight stays. A wait, not a movement: kept with reduced motion |
| `--_t-calm` (`--lab-t-calm`) | 120 ms | reduced motion only: the crossfade that stands in for a slide, a zoom or a rise (not zeroed) |
| `--_ease` (`--lab-ease`) | cubic-bezier(.2, .8, .2, 1) | standard: quick start, soft landing (it was already there) |
| `--_ease-out` (`--lab-ease-out`) | cubic-bezier(0, 0, .58, 1) | a fade or colour coming in (CSS `ease-out`) |
| `--_ease-in` (`--lab-ease-in`) | cubic-bezier(.4, 0, 1, 1) | something leaving: it speeds up as it goes |
| `--_ease-settle` (`--lab-ease-settle`) | cubic-bezier(.32, .72, 0, 1) | a sheet: iOS's curve, fast then a long settle |
| `--_ease-pop` (`--lab-ease-pop`) | cubic-bezier(.34, 1.56, .64, 1) | an arrival with a small overshoot |

Two pairs and one composite, only so the same long declaration is not copied (`ci/reuse.mjs`):
`--_fade` (quick + out), `--_fade-base` (base + out), `--_twitch` (2 × loop, ease-in-out, infinite).
`linear` stays a keyword: the ring's turn. A sheet let go is the one place a curve is worked out in code (`glide`, `carry` in `sheets.ts`): a cubic-bezier whose first slope is the speed it had at release, so it continues at the finger's speed.

## Reduced motion

One rule (after the keyframes in `styles.css`; `lab.css` has the same for its names): under
`prefers-reduced-motion: reduce`, `--_t-quick`, `-base`, `-slow` and `-loop` are 0 ms, and animations run once with no
delay. CSS and code both read the tokens, so nothing else is switched off one by one. What moves ends where it would
have ended; a loop is one still frame. `--_t-hold` is not zeroed: a highlight that stays visible still stays.

Apple's guidance is to replace movement with a crossfade, not to snap it: so a second block at the end of `styles.css`
(after every rule it overrides) gives what appears or goes a fade of `--_t-calm` (`lab-fade` in, `lab-gone` out) and no
translate or scale: cards, sheets, the new-comment box, a message arriving, the ⋯ menu (a popover on a computer fades in by
transition and out by the `.out` class), and the bar and the pill, which fade where they are as a sheet
opens instead of sliding under the screen. A card or sheet that closes fades out (`goOut` in `comments.js`, `slideAway`
in `sheets.ts` on a phone); code reads it as `ms('calm')`. The board view fades in (`overlay.ts`; its opacity is `!important`
in `:host`, so `--bv-o` is stepped per frame). The half / full toggle is one step. `test/browser/motionreduce.mjs` samples it frame by frame.

## Special cases (a token times a number)

| Where | Value | Why |
| --- | --- | --- |
| `.pin.arrive` (phones: a new pin pops in as the sent card slides down) | 1.25 × slow = 375 ms | the overshoot needs a little longer than a movement; lab option 5 |
| the pin's start delay (`comments.js`) | quick = 120 ms | it pops in as the card goes |
| `lab-halo` (one faint halo on a new comment's pin; the green ring on a sent pin) | 2.5 × slow = 750 ms | a slow breath out, longer than any movement |
| `lab-twitch` (the listening mark's ears) | 2 × loop = 2.4 s, second ear 1.5 × quick = 180 ms later | a twitch, then a long rest; the two ears not in step |
| the bar's fade when a sheet opens | delay quick / 3 = 40 ms | the sheet starts first |
| a transition's clean-up timer (`sheets.ts`, `settled()`) | slow + quick / 3 = 400 ms | the transition and a frame or two |
| the outline on a block named in a message (`goToBlock`) | 2 × hold = 2 s | you need time to find it |
| the sheet carried away by a swipe | its speed, between quick and slow | it follows the finger |
| the sent card has slid away (`leave`) | base + quick / 3 = 240 ms | after a send it starts a frame or two late |
| waiting for the page to go back after a sheet (`backFromReveal`) | slow | the sheet has gone |

## Every motion (after)

| Name | Property | Duration | Easing | For |
| --- | --- | --- | --- | --- |
| `.pin` | transform, opacity | quick | standard, out | a pin growing as you point at it (its green edge comes at once) |
| `lab-pin` (`.pin.in`) | transform | base | standard | a pin appearing with the card |
| `lab-arrive` (`.pin.arrive`) | opacity, transform | 1.25 × slow (delay quick) | pop | phones: the new pin pops in as the sent card goes |
| `lab-halo` (`button.pin.arrive::before`) | box-shadow (`--_halo` green) | 2.5 × slow (delay as the pin) | out | phones: one green ring leaves the sent pin |
| `lab-swap` (`.pin.swap`) | transform, opacity | base | standard | a pin's face changed (taken, done): a quiet change |
| `lab-gone` (`.ring.gone`) | opacity | slow | in | the agent's ring fading out |
| `lab-halo` | box-shadow | 2.5 × slow | standard | one faint halo from a new comment's pin |
| `lab-fade` (`.zone.live`, `.row .ask`, `.box.open .line/.who`) | opacity | quick | out | small things appearing |
| `lab-fade` (`.scrim`, `.hint`) | opacity | base | out | the dimmed page, the shortcut hint |
| `lab-turn` | transform | loop | linear, infinite | the agent's ring turning |
| `lab-draw` (`.ring.come`) | `--lab-arc` | slow | out | the green arc drawing itself in |
| `.ptr` | opacity, background | quick | out | the drawn pointer's look |
| `.ptr span` | opacity, transform | quick | out | the same, its label |
| `lab-in` (`.card.in`, `.float.in`, `.more-menu`, `.sw-box`) | translate, scale | base | standard | a card, the new-comment box, the ⋯ menu or ⌘K appearing |
| `lab-out` (`.card.out`, `.float.out`, `.more-menu.out`, `.sw-box.out`, `.hint.out`) | opacity, translate, scale | quick | in | one exit: a card leaving (also at once on a computer), the ⋯ menu, ⌘K and the hint (`goOut` in comments.js) |
| `.row` buttons, `.box`, `kbd` | color, box-shadow, opacity | quick | out | hover and focus |
| `.send` | background, color; transform | quick | out; standard | the send button (grows to 103% on hover, as a pin does) |
| `.bar button` | color; transform | quick | out; standard | the bar's buttons |
| `lab-ready` (`.send.ready`) | transform | quick | out | a small pulse when sending is possible |
| `lab-in` (`.fresh`) | translate, scale | base | standard | a message arriving, as a card does |
| `lab-fly` (`.send.sent .arr`) | transform, opacity | slow | standard | the arrow leaving and coming back |
| `lab-twitch` | transform | 2 × loop | ease-in-out, infinite | the listening mark's ears |
| `.gp` | background, color | quick | out | the pin's glyph in the bar (every colour change is quick) |
| `.bar` | transform; opacity | slow; base | settle; out | the bar coming back as a sheet goes |
| `[data-sheet] .bar` | transform; opacity | base; base (delay quick / 3) | in; out | the bar stepping down |
| `.chatwin, .card` | height | slow | settle | a comment pulling up to full height |
| `lab-card-in` | transform, opacity | slow | standard | phones: a sheet grows out of what was tapped |
| `leave()` (sheets.ts) | transform, opacity | base (tap, send) / by speed (swipe) | in / starts at the release speed (`carry`) | the sheet leaving: shrinks into its pin after a tap, slides down whole after a send |
| `slideAway()` (sheets.ts) | the bar | as `leave` | the sheet's pace after a swipe, settle's shape from rest after a tap (`glide`); out | the bar coming up as the sheet goes |
| drag release (sheets.ts) | transform, height; scrim opacity | slow at most, shorter for a quick throw | settle's shape, built to start at the release speed (`glide`); out | a sheet springing back or to its other height |
| keyboard fit (sheets.ts) | transform | slow | settle | the sheet moving over the keyboard |
| composer glide (`composer.ts`) | height; the arrow's transform | base | standard | the box growing, the arrow sliding |
| `.pane` (the dialog's insides) | opacity | quick out; base in after base | out | one pane fading for the other |
| shake (`comments.js`) | transform | base | standard | unsent words: the card (⌥W) or the sheet (closing on a phone) won't close; one sideways shake for both |
| `goToBlock` (goto.ts) | outline (`--_green`) | 2 × hold | linear | a block named in a message |
| quote jump (`chat.ts`) | box-shadow (`--_green`) | hold | linear | the message you jumped to |

`lab.css` has no transitions or animations; it only defines the tokens.

## What changed (old → new)

Durations were about 25 different values between 0.12 s and 0.9 s. Quick and base are as the owner asked; slow is
**300 ms** (was 360, Leo 18 Nov): Material 3 keeps whole panels at 300–400 ms and iOS defaults to about 250 ms, so the
biggest movements sit at the short end of that range; the old 340–380 ms sheets get a little quicker.

| Where | Old | New |
| --- | --- | --- |
| hover and colour transitions (pin, ptr, send, bar buttons, rows, box shadow, kbd) | 150 or 160 ms (the pointer's opacity 120) | 120 ms |
| `lab-fade` on `.row .ask`, `.zone.live`, `.more-menu`, `.sw-box` | 120 ms | 120 ms (same) |
| `lab-fade` on `.box.open .line/.who` | 160 ms | 120 ms |
| `lab-fade` on the dimmed page | 220 ms | 200 ms |
| `lab-fade` on the hint | 200 ms | 200 ms (same) |
| `lab-out` | 140 ms | 120 ms |
| `lab-ready` | 160 ms | 120 ms |
| ring states (crossfade), tip, progress line | 300 / 120 / 200 ms | slow / quick / base, out curve |
| `lab-in` | 180 ms | 200 ms |
| `lab-pin` | 260 ms | 200 ms |
| `lab-rise`, `.gp` colour | 200 ms | 200 ms (same) |
| `lab-gone` | 300 ms | 300 ms |
| `lab-fly` | 320 ms | 300 ms |
| `lab-swap` | 240 ms, standard curve | 200 ms, standard curve |
| `lab-draw` | 400 ms | 300 ms |
| `lab-arrive` | 460 ms, delay 130 ms | 375 ms, delay 120 ms |
| sent pin's green ring (`lab-halo`) | 700 ms, ease-out | 750 ms, out |
| `lab-halo` | 900 ms, curve .2, .7, .3, 1 | 750 ms, standard curve |
| `lab-card-in` | 300 ms, curve .2, .9, .25, 1 | 300 ms, standard curve |
| `.bar` (transform / opacity) | 340 ms / 200 ms | 300 ms / 200 ms |
| `[data-sheet] .bar` | 240 ms, curve .4, 0, 1, 1; opacity 200 ms, delay 40 ms | 200 ms, in curve; opacity 200 ms, delay 40 ms |
| `.chatwin, .card` height | 380 ms | 300 ms |
| `leave()` shrink | 200 ms, curve .4, 0, .9, .4 | 200 ms, in curve (.4, 0, 1, 1) |
| `leave()` after a send (slides down) | 240 ms, curve .4, 0, 1, 1 (timer 280) | 200 ms, in curve (timer 240) |
| swipe away: limits | 140 to 320 ms | 120 to 300 ms |
| `slideAway` bar | curve .2, .6, .4, 1; opacity linear | standard; opacity out |
| sheet spring back (transform/height) | 380 ms | 300 ms |
| sheet spring back (dimmed page) | 300 ms, ease | 300 ms, out |
| keyboard fit | 340 ms (timer 360) | 300 ms (timer 400) |
| timers clearing a spring (`setTimeout`) | 400 ms | 400 ms (slow + quick / 3) |
| wait before the page goes back after a sheet | 320 ms | 300 ms |
| composer glide | 220 ms, curve .2, .7, .3, 1 | 200 ms, standard |
| `closeFast` fade | 120 ms, ease-out | 120 ms, out (same) |
| shake and nudge | 260 ms | 200 ms |
| quote jump flash | 900 ms | 1000 ms |
| `goToBlock` outline | 2000 ms | 2000 ms (same) |
| transitions with no curve written (CSS default `ease`) | ease | out |
| second ear of the twitch | 180 ms later | 180 ms later (same) |

Reduced motion, differences: before, `animation: none` left the agent's ring visible after its fade-out (`.ring.gone`);
now the 0 ms animation ends where it fades to, so it is gone. The shake and the nudge now stop too (the old rule did not
reach Web Animations). The highlights (outline, quote flash) stay, as before.
