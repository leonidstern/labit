# co-labit

labit's pins and comment threads on your own deployed sites, for the people you invite. There's no lab and no agent: people pin a comment on a spot, reply in its thread, and you resolve or delete it.

- **One script tag per site.** `<script src="https://<your co-labit>.vercel.app/co.js" data-site="<site name>" defer></script>`. `data-site` keeps a site's comments together, so its Vercel previews share production's. Without it, the site's host is used.
- **Invite links.** A link carries one person's key: `https://yoursite.com/#co=<key>`. Opening it keeps the key in that browser, and the person comments under the name the link was made for. A browser without a key sees nothing at all, so visitors never see the widget. The key is per browser and per address: a preview URL needs its own link.
- **Your own link** (`--owner`) may also resolve, move and delete anyone's comments. Others may resolve or move only their own pins.

## Set up (once)

1. A Vercel project from this repo with **Root Directory `co`**. It builds `co.js` from the widget (`npm run build:co`) and serves `api/comments`.
2. An Upstash Redis store from the Vercel Marketplace, connected to the project (it sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`).
3. `CO_SECRET`: a long random string in the project's environment variables. It signs every invite key; changing it ends them all.

## Invite someone

```bash
CO_SECRET=… node co/invite.mjs "Anna" https://yoursite.com
CO_SECRET=… node co/invite.mjs "Leo" https://yoursite.com --owner
```

To take a key back, add the person's name to `CO_REVOKED` (comma separated) and redeploy.

## Try it on this computer

```bash
npm run build:co && node co/dev.mjs
```

It prints two links: yours on `localhost` and a guest's on `127.0.0.1` (two addresses, so two browsers' worth of keys in one browser). The store is in memory.

## What it leaves out

Everything that works with an agent: the listening pill, agent status and rings, hand-offs, "copy link" for an agent, actions, choices to try, boards, the labs switcher, the section bar and update. Drawings, pictures and the motion menu are left out too, which keeps it to one script. There's no live stream: an open page picks up others' comments every 15 seconds and when you come back to the tab.
