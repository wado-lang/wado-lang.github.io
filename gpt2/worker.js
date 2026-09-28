// Worker holding the model: downloads Hugging Face's checkpoint, converts it
// with upstream's `hf2loam.mjs`, loads it into the Wado component, and picks
// tokens one at a time, so the page stays responsive through all of it.
//
// Inbound: `{type:"load"}`, `{type:"generate", prompt, steps}`, `{type:"stop"}`.
// Outbound: `{type:"progress", stage, done?, total?}`, `{type:"ready",
// positions}`, `{type:"text", text, tokens, ms}`, `{type:"done"}`,
// `{type:"error", op, text}`, where `op` is the inbound type that failed.

import { transpileToModule } from "/playground/runtime/playground.js";
import { convert } from "./hf2loam.mjs";

// The revision gpt2-header.safetensors was generated from, and the SHA-256 and
// size Hugging Face reports for its model.safetensors (`x-linked-etag`,
// `x-linked-size`).
const CHECKPOINT = {
  url: "https://huggingface.co/openai-community/gpt2/resolve/607a30d783dfa663caf39e06633721c8d4cfcd7e/model.safetensors",
  sha256: "248dfc3911869ec493c76e65bf2fcf7f615828b0254c12b473182f0f81d3a707",
  bytes: 548105171,
};

const post = (msg) => postMessage(msg);
let api = null;
let stopRequested = false;

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function instantiate() {
  const moduleUrl = await transpileToModule(await fetchBytes("./gpt2web.wasm"), "gpt2web");
  try {
    // A library exports one interface, named after its package.
    return (await import(moduleUrl)).gpt2web;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

async function download() {
  const res = await fetch(CHECKPOINT.url);
  if (!res.ok) throw new Error(`Hugging Face answered HTTP ${res.status}`);
  const buf = new Uint8Array(CHECKPOINT.bytes);
  const reader = res.body.getReader();
  let done = 0;
  let reported = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    if (done + chunk.value.length > buf.length) throw new Error("the checkpoint is larger than expected");
    buf.set(chunk.value, done);
    done += chunk.value.length;
    const now = performance.now();
    if (now - reported > 100) {
      reported = now;
      post({ type: "progress", stage: "download", done, total: buf.length });
    }
  }
  if (done !== buf.length) throw new Error(`the download stopped at ${done} of ${buf.length} bytes`);
  post({ type: "progress", stage: "verify" });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== CHECKPOINT.sha256) throw new Error(`the checkpoint's SHA-256 is ${hex}, not ${CHECKPOINT.sha256}`);
  return buf;
}

async function load() {
  // The component transpiles while the checkpoint downloads.
  const [component, hf, header] = await Promise.all([
    instantiate(),
    download(),
    fetchBytes("./gpt2-header.safetensors"),
  ]);
  post({ type: "progress", stage: "convert" });
  const checkpoint = convert(hf, header);
  post({ type: "progress", stage: "load" });
  component.load(checkpoint);
  api = component;
  post({ type: "ready", positions: api.positions() });
}

// A zero-delay timeout hands the event loop a turn, so a `stop` message queued
// during a token lands before the next one starts.
const yieldToMessages = () => new Promise((resolve) => setTimeout(resolve, 0));

async function generate(prompt, steps) {
  const ids = Array.from(api.encode(prompt));
  if (ids.length === 0) throw new Error("the prompt encodes to no token");
  // The model reads at most `positions` tokens, and never the last one it picks.
  const room = api.positions() - ids.length + 1;
  if (room < 1) throw new Error(`the prompt is ${ids.length} tokens, and must be at most ${api.positions()}`);
  stopRequested = false;
  for (let i = 0; i < Math.min(steps, room); i++) {
    const t0 = performance.now();
    ids.push(api.nextToken(ids));
    post({ type: "text", text: api.decode(ids), tokens: i + 1, ms: performance.now() - t0 });
    await yieldToMessages();
    if (stopRequested) break;
  }
  post({ type: "done" });
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "stop") {
    stopRequested = true;
    return;
  }
  try {
    if (msg.type === "load") await load();
    else if (msg.type === "generate") await generate(msg.prompt, msg.steps);
  } catch (err) {
    post({ type: "error", op: msg.type, text: String(err?.payload ?? err?.message ?? err) });
  }
};
