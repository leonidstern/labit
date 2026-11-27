# Task: find what each comment points at (second set)

People pinned 32 comments on seven pages of a small website. You get the comments the way an agent gets them from labit: as plain text. For every comment, find exactly what it points at in the source.

## What you have

- **The comments**: `bench/results/situations-2-agent-text.txt`. One part per page, each starting with `===== <agent link> =====`. Every comment is a block that starts with `## <number>. <name> · <time> · id <id>` and has a `comment:` line.
- **The website's source**: `bench/situations/`. The page `/sit/<name>` is the file `bench/situations/<name>.html` (so `/sit/b2-account` is `bench/situations/b2-account.html`). The seven pages of this set are the `b2-*.html` files. Their styles, scripts, strings, code and media are in the same folder (`site.css`, `b2.css`, `b2-*.js`, `locales/`, `src/`, `media/`). The other pages in the folder belong to another set; you may read them, the comments are not on them.

Work from these alone. You may read any file in `bench/situations/` and look at or measure the pictures and videos with tools on this machine (size, pixels, frames).

## What you must not do

- Do not read `bench/situations-2-truth.json`, `bench/situations-2.mjs`, `bench/situations-2-media.mjs`, `bench/situations-2-media.json` or `bench/situations-2-guide.mjs`. They hold the answers.
- Do not read `bench/situations-truth.json`, `bench/situations.mjs`, `bench/score-situations.mjs`, `bench/situations-media.mjs` or `bench/situations-media.json` either.
- Do not read any `bench/results/situations*-answer-*.json`, any other file in `bench/results/`, `bench/README.md`, or the git history of `bench/`.
- Do not open the pages in a browser, start a server, or call the comments API. The text and the files are all an agent has.
- Do not change any file except your answer file.

## The answer

Write one JSON file, `bench/results/situations-2-answer-<your model name>.json`: an array with **one entry per comment**, matched by the comment's text.

```json
[
  {
    "comment": "the comment text, exactly as in the agent text",
    "file": "b2-account.html",
    "line": 123,
    "words": "the words it points at",
    "x": null, "y": null, "x2": null, "y2": null,
    "seconds": null,
    "color_scheme": null,
    "what_is_there": "one sentence: what the comment is pointing at",
    "confidence": "high"
  }
]
```

- `file`: path inside `bench/situations/`. It is always the place you would edit to change what the person pointed at:
  - Text, a link, a form field, a list option, any markup: the file where it is written.
  - Words that are not written in the page itself: the file they come from. That can be a stylesheet (CSS `content`), a strings file a script reads, or the script of a component.
  - Code shown on the page from a file in the repo: that file, not the page. Also when the page shows it as a diff, as a part of the file, or folded.
  - A picture or video: the media file the person was looking at, however the page shows it (inside an SVG, as a CSS background, one of several sizes or crops).
- `line`: the line in `file`, counted from 1. For code shown from a repo file: the line in that file as it is now. For a comment on a folded part: any line of the hidden part. `null` for pictures and videos.
- `words`: for a comment on text, the word under the pin (the short phrase it belongs to is fine). In a language that writes no spaces between words, the word itself with at most a few characters around it. Otherwise `null`.
- `x`, `y`: for a picture or video, the spot in the pixels of the file you named (not of the screen). For an area, `x`, `y` is its top left corner and `x2`, `y2` its bottom right corner. Otherwise `null`.
- `seconds`: for a video, the time the comment is about, in seconds of the file. For an animated picture, the time in its loop.
- `color_scheme`: `"light"` or `"dark"` if the comment only makes sense in one of them and you can tell which; otherwise `null`.
- `what_is_there`: say what the thing is ("the Save button", "the second of two identical lines, the one in push()").
- `confidence`: `"high"`, `"medium"` or `"low"`. Use `"low"` when the text does not carry enough to be sure, and say what is missing in `what_is_there`.

Answer every comment, also the ones you are not sure about.

## Scoring

`node bench/score-situations.mjs <your answer file>` checks each entry: the file, the line, the words, the spot or area, the time. A comment counts only when all of its parts are right. (You must not run or read the scorer yourself; whoever gave you this task does.)
