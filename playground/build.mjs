// Bundle the playground page: src/app.js (+ Monaco) → app.js/app.css, plus
// Monaco's editor worker. Outputs land in playground/ next to index.html and
// are gitignored; `mise run playground-build` runs this.

import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const common = {
  bundle: true,
  format: "esm",
  minify: true,
  logLevel: "info",
  loader: { ".ttf": "file" },
};

await build({
  ...common,
  entryPoints: [join(here, "src", "app.js")],
  outfile: join(here, "app.js"),
});

await build({
  ...common,
  entryPoints: [join(here, "node_modules", "monaco-editor", "esm", "vs", "editor", "editor.worker.js")],
  outfile: join(here, "editor.worker.js"),
});
