# colabit

Your own lab for the people you work with: one lab address, a path per person (`lab.yourstudio.com/anna/…` shows Anna's site), and labit's pins and comment threads on every page. No agent: people pin a comment on a spot under a name they type and reply in its thread; you, and each person on their own pages, resolve or delete.

## 1. Deploy your colabit

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fleonidstern%2Flabit&root-directory=co&project-name=colabit&repository-name=colabit&env=LAB_COMMENTS_ADMIN_TOKEN&envDescription=Your%20admin%20key%3A%20a%20long%20random%20string&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%7D%5D)

The button copies labit into a repository of yours, makes a Vercel project from its `co` folder, adds an Upstash Redis store for the comments and asks for `LAB_COMMENTS_ADMIN_TOKEN`: a long random string, your admin key. Then give the project a domain (`lab.yourstudio.com`).

Nothing is built or installed on Vercel, and the `co` folder needs nothing outside it: the API and its few files are in `co/api`, with no dependencies, so a deploy is one function and a rewrite. **The widget updates itself**: `/_lab/co.js` is labit's own built file (`co/co.js` in labit's latest release, through jsDelivr), so a new widget reaches your colabit within minutes of a labit release, with no deploy. Changes merged between releases don't reach it. To stay on one version, change `@latest` in that rewrite in `co/vercel.json` to a release tag (`@v0.8.5`); to follow every merge, `@main`.

## 2. Add a person

In your copy of the repository:

```bash
node co/colabit.mjs add anna https://anna-site.vercel.app --lab https://lab.yourstudio.com
```

It adds `/anna` to `co/vercel.json` (two rewrites to Anna's site) and prints a prompt for Anna's agent: serve her site under the base path `/anna`, and one script tag in its root layout (`<lab>/_lab/co.js`, `data-site="lab"`).

**Fastest:** add `--deploy`. It commits the change and deploys the `co` folder straight from your computer with the Vercel CLI, live in seconds; push to git whenever you like, for history. It stops if anything else in `co/` isn't committed, so what goes live is always a commit, and Vercel lists each deploy with it (roll back from there). `node co/colabit.mjs deploy` deploys as it stands. Without `--deploy`: commit and push, and Vercel deploys from git.

`node co/colabit.mjs list` shows everyone, `remove anna` takes Anna out.

## 3. People comment

Anyone with a page's address clicks **comments** at the bottom right (or presses M), clicks a spot and types; the first comment asks their name. New comments are limited to `CO_PER_HOUR` (default 60) per address and hour. Your own link, `<lab>/<any page>#lab-admin=<LAB_COMMENTS_ADMIN_TOKEN>`, resolves and deletes everywhere.

## Try it on this computer

```bash
node co/dev.mjs
```

The lab on `localhost:4600` with an in-memory store and everyone in `co/vercel.json` proxied as on Vercel; with no one added yet, a demo site stands in as `/demo`. It prints your link and a guest's (on `127.0.0.1`, so two people in one browser).

## On a site without a lab path

The script also works on any site of yours as it is: the same script tag with `data-site="<site name>"` instead of `"lab"`. That site's comments are kept apart under its name, so its Vercel previews share production's.

## Beside a labit lab

When labit serves one of these sites on your computer, the lab's own widget is the one on the page: the lab takes colabit's tag out, and colabit's script stays off wherever it finds a lab's widget, so pins never split between the two. Each keeps its own pins; nothing is copied across.

## What it leaves out

Everything that works with an agent: the listening pill, agent status and rings, hand-offs, the agent's text, boards, actions, choices to try, the labs switcher and update. Pictures are left out too. Drawings are in (hold D and draw; the drawing goes as a pin when you lift), and so is motion: pause and slow-down from a right-click or ⋯ → motion, and a pin on a video or animation keeps its moment. There's no live stream: an open page picks up others' comments every 15 seconds and when you come back to the tab.
