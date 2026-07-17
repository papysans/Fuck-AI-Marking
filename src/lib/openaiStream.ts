import type { ProxyRequest } from "./types";

/**
 * Client-side streaming helper. Calls our /api/proxy, reads the SSE body,
 * extracts OpenAI-compatible delta tokens, and invokes onDelta for each chunk.
 * Resolves with the full concatenated text.
 */
export async function streamChat(
  req: ProxyRequest,
  opts: { onDelta?: (delta: string, full: string) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const res = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    let msg = `请求失败 (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  // SSE frames are separated by blank lines; a frame may hold multiple
  // `data:` lines. We buffer until we can split on double-newline.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex: number;
    while ((sepIndex = indexOfFrameEnd(buffer)) !== -1) {
      const frame = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex).replace(/^(\r?\n)+/, "");
      const delta = handleFrame(frame);
      if (delta) {
        full += delta;
        opts.onDelta?.(delta, full);
      }
    }
  }
  // flush any trailing frame
  const tail = handleFrame(buffer);
  if (tail) {
    full += tail;
    opts.onDelta?.(tail, full);
  }
  return full;
}

function indexOfFrameEnd(buf: string): number {
  const nn = buf.indexOf("\n\n");
  const rr = buf.indexOf("\r\n\r\n");
  if (nn === -1) return rr === -1 ? -1 : rr + 4;
  if (rr === -1) return nn + 2;
  return Math.min(nn + 2, rr + 4);
}

/** Parse one SSE frame → concatenated content delta (or "" ). */
function handleFrame(frame: string): string {
  let out = "";
  for (const line of frame.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (data === "" || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as {
        choices?: { delta?: { content?: string }; text?: string }[];
      };
      const choice = json.choices?.[0];
      const piece = choice?.delta?.content ?? choice?.text ?? "";
      if (piece) out += piece;
    } catch {
      // partial/non-JSON keep-alive line — ignore
    }
  }
  return out;
}
