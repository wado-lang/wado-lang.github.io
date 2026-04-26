# AGENTS.md

Operational notes for AI agents working on this repository.

The site is a single static `index.html` plus assets — no build step.

## mise tasks

Defined in `mise.toml`. The repo must be trusted once per machine
(`mise trust`).

| Task           | What it does                                                    |
| -------------- | --------------------------------------------------------------- |
| `mise run fetch` | Shallow-clones `wado-lang/wado` into `.tmp/wado` and copies `wado-512.png` / `wado-1024.png` into `assets/`. Re-run when the upstream logo changes. |
| `mise run serve` | Serves the site at <http://localhost:8000> via `python3 -m http.server`. Foreground process — Ctrl-C to stop. |
| `mise run clean` | Removes `.tmp/`.                                                |

`.tmp/` is gitignored; `assets/` is committed (the site must work without
running `fetch`).

## Taking screenshots

There is no headless browser in `PATH`, but Playwright's chromium
`headless_shell` binary is preinstalled at `/opt/pw-browsers` and the
`playwright` Node module is available globally at
`/opt/node22/lib/node_modules/playwright`.

Recipe — start the static server in the background, run a CommonJS script
that drives Playwright, then stop the server:

```sh
python3 -m http.server 8765 >/tmp/serve.log 2>&1 &
SERVE_PID=$!
sleep 1

cat > /tmp/snap.cjs <<'EOF'
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1100, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/wado-hero.png', fullPage: false });
  await page.screenshot({ path: '/tmp/wado-full.png', fullPage: true });
  await browser.close();
})();
EOF

PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node /tmp/snap.cjs
kill $SERVE_PID
```

Notes:

- Use `.cjs`, not `.mjs` — the global `playwright` package only exposes a
  CommonJS entry point.
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` is required; without it
  Playwright looks under `~/.cache/ms-playwright/` and fails.
- For mobile checks, open a second context with `viewport: { width: 414,
  height: 850 }`.

## Showing screenshots to the user

After capture, surface the PNGs to the user with the `Read` tool — Read
on a PNG path is rendered inline in the chat. `Bash` output (e.g. `ls`,
`file`) is not enough; the user only sees images that come back through
`Read`.

```
Read(/tmp/wado-hero.png)
```

When iterating on visual changes, show only what the user asked for
(usually just the desktop hero shot). Don't paste every viewport unless
asked.
