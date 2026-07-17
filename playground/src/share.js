// Share the editor buffer through the URL: deflate-raw + base64url in the
// location hash. Native browser APIs only — no dependencies. The hash keeps
// the payload off the server (never sent in the request) and out of access
// logs. A hash that fails to decode is silently ignored.

async function pipe(stream, bytes) {
  const writer = stream.writable.getWriter();
  // The error of a malformed input surfaces on the readable side; swallow the
  // writable-side rejection so it never becomes an unhandled rejection.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const deflate = (bytes) => pipe(new CompressionStream("deflate-raw"), bytes);
const inflate = (bytes) => pipe(new DecompressionStream("deflate-raw"), bytes);

function toBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encodeSource(source) {
  return toBase64Url(await deflate(new TextEncoder().encode(source)));
}

export async function decodeSource(packed) {
  // fatal: reject bytes that are not valid UTF-8 so a corrupt payload throws
  // (and falls back to the default source) instead of decoding to U+FFFD.
  return new TextDecoder("utf-8", { fatal: true }).decode(await inflate(fromBase64Url(packed)));
}

// The shared source encoded in the current location hash, or null when the
// hash is empty or cannot be decoded.
export async function sharedSourceFromHash() {
  const packed = location.hash.replace(/^#/, "");
  if (!packed) return null;
  try {
    return await decodeSource(packed);
  } catch {
    return null;
  }
}

export function shareUrl(packed) {
  const url = new URL(location.href);
  url.hash = packed;
  return url.toString();
}
