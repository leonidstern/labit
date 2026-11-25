# Settings

labit works with no settings at all. When you want to change something, write it in a settings file instead of
adding flags every time.

## Two files

| File | Where | For |
| --- | --- | --- |
| `labit.json` | your project's folder (or any folder above where you run labit) | the project: commit it, and everyone working on it gets the same lab |
| `settings.json` | `~/.config/labit/settings.json` | you: your name, your model, your keys, on every project |

Both are plain JSON. A file only fills in what you didn't say on the command line, so for each setting the first of
these that has it wins:

1. a flag, like `--port 4500`
2. an environment variable, like `PORT=4500`
3. the project's `labit.json`
4. your own `settings.json`
5. the default

To see what's in force and where each value came from:

```sh
npx @leonidstern/labit settings
```

```text
port                       4700                  labit.json
name                       Leo                   your settings
shortcuts                  chat x                labit.json
archiveAfterDays           30                    default
```

A setting labit doesn't know, or a value of the wrong kind, is named when the lab starts and left out; the rest still
counts. `labit settings` exits with an error while there's such a problem.

## Examples

`labit.json` in a project:

```json
{
  "port": 4500,
  "proxy": "3000",
  "batchSeconds": 1,
  "shortcuts": { "chat": "x" }
}
```

Your `~/.config/labit/settings.json`:

```json
{
  "name": "Leo",
  "model": "Sonnet 5.5",
  "open": false,
  "shortcuts": { "toggle": "h" }
}
```

## All settings

| Setting | Default | Also | What it does | In |
| --- | --- | --- | --- | --- |
| `port` | `4400` | `--port`, `PORT` | The first port to try. A taken one moves the lab to the next free port, up to 20 further. | both |
| `proxy` | find it | `--proxy` | Your dev server, as a port (`"3000"`) or an address. Without it labit finds the one running in the project. | project |
| `folder` | `.` | the folder after `labit` | What to serve, from the project's folder: `"dist"`, `"site"`. | project |
| `open` | `true` | `--no-open` | Open the page in your browser when the lab starts. | both |
| `wifi` | `false` | `--wifi` | Let phones and laptops on your wifi comment too. Each device still needs a one-time link from `labit invite`, which also turns wifi on in a lab that runs without it. | yours |
| `batchSeconds` | `2` | `LAB_SETTLE_MS` | How long the lab collects pins before handing them to your agent, so pins made one after another arrive together. `0` hands each one over at once. | both |
| `stopListeningAfterMinutes` | `60` | `LAB_CLOSE_GRACE` (seconds) | With every page closed this long, a listening agent stops. | both |
| `remindAfterMinutes` | `3` | `LAB_REMIND_MS` | A pin handed to your agent with no answer after this long is handed to it again. | both |
| `archiveAfterDays` | `30` | | Done threads with nothing new for this long move to `.lab/archive/` when the lab starts. | both |
| `updateCheck` | `true` | `LABIT_NO_UPDATE_CHECK=1` | Say when a newer labit is out (checked at most once a day). | both |
| `name` | none | | Your name on pins. The page asks once and keeps it here. | yours |
| `model` | none | `--model`, `LAB_MODEL` | The model your agent runs on, shown on the page: "talking to Claude · Sonnet 5.5". | yours |
| `pagesFolder` | `~/lab-pages` | | The one lab for pages that belong to no project (tries, demos, options). Agents add a page there, in a folder named for its topic, instead of starting a new lab. | yours |
| `shortcuts` | below | | Keys for the page. | both |
| `actions` | seeded once | | The one list of actions: the chips of the comment box, in order. See **Actions** below. | both |

"Project" settings belong to a project, so they're only read from `labit.json`; "yours" only from your own file (a
project you clone can't rename you or open your lab to the network); "both" from either, the project's first.

## Actions

The actions are one ordered list, `actions`, in the project's `labit.json` (for everyone on the project; wins) or in
your own `~/.config/labit/settings.json`. The page has no editor for it: edit the file, then restart the lab (a lab reads
settings when it starts). Each action has a `name` (the chip, 7
characters at most) and a `prompt` (the full text your agent gets):

```json
{
  "actions": [
    { "name": "go", "prompt": "Go ahead: do what is proposed here." },
    { "name": "more", "prompt": "Go further: show more options on this." },
    { "name": "no", "prompt": "No: do not do this; leave it as it was." }
  ]
}
```

- **Where:** the comment box on a spot or an area shows as many as fit on one line as chips, in order. The
  ones that don't fit are not shown (there is no overflow menu), so put the ones you use most first.
- **What is sent:** a chip sends at once, as `<name>: <what you typed>` (just the name with nothing typed); your agent
  reads the full prompt for that name as `action: …`.
- **Seeded:** with no list in either file, the first lab you start writes labit's own (above, plus any
  `{ "label", "send" }` buttons you had) into your settings.json, so there is a list to edit; from then on it is
  yours. A list in the project's `labit.json` wins over it. `labit settings` lists the actions in force.
- **Checked:** a name over 7 characters, a repeat or an item without a name and a prompt (300 characters at most) is
  said when labit starts and left out; the rest still counts.
- On selected words the row stays **rewrite · cut · go**. ⌥ + 1 to 4 run the chips in the order they show.

## Shortcuts

Each key is one letter or digit. You only list the ones you change; the others keep their default. A project's keys
win over yours, key by key.

| Action | Default | Does |
| --- | --- | --- |
| `toggle` | `m` | Show or hide comments |
| `chat` | `t` | Open the chat |
| `next` | `w` | The next new comment (with Shift: the one before) |
| `pause` | `p` | Pause the page's videos and animations, or play what was paused (each one also has its own menu: right-click it on a computer, ⋯ → motion on a phone) |
| `slow` | `s` | Play the page's videos and animations at ¼ speed, or back at full speed (the speed row in a thing's own menu, ¼ ½ 1, sets only it); a pin made while paused carries the moment in ms |
| `draw` | `d` | Held while you drag: draw a comment (a circle, an arrow, an underline…); the agent is told what it reads as |
| `done` | `e` | Tapped: hide or show done threads (shown, faded, at first). With a thread open it resolves it, as `resolve` does |
| `reply` | `r` | With a thread open: type a reply |
| `resolve` | `e` | With a thread open: resolve or reopen it |
| `walkie` | `k` | Walkie-talkie: talk while you point (your computer's own dictation types the words); ⌘↵ sends the walk to the chat, Esc drops it |

Letters follow the key's place on non-Latin layouts (the T key is T in Russian too), and digits work with Shift or
on AZERTY. The page shows your keys: the chat button reads "chat (x)" when `chat` is `x`.

## Not settings

- **Per run, flags only:** `--new`, `--all`, `--pages`, `--timeout`, `--resolve`, `--done`, `--on-it`, `--question`, `--wait`, `--page`, `--dir`.
- **Set by agents:** `LAB_AGENT`, `LAB_AGENT_NAME`, `LAB_SESSION_NAME` and the agents' own session ids.
- **For tests:** `LABIT_HOME`, `LAB_TAB_TTL`.
