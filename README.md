# takingnotes.ink

Drawing and animation studio that runs in the browser. Built with React, TypeScript, and Vite.

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

## Tablet Support

Pen tablet features (Huion, Wacom) require Chrome or Edge and an HTTPS connection.
