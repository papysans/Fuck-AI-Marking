import type { NextRequest } from "next/server";
import type { ProxyRequest } from "@/lib/types";

/**
 * Transparent streaming proxy to any OpenAI-compatible /chat/completions
 * endpoint. The browser holds the key (localStorage) and passes it per request;
 * this route forwards it upstream and pipes the SSE stream straight back.
 *
 * Security: the key is used only to build the upstream Authorization header.
 * It is never logged, never persisted, never echoed back in the response.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/, "");
  return `${b}${path}`;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: ProxyRequest;
  try {
    body = (await req.json()) as ProxyRequest;
  } catch {
    return jsonError(400, "请求体不是合法 JSON");
  }

  const { baseUrl, apiKey, model, messages, temperature, jsonMode } = body;
  if (!baseUrl || !apiKey || !model || !Array.isArray(messages) || messages.length === 0) {
    return jsonError(400, "缺少必要字段：baseUrl / apiKey / model / messages");
  }

  const upstreamUrl = joinUrl(baseUrl, "/chat/completions");
  const payload: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    temperature: temperature ?? 0,
  };
  if (jsonMode) {
    payload.response_format = { type: "json_object" };
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "上游请求失败";
    return jsonError(502, `连接上游失败：${msg}`);
  }

  if (!upstream.ok || !upstream.body) {
    // Surface upstream error text (may contain a provider message) without
    // leaking the key — the key is never part of the upstream response.
    const text = await safeText(upstream);
    return jsonError(upstream.status || 502, `上游返回错误 (${upstream.status})：${text}`);
  }

  // Pipe the upstream SSE stream straight through.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 500);
  } catch {
    return "(无法读取上游错误内容)";
  }
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
