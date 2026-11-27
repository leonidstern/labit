# Task: find what each comment points at

People pinned 30 comments on five pages of a small website. You get the comments the way an agent gets them from labit: as plain text. For every comment, find exactly what it points at in the source.

## What you have

- **The comments**: `bench/results/situations-agent-text.txt`. One part per page, each starting with `===== <agent link> =====`. Every comment is a block that starts with `## <number>. <name> · <time> · id <id>` and has a `comment:` line.
- **The website's source**: `bench/situations/`. The page `/sit/<name>` is the file `bench/situations/<name>.html` (so `/sit/pricing` is `bench/situations/pricing.html`). Styles, scripts, data, code and media are in the same folder (`site.css`, `*.js`, `data/`, `src/`, `config/`, `media/`).

Work from these alone. You may read any file in `bench/situations/` and look at or measure the pictures and videos with tools on this machine (size, pixels, frames).

## What you must not do

- Do not read `bench/situations-truth.json`, `bench/situations.mjs`, `bench/score-situations.mjs`, `bench/situations-media.mjs` or `bench/situations-media.json`. They hold the answers.
- Do not read other files in `bench/results/`, and do not read `bench/README.md`.
- Do not open the pages in a browser, start a server, or call the comments API. The text and the files are all an agent has.
- Do not change any file except your answer file.

## The answer

Write one JSON file, `bench/results/situations-answer-<your model name>.json`: an array with **one entry per comment**, matched by the comment's text.

```json
[
  {
    "comment": "the comment text, exactly as in the agent text",
    "file": "pricing.html",
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

- `file`: path inside `bench/situations/`.
  - Text, a link, a form field, an SVG shape, any markup: the file where it is written, the place you would edit. If the words are put on the page by a script from a data file, that is the data file.
  - Code shown on the page from a file in the repo: that file, not the page.
  - A picture or video: the media file.
  - Something drawn by a script (a chart on a canvas): the file with the data for the thing pointed at.
- `line`: the line in `file`, counted from 1. For a comment on empty space between two things, the line where the thing before it ends or the thing after it starts. `null` for pictures and videos.
- `words`: for a comment on text, the word under the pin (the short phrase it belongs to is fine); for an area over text, the words inside the area and no more, as they read on the page. Otherwise `null`.
- `x`, `y`: for a picture or video, the spot in the pixels of the file you named (not of the screen). For an area, `x`, `y` is its top left corner and `x2`, `y2` its bottom right corner. Otherwise `null`.
- `seconds`: for a video, the time the comment is about.
- `color_scheme`: `"light"` or `"dark"` if the comment only makes sense in one of them and you can tell which; otherwise `null`.
- `what_is_there`: say what the thing is ("the Save button", "the second of two identical lines, the one in push()").
- `confidence`: `"high"`, `"medium"` or `"low"`. Use `"low"` when the text does not carry enough to be sure, and say what is missing in `what_is_there`.

Answer every comment, also the ones you are not sure about.

## Scoring

`node bench/score-situations.mjs <your answer file>` checks each entry: the file, the line, the words, the spot or area, the time. A comment counts only when all of its parts are right. (You must not run or read the scorer yourself; whoever gave you this task does.)
