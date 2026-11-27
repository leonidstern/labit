You're writing a benchmark for labit, a tool where people leave comments on a live web page and a coding agent edits the page's files to do what they ask.

The question it answers: when a **designer** reviews a UI, is it better (more often right, faster, less noise) to **draw** on the page, or to **click and type** a short comment? Drawings are fast for things that are hard to say in words ("move this there", "these don't line up", "this is the wrong one").

Write two files in this folder:

## 1. `app.html`

One self-contained page (inline `<style>`, no external assets, no JS needed), about 150–220 lines. A small, realistic product screen: e.g. a team dashboard or settings page with a header, a sidebar or tabs, a few cards, a form, a table or list, buttons. Plain readable HTML and CSS: classes, no utility frameworks. Keep the layout fixed-width friendly at 1280×900 (everything important visible within ~1600px of page height).

Plant **12 design problems** a designer would catch, each in its own place, and each fixable with a small edit to this file. Mix:
- visual bugs: misaligned element, inconsistent spacing, wrong button style (one secondary that should be primary or vice versa), inconsistent corner radius, a color off-palette, text too small / wrong weight, an icon or badge in the wrong place
- layout asks: move an element to another spot, swap order, group things
- content: an element that should go, a missing element that should be there (e.g. a missing label or a missing action)

Do not mark the problems in the HTML (no comments saying "bug"). Each must be findable from the page itself by a careful designer.

## 2. `scenarios.json`

An array of 12 objects, one per problem:

```json
{
  "id": "short-kebab-id",
  "kind": "fix" | "outline",
  "problem": "what is wrong, plainly (for the grader, never shown to the agent)",
  "done_when": "what the fixed file must show, concretely, so a grader reading the diff can say yes/no",
  "mark": "x | strike | scribble | wavy | underline | circle | box | side | arrow | caret",
  "on": "a CSS selector (Playwright syntax ok, e.g. text=Save) for where the drawing goes",
  "to": "for arrow only: selector of where it points",
  "text": "the short comment a busy designer would type instead, clicking on the same element"
}
```

Rules:
- `mark` is the drawing a designer would naturally make for this problem. What each mark means to the agent: x/strike/scribble = remove; circle/box = something is wrong here, fix it; wavy = this is wrong; underline = rewrite these words; side = rework this block; arrow = move what it starts on to where it points; caret = add what's missing here. Use at least 7 different marks. At least 3 scenarios must be ones that are genuinely **hard to say in words** (kind "outline"): an arrow move, "this one doesn't match the others", "wrong one of several".
- `text` must sound like a real designer typing fast in a review: short, a bit vague, the way people actually write ("spacing off here", "make this primary", "this should be up top", "doesn't match"). Not a precise spec. 3–10 words.
- `on`/`to` selectors must match exactly one element in app.html.
- A drawing comes with no words at all: only the mark, where it is, and what's under it.

Write the files now. Then reply with one line.
