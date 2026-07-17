// Wado Playground page: Monaco editor (left) backed by wado-lsp, program
// stdout/stderr (right) from the runner worker. The runtime — wasm binaries,
// jco bundle, workers — is staged into ./runtime/ by `mise run
// playground-runtime` and consumed as-is; this bundle owns only the UI.

import * as monaco from "monaco-editor";
import { wadoLanguage, wadoLanguageConfiguration, wadoPaperTheme } from "./wado-monarch.js";
import { attachWadoLsp } from "./lsp-monaco.js";
import { encodeSource, sharedSourceFromHash, shareUrl } from "./share.js";

const RUNTIME = new URL("./runtime/", import.meta.url);

const DEFAULT_SOURCE = `#!/usr/bin/env wado run
// Hello World in Wado — edit and press Run (Ctrl/Cmd+Enter).

use { println, Stdout } from "core:cli";

export fn run() with Stdout {
    println("Hello, world!");
}
`;

const $ = (id) => document.getElementById(id);
const runButton = $("run");
const stopButton = $("stop");
const shareButton = $("share");
const statusEl = $("status");
const outputEl = $("output");

const jspiSupported = typeof WebAssembly.Suspending === "function";

self.MonacoEnvironment = {
  getWorker: () => new Worker(new URL("./editor.worker.js", import.meta.url), { type: "module" }),
};

monaco.languages.register({ id: "wado", extensions: [".wado"] });
monaco.languages.setMonarchTokensProvider("wado", wadoLanguage);
monaco.languages.setLanguageConfiguration("wado", wadoLanguageConfiguration);
monaco.editor.defineTheme("wado-paper", wadoPaperTheme);

const narrow = matchMedia("(max-width: 800px)");

const initialSource = (await sharedSourceFromHash()) ?? DEFAULT_SOURCE;

const editor = monaco.editor.create($("editor"), {
  value: initialSource,
  language: "wado",
  theme: "wado-paper",
  fontFamily: '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 14,
  minimap: { enabled: false },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  padding: { top: 12 },
  "semanticHighlighting.enabled": true,
  wordWrap: narrow.matches ? "on" : "off",
});

narrow.addEventListener("change", (e) => editor.updateOptions({ wordWrap: e.matches ? "on" : "off" }));

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function appendOutput(text, kind) {
  const span = document.createElement("span");
  span.className = kind;
  span.textContent = text;
  outputEl.appendChild(span);
  outputEl.scrollTop = outputEl.scrollHeight;
}

let runner = null;

function stopRun(message) {
  if (!runner) return;
  runner.terminate();
  runner = null;
  runButton.disabled = false;
  stopButton.disabled = true;
  if (message) {
    appendOutput(`${message}\n`, "err");
    setStatus("stopped");
  }
}

const PHASE_LABEL = { compiling: "compiling…", transpiling: "transpiling…", running: "running…" };

function run() {
  if (!jspiSupported || runner) return;
  outputEl.textContent = "";
  runButton.disabled = true;
  stopButton.disabled = false;
  setStatus("starting…");

  runner = new Worker(new URL("runner-worker.js", RUNTIME), { type: "module" });
  runner.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "status") setStatus(PHASE_LABEL[msg.phase] ?? msg.phase);
    else if (msg.type === "stdout") appendOutput(msg.text, "out");
    else if (msg.type === "stderr") appendOutput(msg.text, "err");
    else if (msg.type === "done") {
      stopRun();
      setStatus(`done in ${msg.ms} ms`);
      if (!outputEl.textContent) appendOutput("(no output)\n", "dim");
    } else if (msg.type === "error") {
      appendOutput(`${msg.text}\n`, "err");
      stopRun();
      setStatus("error", "err");
    }
  };
  runner.onerror = (e) => {
    appendOutput(`${e.message ?? "worker error"}\n`, "err");
    stopRun();
    setStatus("error", "err");
  };
  runner.postMessage({ type: "run", source: editor.getValue() });
}

runButton.addEventListener("click", run);
stopButton.addEventListener("click", () => stopRun("program stopped"));
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);

async function share() {
  const url = shareUrl(await encodeSource(editor.getValue()));
  history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url);
    setStatus("link copied to clipboard");
  } catch {
    setStatus("share link is in the address bar");
  }
}

shareButton.addEventListener("click", () => {
  share().catch((err) => {
    console.error(err);
    setStatus("could not build share link", "err");
  });
});

const examplesEl = $("examples");

async function loadExamples() {
  const resp = await fetch(new URL("examples.json", RUNTIME));
  if (!resp.ok) throw new Error(`examples.json: HTTP ${resp.status}`);
  const examples = await resp.json();
  if (!examples.length) return;
  for (const ex of examples) {
    const option = document.createElement("option");
    option.value = ex.name;
    option.textContent = ex.name;
    examplesEl.appendChild(option);
  }
  examplesEl.hidden = false;
  examplesEl.addEventListener("change", () => {
    const ex = examples.find((e) => e.name === examplesEl.value);
    if (ex) editor.setValue(ex.source);
  });
}

loadExamples().catch((err) => console.warn("examples unavailable:", err));

if (jspiSupported) {
  setStatus("starting language server…");
  attachWadoLsp(monaco, editor, RUNTIME)
    .then(() => setStatus("ready"))
    .catch((err) => {
      console.error(err);
      setStatus("language server failed to start", "err");
    });
} else {
  $("banner").hidden = false;
  runButton.disabled = true;
  setStatus("");
}

// Test hook: lets Playwright drive a run and read the state.
globalThis.__playground = { editor, run, share, output: () => outputEl.textContent, monaco };
