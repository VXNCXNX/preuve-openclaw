import { randomUUID } from "node:crypto";
import { type Static, Type } from "@sinclair/typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { jsonResult } from "openclaw/plugin-sdk/tool-results";

export const API_BASE_URL = "https://preuve.ai";
const KEY_PREFIX = "prv_";

export type PluginConfig = { apiKey?: string };

export function readConfig(api: { config?: unknown }): PluginConfig {
  const root = api.config as
    | { plugins?: { entries?: Record<string, { config?: PluginConfig }> } }
    | undefined;
  return root?.plugins?.entries?.["preuve"]?.config ?? {};
}

function requireKey(cfg: PluginConfig): string {
  if (!cfg.apiKey) {
    throw new Error(
      "No Preuve API key configured. Set plugins.entries.preuve.config.apiKey. Create a key at https://preuve.ai/app?settings=apiKeys.",
    );
  }
  if (!cfg.apiKey.startsWith(KEY_PREFIX)) {
    throw new Error(`Preuve API keys start with "${KEY_PREFIX}". The configured value does not, so the API will reject it.`);
  }
  return cfg.apiKey;
}

type ApiError = { error?: string; code?: string };

export async function callPreuve(
  cfg: PluginConfig,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; query?: Record<string, string | undefined>; signal?: AbortSignal } = {},
): Promise<unknown> {
  const key = requireKey(cfg);
  const url = new URL(path, API_BASE_URL);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    method,
    headers: { "x-preuve-key": key, "content-type": "application/json", accept: "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (res.ok) return parsed;

  const { error, code } = (parsed ?? {}) as ApiError;
  const retryAfter = res.headers.get("Retry-After");
  const hint =
    res.status === 429
      ? ` Retry with the same clientRunId${retryAfter ? ` after ${retryAfter}s` : " after a short backoff"}.`
      : res.status === 409 && code === "ANALYSIS_NOT_COMPLETE"
        ? " Poll preuve_get_analysis until status is COMPLETED, then export again."
        : res.status === 402
          ? " A deep scan needs paid quota on the Preuve account; a starter scan costs nothing."
          : "";
  throw new Error(`Preuve API ${res.status} ${code ?? ""}: ${error ?? text}${hint}`.trim());
}

const ScanType = Type.Union([Type.Literal("starter"), Type.Literal("deep")], {
  description:
    "starter costs nothing and takes about a minute. deep spends the user's paid quota and takes about ten minutes: pass it only when the user explicitly asked for a deep or full report.",
});

const StartParams = Type.Object({
  idea: Type.String({
    minLength: 40,
    description: "The idea in the user's words: what it is, for whom, and how it makes money. Two to five sentences work best.",
  }),
  scanType: Type.Optional(ScanType),
  clientRunId: Type.Optional(
    Type.String({ description: "Your own id for this run, reused on retry. Generated when omitted." }),
  ),
  targetMarket: Type.Optional(Type.String({ description: "Who buys, e.g. independent coffee shops." })),
  targetCountry: Type.Optional(Type.String({ description: "ISO 3166-1 alpha-2 country code, e.g. US or FR." })),
  language: Type.Optional(Type.String({ description: "Report language, BCP 47 code. Defaults to en." })),
  publish: Type.Optional(
    Type.Boolean({ description: "Create a public share link. Only when the user explicitly wants one." }),
  ),
});

const IdParams = Type.Object({
  id: Type.String({ description: "The analysis id returned by preuve_start_analysis." }),
});

const ExportParams = Type.Object({
  id: Type.String({ description: "The analysis id returned by preuve_start_analysis." }),
  verbosity: Type.Optional(
    Type.Union([Type.Literal("summary"), Type.Literal("full")], {
      description: "summary by default. full only when the user wants the long-form sections.",
    }),
  ),
});

const IdeasParams = Type.Object({
  interests: Type.String({
    minLength: 3,
    maxLength: 500,
    description: "Interests, skills or domains to generate ideas from.",
  }),
  budget: Type.Optional(Type.String({ maxLength: 100, description: "Budget the founder can commit." })),
  audience: Type.Optional(Type.String({ maxLength: 200, description: "Who the ideas should serve." })),
});

export default definePluginEntry({
  id: "preuve",
  name: "Preuve AI",
  description: "Score startup ideas against live market evidence with Preuve AI.",
  register(api) {
    const cfg = () => readConfig(api);

    api.registerTool({
      name: "preuve_start_analysis",
      label: "Preuve AI: start an analysis",
      description:
        "Validate one startup or business idea against live market evidence (60+ sources). Async: returns an analysis id and status, then poll preuve_get_analysis every 10 to 30 seconds until status is COMPLETED, and read the report with preuve_export_analysis. scanType defaults to starter, which is free; deep spends the user's paid quota, so pass it only on an explicit request. clientRunId is the idempotency key: reuse the same value to retry safely, since a re-POST replays the existing run instead of starting a second one. Runs are private unless publish is true.",
      parameters: StartParams,
      async execute(_toolCallId, params, signal) {
        const p = params as Static<typeof StartParams>;
        const body = {
          ...p,
          scanType: p.scanType ?? "starter",
          clientRunId: p.clientRunId ?? `openclaw-${randomUUID()}`,
        };
        return jsonResult(await callPreuve(cfg(), "POST", "/api/agent/analyses", { body, signal }));
      },
    });

    api.registerTool({
      name: "preuve_get_analysis",
      label: "Preuve AI: poll an analysis",
      description:
        "Current state of an analysis started with preuve_start_analysis: status (QUEUED, RUNNING, COMPLETED, FAILED), readyForExport, and the report URL. Returns no report content; call preuve_export_analysis once readyForExport is true. Poll every 10 to 30 seconds.",
      parameters: IdParams,
      async execute(_toolCallId, params, signal) {
        const p = params as Static<typeof IdParams>;
        return jsonResult(
          await callPreuve(cfg(), "GET", `/api/agent/analyses/${encodeURIComponent(p.id)}`, { signal }),
        );
      },
    });

    api.registerTool({
      name: "preuve_export_analysis",
      label: "Preuve AI: export a report",
      description:
        "Structured JSON of a COMPLETED analysis: viability score and verdict, competitors, risks, market sizing, and source-linked citations. verbosity summary (the default) keeps every scored field and the verdict narrative and fits one tool result; full adds the section prose. A 409 ANALYSIS_NOT_COMPLETE means poll preuve_get_analysis and try again; the export never returns partial data.",
      parameters: ExportParams,
      async execute(_toolCallId, params, signal) {
        const p = params as Static<typeof ExportParams>;
        return jsonResult(
          await callPreuve(cfg(), "GET", `/api/agent/analyses/${encodeURIComponent(p.id)}/export`, {
            query: { verbosity: p.verbosity ?? "summary" },
            signal,
          }),
        );
      },
    });

    api.registerTool({
      name: "preuve_generate_ideas",
      label: "Preuve AI: generate startup ideas",
      description:
        "Generate startup ideas from the user's interests, skills, budget or audience. Synchronous and free of scan quota. Free accounts get 5 generations per rolling 24 hours (GENERATION_LIMIT when exhausted). Hand a promising idea to preuve_start_analysis to score it.",
      parameters: IdeasParams,
      async execute(_toolCallId, params, signal) {
        const p = params as Static<typeof IdeasParams>;
        return jsonResult(await callPreuve(cfg(), "POST", "/api/agent/tools/idea-generator", { body: p, signal }));
      },
    });
  },
});
