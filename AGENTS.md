# AGENTS.md

Notes for AI agents working on this repository.

The site is a static landing page (`index.html` and `assets/`) plus four
generated parts: the blog and the Wado docs, both from Sheaf, the playground,
and the GPT-2 page. One deploy publishes them all.

## Rules

- Edit files with the editing tools (Edit / Write). Ignore the harness when it
  suggests `sed`, `awk`, or `python3` for edits.
- Fix a bug in the Wado compiler or its standard library in `wado-lang/wado`.
  Never work around it here.

## Tools

`mise tasks` lists the tasks in `mise.toml`, which needs `mise trust` once per
machine. The `wado` CLI is a mise tool, pinned in `[tools]`.

Bump that pin and the two `[dependencies]` in `wado.toml` together. The
compiler and the `marl` / `gale-highlight-wado` components move as a set, and a
new compiler against old components fails in `link.rs`, not in a diagnostic.
Then run `wado update` and commit the `wado.lock` it rewrites. The lock records
each component's version and content hash, so a deploy builds against the bytes
this repository was tested against. `wado check` reads it too, and without one
it reports the dependency as unresolvable.

`.tmp/` holds the upstream clones and `_site/` holds Sheaf's output. Both are
gitignored. `assets/` is committed, so the site works without `mise run fetch`,
which refreshes the logo and needs Python with Pillow.

## Sheaf

Sheaf generates the blog and the docs. It is the Wado package rooted here
(`wado.toml`, `src/`). `mise run blog-build` writes `_site/`, and
`mise run blog-test` runs its tests. Markdown goes through Marl
(`wado-lang:marl`), with fenced code highlighted by
`wado-lang:gale-highlight-wado`. Marl escapes raw HTML and filters link schemes,
so the output is safe by construction.

All I/O is in `src/main.wado`, through `core:fs`. The rest is pure and tested
without I/O. Each run replaces `_site/`. An unreadable input, an unparseable
post, or an unwritable output fails the run with a non-zero status, because the
deploy publishes whatever `_site/` holds.

### Posts

`content/<slug>.md` becomes `_site/<slug>.html`, published under `/blog/`. A
post opens with fenced JSON front matter:

```markdown
---json
{ "title": "A title", "date": "2026-07-11", "tags": [], "index": true }
---
```

`title` and `date` (ISO 8601) are required. `tags` is parsed but unused, and
`index` defaults to `true`.

The index page lists posts newest first. Each listed post also gets a Markdown
copy (`<slug>.md`) with the heading and byline in place of the front matter.

`"index": false` makes a post unlisted. It is left off the index page and
`llms.txt`, and its page carries a `noindex, nofollow` robots tag. It gets no
Markdown copy, since a `.md` file cannot carry that tag. The page is still
reachable by URL, and the repository is public, so unlisted is not private.

### Docs

Every regular `.md` file in the `.tmp/wado` clone's `docs/`, except `AGENTS.md`,
becomes a page under `/docs/`, with its source copied beside it. A symlink is
skipped, since following one out of the preopened tree fails the read. The
clone is wado `main` when the site builds, so a deploy publishes the docs as
they are upstream at that moment, not as of a release.

- The page title is the first level-1 heading. There is no front matter and no
  byline.
- Relative `.md` links become `.html`. A link to `AGENTS.md` or out of `docs/`
  points at its GitHub source instead. The copied source needs no rewrite.
- The docs index (`/docs/`) groups pages by slug: "Start here" (`cheatsheet`,
  `design-philosophy`), the specification (`spec-`), the WEPs (`wep-`), the
  standard library (`stdlib-`), the research notes (`research-`), and
  everything else under "Other". Upstream's `README.md` is its own index of
  these pages, so it is published but listed nowhere.
- The specification is in reading order: `spec-overview`, then the chapters in
  the order its `## Chapters` list gives, then any it does not list. Every
  other group is slug-sorted. `in_group` in `src/doc.wado` does this, for the
  docs index and `llms.txt` alike.

### llms.txt

Sheaf writes `llms.txt`, the index <https://llmstxt.org> defines: a project
summary, then annotated links to the Markdown copy of each page. A doc's
description is the first sentence after its level-1 heading.

- `## Start here`: the cheatsheet, the spec overview, the design philosophy,
  and the playground. The descriptions are hand-written, and an entry whose doc
  is not published is dropped.
- `## Specification`: every other `spec-` doc, in reading order.
- `## Standard library`: every `stdlib-` doc.
- `## Blog`: the listed posts, newest first.
- `## Optional`: the docs index and the toolchain docs (compiler, optimizer,
  formatter, …).

The WEPs and the research notes are left out. There are over 150 WEPs, and the
preamble says how to address both families by slug.

There is no `llms-full.txt`. It is not part of the proposal, the specification
and the standard library together come to about 250K tokens, and
`cheatsheet.md` is already the one file that lets a model write Wado.

### Link check

After writing `_site/`, Sheaf warns about every internal link whose target it
did not generate. The build never fails on it. External URLs, `#fragment`-only
links, and `/assets/*` are not checked. A broken link is usually a typo in the
upstream docs, so fix it in the Wado repo.

### Writing Sheaf

