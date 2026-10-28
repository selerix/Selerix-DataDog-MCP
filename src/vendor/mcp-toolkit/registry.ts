import { z } from "zod/v4";

export interface ToolEntry<TCategory extends string> {
  name: string;
  description: string;
  category: TCategory;
}

export interface RegistryConfig {
  /** Allowlist: only these categories are enabled. Takes precedence over `disabledCategories`. */
  enabledCategories?: string[] | null;
  /** Denylist: these categories are disabled. */
  disabledCategories?: string[] | null;
  /** Categories that are always enabled regardless of the lists (default: ["meta"]). */
  alwaysEnabled?: string[];
}

export class ToolRegistry<TCategory extends string = string> {
  private tools: ToolEntry<TCategory>[] = [];
  private alwaysEnabled: Set<string>;

  constructor(private cfg: RegistryConfig = {}) {
    this.alwaysEnabled = new Set(cfg.alwaysEnabled ?? ["meta"]);
  }

  register(name: string, description: string, category: TCategory): boolean {
    this.tools.push({ name, description, category });
    return this.isEnabled(category);
  }

  isEnabled(category: TCategory): boolean {
    if (this.alwaysEnabled.has(category)) return true;
    if (this.cfg.enabledCategories) {
      return this.cfg.enabledCategories.includes(category);
    }
    if (this.cfg.disabledCategories) {
      return !this.cfg.disabledCategories.includes(category);
    }
    return true;
  }

  list(): ToolEntry<TCategory>[] {
    return this.tools;
  }

  search(query: string, category?: string, limit = 20): ToolEntry<TCategory>[] {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

    // Selerix change: tools of disabled categories (DD_TOOLS / DD_DISABLE) are not discoverable.
    const scored = this.tools
      .filter((t) => this.isEnabled(t.category))
      .filter((t) => !category || t.category === category)
      .map((t) => {
        const haystack = `${t.name} ${t.description}`.toLowerCase();
        let score = 0;
        for (const tok of tokens) {
          if (t.name.toLowerCase().includes(tok)) score += 5;
          if (haystack.includes(tok)) score += 1;
        }
        return { tool: t, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((s) => s.tool);
  }

  summary(allCategories: readonly TCategory[]) {
    const byCategory = new Map<string, number>();
    for (const t of this.tools) {
      if (!this.isEnabled(t.category)) continue; // Selerix change: count only what is exposed
      byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + 1);
    }
    return {
      total: [...byCategory.values()].reduce((a, b) => a + b, 0), // Selerix change: enabled tools only
      enabledCategories: allCategories.filter((c) => this.isEnabled(c)),
      categoryBreakdown: Object.fromEntries(byCategory),
    };
  }
}

/**
 * Factory for the `search-tools` meta-tool schema + handler.
 * Pass the registry and the categories array; receive a `{schema, handler}` pair
 * that can be registered with `server.tool(name, description, schema.shape, handler)`.
 */
export function createSearchToolsMetaTool<TCategory extends string>(
  registry: ToolRegistry<TCategory>,
  categories: readonly TCategory[],
  hint = "Discover available tools by natural language query.",
) {
  const schema = z.object({
    query: z.string().describe(`Natural language query. ${hint}`),
    category: z.enum(categories as unknown as readonly [string, ...string[]]).optional()
      .describe("Restrict search to a specific category"),
    limit: z.coerce.number().optional().default(20).describe("Max results (default 20)"),
  });

  const handler = async (params: z.infer<typeof schema>) => {
    const matches = registry.search(params.query, params.category, params.limit);
    return {
      query: params.query,
      matchCount: matches.length,
      summary: registry.summary(categories),
      matches: matches.map((t) => ({ name: t.name, description: t.description, category: t.category })),
    };
  };

  return { schema, handler };
}

/**
 * Parse a comma-separated env var into a lowercase string array, or null when unset.
 * Used for `<PREFIX>_TOOLS` and `<PREFIX>_DISABLE` env vars.
 */
export function parseEnvList(raw: string | undefined): string[] | null {
  if (!raw) return null;
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
