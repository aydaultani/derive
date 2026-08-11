import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  buildPlaceQuery,
  describeShrinkingFilter,
  filterOpenNow,
  findShrinkingFilterCulprit,
} from "@/lib/query-builder";
import { DEFAULT_FILTERS, FiltersSchema, type Filters } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const SHRINK_POOL_THRESHOLD = 40;

/** Lets `?boroughs=brooklyn,queens` etc. round-trip through FiltersSchema. */
const QueryParamFiltersSchema = z.object({
  maxTravelMinutes: z
    .string()
    .transform((v) => (v === "any" ? "any" : Number(v)))
    .pipe(z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal("any")]))
    .optional(),
  boroughs: z
    .string()
    .transform((v) => (v.length === 0 ? [] : v.split(",")))
    .optional(),
  categories: z
    .string()
    .transform((v) => (v.length === 0 ? [] : v.split(",")))
    .optional(),
  rarityFloor: z.string().optional(),
  openNow: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  budget: z.string().optional(),
  indoorOnly: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  stepFreeOnly: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  timeOfDay: z.string().optional(),
});

function parseFiltersFromSearchParams(searchParams: URLSearchParams): unknown {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(QueryParamFiltersSchema.shape)) {
    const value = searchParams.get(key);
    if (value !== null) raw[key] = value;
  }
  const parsed = QueryParamFiltersSchema.safeParse(raw);
  if (!parsed.success) return raw;
  // Merge over defaults so a partial query string still yields a complete Filters.
  return { ...DEFAULT_FILTERS, ...parsed.data };
}

async function resolveFilters(request: NextRequest): Promise<Filters | null> {
  const { searchParams } = new URL(request.url);

  // No params at all: a bare preview request just means "the default pool".
  if (searchParams.size === 0) {
    try {
      const body: unknown = await request.json();
      const result = FiltersSchema.safeParse(body);
      if (result.success) return result.data;
    } catch {
      // no body, or not JSON — fine, treat as "no filters"
    }
    return DEFAULT_FILTERS;
  }

  const candidate = parseFiltersFromSearchParams(searchParams);
  const result = FiltersSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

export async function GET(request: NextRequest) {
  const filters = await resolveFilters(request);
  if (!filters) {
    return NextResponse.json(
      { error: "invalid_filters", message: "Could not parse filters from query params or body." },
      { status: 400 },
    );
  }

  const rows = await buildPlaceQuery(filters);
  const finalRows = filterOpenNow(rows, filters.openNow);
  const poolSize = finalRows.length;

  let warning: string | null = null;
  if (poolSize < SHRINK_POOL_THRESHOLD) {
    const unfilteredRows = await buildPlaceQuery(DEFAULT_FILTERS);
    const unfilteredPoolSize = unfilteredRows.length;
    const culprit = await findShrinkingFilterCulprit(filters);
    warning = culprit
      ? `${culprit.label} is cutting your pool to ${poolSize} places — relaxing just that would give you about ${culprit.poolSizeIfRelaxed}.`
      : describeShrinkingFilter(filters, poolSize, unfilteredPoolSize);
  }

  return NextResponse.json({ poolSize, warning });
}
