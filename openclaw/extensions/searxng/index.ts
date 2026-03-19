/**
 * OpenClaw SearXNG Plugin
 *
 * Provides a `searxng_search` tool that queries a self-hosted SearXNG instance.
 * Zero invasion of core OpenClaw code — works as a standard plugin extension.
 *
 * Configuration:
 *   plugins.entries.searxng.config.baseUrl = "http://your-searxng:8888/search"
 *   or env: SEARXNG_BASE_URL
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/searxng";

const DEFAULT_BASE_URL = "http://8.219.115.209:8888/search";
const DEFAULT_NUM_RESULTS = 10;
const MAX_NUM_RESULTS = 20;
const TIMEOUT_MS = 30_000;

type SearXNGResult = {
  title: string;
  url: string;
  content: string;
  engine: string;
  score: number;
  category: string;
  publishedDate?: string;
};

async function searxngSearch(params: {
  query: string;
  baseUrl: string;
  numResults?: number;
  language?: string;
  categories?: string;
  engines?: string;
  timeRange?: string;
}): Promise<SearXNGResult[]> {
  const url = new URL(params.baseUrl);
  url.searchParams.set("q", params.query);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", params.language ?? "auto");
  url.searchParams.set("categories", params.categories ?? "general");
  url.searchParams.set("safesearch", "0");

  if (params.engines) {
    url.searchParams.set("engines", params.engines);
  }
  if (params.timeRange) {
    url.searchParams.set("time_range", params.timeRange);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "OpenClaw-SearXNG-Plugin/1.0",
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`SearXNG returned HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as { results?: Record<string, unknown>[] };
    const results = data.results ?? [];
    const limit = Math.min(params.numResults ?? DEFAULT_NUM_RESULTS, MAX_NUM_RESULTS);

    return results.slice(0, limit).map((item) => ({
      title: String(item.title ?? ""),
      url: String(item.url ?? ""),
      content: String(item.content ?? ""),
      engine: String(item.engine ?? ""),
      score: Number(item.score ?? 0),
      category: String(item.category ?? ""),
      publishedDate: item.publishedDate ? String(item.publishedDate) : undefined,
    }));
  } finally {
    clearTimeout(timer);
  }
}

function formatResults(results: SearXNGResult[]): string {
  if (results.length === 0) {
    return "No results found.";
  }

  return results
    .map((r, i) => {
      const parts = [`${i + 1}. **${r.title}**`, `   URL: ${r.url}`];
      if (r.content) {
        parts.push(`   ${r.content}`);
      }
      if (r.engine) {
        parts.push(`   Source: ${r.engine}`);
      }
      if (r.publishedDate) {
        parts.push(`   Date: ${r.publishedDate}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");
}

const searxngPlugin = {
  id: "searxng",
  name: "SearXNG Search",
  description: "Privacy-friendly web search via self-hosted SearXNG instance",
  kind: "tool" as const,

  register(api: OpenClawPluginApi) {
    const pluginConfig = (api.pluginConfig ?? {}) as { baseUrl?: string };
    const baseUrl =
      pluginConfig.baseUrl ||
      process.env.SEARXNG_BASE_URL ||
      DEFAULT_BASE_URL;

    api.logger.info(`searxng: plugin registered (endpoint: ${baseUrl})`);

    api.registerTool(
      {
        name: "searxng_search",
        label: "SearXNG Search",
        description:
          "Search the internet using a self-hosted SearXNG instance. " +
          "Supports general web search, news, images, and videos. " +
          "Use this when you need to find information on the internet.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query keywords" }),
          num_results: Type.Optional(
            Type.Number({
              description: "Number of results to return (default: 10, max: 20)",
            }),
          ),
          language: Type.Optional(
            Type.String({
              description:
                'Search language code, e.g. "zh" for Chinese, "en" for English, "auto" for automatic (default: auto)',
            }),
          ),
          categories: Type.Optional(
            Type.String({
              description:
                'Search category: "general" (default), "news", "images", "videos"',
            }),
          ),
          engines: Type.Optional(
            Type.String({
              description:
                'Specific search engines to use, comma-separated (e.g. "google,bing"). Omit to use all.',
            }),
          ),
          time_range: Type.Optional(
            Type.String({
              description:
                'Time range filter: "day", "week", "month", "year"',
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const {
            query,
            num_results,
            language,
            categories,
            engines,
            time_range,
          } = params as {
            query: string;
            num_results?: number;
            language?: string;
            categories?: string;
            engines?: string;
            time_range?: string;
          };

          try {
            const results = await searxngSearch({
              query,
              baseUrl,
              numResults: num_results,
              language,
              categories,
              engines,
              timeRange: time_range,
            });

            const text = formatResults(results);

            return {
              content: [{ type: "text", text }],
              details: {
                count: results.length,
                query,
                categories: categories ?? "general",
                results: results.map((r) => ({
                  title: r.title,
                  url: r.url,
                  engine: r.engine,
                })),
              },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [
                { type: "text", text: `SearXNG search failed: ${message}` },
              ],
              isError: true,
            };
          }
        },
      },
      { name: "searxng_search" },
    );
  },
};

export default searxngPlugin;
