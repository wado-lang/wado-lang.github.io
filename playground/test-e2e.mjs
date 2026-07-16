// End-to-end smoke test for the /playground/ page: serves the repo root and
// drives a JSPI-capable Chromium through the full stack — Monaco up, LSP
// ready, run the default program, diagnostics on a type error, hover.
//
// Usage: node playground/test-e2e.mjs
// Requires a built page (playground-runtime + playground-build) and a
// Chromium/Chrome 137+ (CHROME_PATH overrides autodetection).

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "playground") + "/");
const { chromium } = require("playwright-core");

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const dir of [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers"]) {
    if (dir && existsSync(dir)) {
      for (const d of readdirSync(dir)) {
        candidates.push(join(dir, d, "chrome-linux", "chrome"));
        candidates.push(join(dir, d, "chrome-linux", "headless_shell"));
      }
    }
  }
  const found = candidates.find(existsSync);
  if (!found) throw new Error("no Chromium found; set CHROME_PATH");
  return found;
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".png": "image/png",
  ".ttf": "font/ttf",
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const BROKEN = `use { println, Stdout } from "core:cli";

export fn run() with Stdout {
    let x: u32 = "oops";
    println("hi");
}
`;

let failed = 0;
const check = (name, pass, detail) => {
  console.log(`${pass ? "✅" : "❌"} ${name}: ${detail}`);
  if (!pass) failed++;
};

const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("[console.error]", m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/playground/`, { waitUntil: "load" });

  const status = () => page.evaluate(() => document.getElementById("status").textContent);
  const output = () => page.evaluate(() => globalThis.__playground.output());

  await page
    .waitForFunction(() => document.getElementById("status").textContent === "ready", null, { timeout: 120000 })
    .catch(() => {});
  check("language server ready", (await status()) === "ready", `status=${await status()}`);

  await page.click("#run");
  await page
    .waitForFunction(() => globalThis.__playground.output().includes("Hello, world!"), null, { timeout: 180000 })
    .catch(() => {});
  check(
    "run default program",
    (await output()).includes("Hello, world!"),
    `output=${JSON.stringify(await output())} status=${await status()}`,
  );

  await page.evaluate((source) => globalThis.__playground.editor.setValue(source), BROKEN);
  await page
    .waitForFunction(() => globalThis.__playground.monaco.editor.getModelMarkers({}).length > 0, null, {
      timeout: 60000,
    })
    .catch(() => {});
  const markers = await page.evaluate(() =>
    globalThis.__playground.monaco.editor.getModelMarkers({}).map((m) => m.message),
  );
  check("diagnostics on type error", markers.length > 0, JSON.stringify(markers));

  const hover = await page.evaluate(async () => {
    const { editor } = globalThis.__playground;
    editor.setPosition({ lineNumber: 5, column: 6 });
    editor.trigger("test", "editor.action.showHover", {});
    await new Promise((r) => setTimeout(r, 2500));
    return document.querySelector(".monaco-hover-content")?.textContent ?? null;
  });
  check("hover on println", Boolean(hover?.includes("println")), JSON.stringify(hover?.slice(0, 120) ?? null));

  const example = await page.evaluate(async () => {
    const select = document.getElementById("examples");
    const name = "fizzbuzz.wado";
    select.value = name;
    select.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 100));
    return {
      options: select.options.length,
      name,
      loaded: globalThis.__playground.editor.getValue().includes("FizzBuzz"),
    };
  });
  check(
    "load an example",
    example.options > 1 && example.loaded,
    `${example.options - 1} examples, ${example.name} loaded=${example.loaded}`,
  );
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
