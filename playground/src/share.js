async function pipe(stream, bytes) {
  const writer = stream.writable.getWriter();
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
  return new TextDecoder("utf-8", { fatal: true }).decode(await inflate(fromBase64Url(packed)));
}

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
