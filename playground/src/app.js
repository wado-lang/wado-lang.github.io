// Wado Playground page: Monaco editor (left) backed by wado-lsp, program
// stdout/stderr (right) from the runner worker. The runtime — wasm binaries,
// jco bundle, workers — is staged into ./runtime/ by `mise run
// playground-runtime` and consumed as-is; this bundle owns only the UI.

import * as monaco from "monaco-editor";
import { wadoLanguage, wadoLanguageConfiguration, wadoPaperTheme } from "./wado-monarch.js";
import { attachWadoLsp } from "./lsp-monaco.js";

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

const editor = monaco.editor.create($("editor"), {
  value: DEFAULT_SOURCE,
  language: "wado",
  theme: "wado-paper",
  fontFamily: '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 14,
  minimap: { enabled: false },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  padding: { top: 12 },
  "semanticHighlighting.enabled": true,
});

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
globalThis.__playground = { editor, run, output: () => outputEl.textContent, monaco };
