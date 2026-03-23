DISCLAIMER: For transparency's sake (mainly because I don't want to take unfair credit for stuff): the research and testing here was done by me (as you can see on www.f4mi.com on the video where we talk about this), I did end up using local LLMs to help me with building the websites based on that research and cleaning up/helping me with docs/pushing some stuff to GitHub, as I said in the video I don't know shit and I am pretty much learning on the fly. Some of them for some reason (which I mean, isn't that mysterious if you consider how the sausage is made) think they are Claude. So if you see Claude mentions here, that's why lol

# takingnotes.ink

Drawing and animation studio for the Huion X10 and the Wacom Slate/Spark series of smart notebooks that runs in the browser. Built with React, TypeScript, and Vite.

Wacom SmartPad support in this project was informed by the [tuhi project](https://github.com/tuhiproject/tuhi).

Supports layered canvas editing, animation timeline with playback/export, and pen tablet input via Web Bluetooth and WebHID.

## Quick Start

```sh
npm install
npm run dev
```

Requires Node.js 20+. Dev server runs at `localhost:3000`.

## Build

```sh
npm run build    # production build → dist/
npm run preview  # serve the build locally
```

## Deploy To Cloudflare

This app is a static Vite build, so the simplest hosting target is Cloudflare Pages.

### Option 1: Cloudflare dashboard

1. Push this repo to GitHub.
2. In Cloudflare, go to Workers & Pages -> Create -> Pages -> Connect to Git.
3. Select this repository.
4. Use these build settings:

```txt
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Node.js version: 20
```

5. Deploy.

### Option 2: Wrangler CLI

```sh
npm install
npm run build
npm run cf:deploy
```

If Wrangler asks you to authenticate, run:

```sh
npx wrangler login
```

The repository already includes a `wrangler.toml` with:

```toml
pages_build_output_dir = "./dist"
```

To avoid Cloudflare Pages using Node 22 for this repo, keep the Pages project Node.js version pinned to `20`. The repo also includes a `.nvmrc` file for the same reason.

### Custom domain

After the first deploy, open your Cloudflare Pages project, go to Custom domains, and attach `takingnotes.ink` or any other domain you want to use.

### Browser API note

Web Bluetooth and WebHID need HTTPS in Chrome or Edge. Cloudflare Pages serves over HTTPS by default, so hosting there satisfies that requirement.

## Tablet Support

Pen tablet features (Huion, Wacom) require Chrome or Edge and an HTTPS connection.

## What works
Drawing live from both Wacom and Huion smart notebooks, downloading from Huion ones

## Todo
Fix small UI bugs, re-implement Wacom memory download
