// The GPT-2 page: nothing loads until the reader asks for the model, and then
// `worker.js` does the downloading, converting and generating off the main
// thread while this file reports its progress.

const $ = (id) => document.getElementById(id);
const loadButton = $("load");
const progress = $("progress");
const loadStatus = $("load-status");
const promptBox = $("prompt");
const generateButton = $("generate");
const stopButton = $("stop");
const stepsBox = $("steps");
const genStatus = $("gen-status");
const output = $("output");

const MB = 1e6;
const STAGES = {
  verify: "Checking the download's SHA-256…",
  convert: "Converting the checkpoint to the graph's layout…",
  load: "Loading the weights into the Wasm component…",
};

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let downloadStart = 0;
let prompt = "";

function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle("err", isError);
}

function showText(text) {
  const promptPart = document.createElement("span");
  promptPart.className = "prompt";
  promptPart.textContent = text.startsWith(prompt) ? prompt : "";
  output.replaceChildren(promptPart, text.slice(promptPart.textContent.length));
}

worker.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "progress":
      if (msg.stage === "download") {
        const seconds = (performance.now() - downloadStart) / 1000;
        progress.value = msg.done / msg.total;
        setStatus(
          loadStatus,
          `Downloading ${(msg.done / MB).toFixed(0)} / ${(msg.total / MB).toFixed(0)} MB` +
            ` (${(msg.done / MB / seconds).toFixed(1)} MB/s)`,
        );
      } else {
        progress.removeAttribute("value");
        setStatus(loadStatus, STAGES[msg.stage]);
      }
      break;
    case "ready":
      progress.hidden = true;
      setStatus(loadStatus, `Ready in ${((performance.now() - downloadStart) / 1000).toFixed(0)} s. The model reads up to ${msg.positions} tokens.`);
      generateButton.disabled = false;
      break;
    case "text":
      showText(msg.text);
      setStatus(genStatus, `${msg.tokens} token${msg.tokens === 1 ? "" : "s"} · the last took ${(msg.ms / 1000).toFixed(1)} s`);
      break;
    case "done":
      generateButton.disabled = false;
      stopButton.disabled = true;
      break;
    case "error":
      if (generateButton.disabled && stopButton.disabled) {
        progress.hidden = true;
        setStatus(loadStatus, msg.text, true);
        loadButton.disabled = false;
      } else {
        setStatus(genStatus, msg.text, true);
        generateButton.disabled = false;
        stopButton.disabled = true;
      }
      break;
  }
};

loadButton.addEventListener("click", () => {
  loadButton.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  downloadStart = performance.now();
  setStatus(loadStatus, "Starting the download…");
  worker.postMessage({ type: "load" });
});

generateButton.addEventListener("click", () => {
  prompt = promptBox.value;
  generateButton.disabled = true;
  stopButton.disabled = false;
  output.textContent = prompt;
  setStatus(genStatus, "Picking the first token…");
  worker.postMessage({ type: "generate", prompt, steps: Number(stepsBox.value) });
});

stopButton.addEventListener("click", () => {
  stopButton.disabled = true;
  setStatus(genStatus, "Stopping after this token…");
  worker.postMessage({ type: "stop" });
});

if (typeof WebAssembly.Suspending !== "function") {
  $("banner").hidden = false;
  loadButton.disabled = true;
}