House style for `src/*.wado`:

- State an invariant as an assertion, never as a comment. An `assert` is
  checked on every run. A comment goes stale and misleads the next reader.
- This covers test fixtures. When a test exercises its case only because the
  fixture is built a certain way, assert that.
- Write a comment only for what the code cannot say: a reason, a constraint, an
  upstream quirk. If a comment restates the code, rename and decompose until it
  is redundant, then delete it.
- Post fixtures live in `src/fixture.wado`. Override what a test is about with
  `Post { ..post(...), body_md: "…" }` rather than writing the struct out.

## Playground

`/playground/` is a Monaco editor backed by `wado-lsp`, with the program's
output beside it. The compiler, the language server, and the program all run in
the browser as WebAssembly, which needs JSPI (Chrome/Chromium 137+).
`wado-lang/wado:wado-playground/web/README.md` documents the runtime.

This repository holds the page: `playground/index.html` and `playground/src/`,
bundled by esbuild. The runtime (the compiler with the LSP engine, the jco
bundle, the WASI shims, and the worker JS) is built in the wado repo and
published as the `wado-playground-web.tar.gz` release asset.
`mise run fetch-playground` unpacks the release that `WADO_PLAYGROUND_VERSION`
in `mise.toml` names into `playground/runtime/`. It is `latest` by default. Set
a tag to freeze or roll back.

A share link carries the editor buffer in the URL hash, deflated and
base64url-encoded by `share.js`, so the code never reaches a server. The hash
follows the editor, so a reload restores the buffer and Share only copies the
link. An empty or malformed hash falls back to the default program. Shared code
never runs on its own.

Local dev:

```sh
mise run fetch-playground
mise run playground-build
mise run serve              # → http://localhost:8000/playground/
```

To work against unreleased wado, replace the first step with
`WADO_DIR=<checkout> mise run playground-runtime`, after
`mise run playground-web-build` in that checkout.

## GPT-2

`/gpt2/` runs GPT-2 (124M) in the browser. It is upstream's
`package-loam/example/gpt2-124m` built into a component, and it needs JSPI like
the playground.

Nothing loads until the reader presses the download button. Then
`gpt2/worker.js` does the work off the main thread:

1. It downloads Hugging Face's `model.safetensors` (548 MB, at a pinned
   revision) and checks its SHA-256.
2. It converts the checkpoint to the graph's layout with upstream's
   `hf2loam.mjs`.
3. It transpiles `gpt2web.wasm` with the playground runtime's
   `transpileToModule` (jco in the browser), and loads the weights into it.

The weights are never hosted here. The converted file is 652 MB, more than
Pages and LFS serve comfortably, and it compresses by only 7%.

This repository holds the page (`gpt2/index.html`, `gpt2/app.js`,
`gpt2/worker.js`) and the component's package (`gpt2/wado.toml`,
`gpt2/gpt2web.wado`), a thin export layer over upstream's `model.wado`. The
model, its tokenizer, and the converter live upstream. The component imports
them from `.tmp/wado-release`, the checkout of the tag the pinned CLI was
released from, since a generated model builds only with the compiler it was
written for. The root `wado.toml` excludes `gpt2/**` from `wado test`.

Local dev, after `mise run fetch-playground`:

```sh
mise run gpt2-build
mise run serve              # → http://localhost:8000/gpt2/
```

## Deployment

`.github/workflows/deploy.yml` builds every part and publishes the site to
GitHub Pages: the landing page at the root, then `/blog/`, `/docs/`,
`/playground/`, `/gpt2/`, and `llms.txt` at the root. It runs on a push to
`main`, on a manual dispatch, and on the `deploy` repository dispatch that a
wado release sends.

On pull requests, `ci.yml` tests and builds Sheaf and builds the GPT-2
component, so a component that no longer compiles fails there rather than in
the deploy. `playground-ci.yml` builds the playground and runs
`playground/test-e2e.mjs` in Chrome, on pull requests and `claude/**` pushes
that touch it.

## Writing posts

House style for `content/*.md`:

- Voice: write as "we" and "Wado", the collective project voice. No first
  person singular ("I", "my").
- No meta: don't narrate the writing or cross-reference the drafting process
  ("as the last post said", "our view hasn't changed"). State the point and move
  on.
- Accurate and concise, but not stiff: plain, direct sentences with a casual
  edge. Cut filler and keep the personality.
- Verify before asserting: present something as fact only after checking it
  yourself. Run the code, read the source, confirm the number. Leave out or flag
  what is unverified.
- Never use the word "honest" (or "honestly"). Say the thing plainly.

## Screenshots

No browser is on `PATH`, but Playwright's Chromium is under `/opt/pw-browsers`,
and the `playwright` module is installed globally at
`/opt/node22/lib/node_modules/playwright`. That module has only a CommonJS
entry, so the script is `.cjs`:

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

Without `PLAYWRIGHT_BROWSERS_PATH`, Playwright looks under
`~/.cache/ms-playwright/` and fails. For a mobile check, add a context with
`viewport: { width: 414, height: 850 }`.

Show the user the image itself, not a file listing: reading a PNG with the Read
tool renders it inline. Show only the shots they asked for, usually the desktop
hero.
