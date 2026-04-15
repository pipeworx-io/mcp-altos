interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Altos Research MCP — Real estate market intelligence
 *
 * BYO key: requires an Altos Research API key from https://altosresearch.com
 * Passed via _altosKey parameter.
 *
 * API returns gzipped CSV files. We decompress and parse them into structured data.
 * Dates must be Fridays — the helper lastFriday() finds the most recent one.
 *
 * Tools:
 * - altos_market_stats: aggregated market statistics for a region
 * - altos_inventory_trend: inventory trend over multiple weeks
 * - altos_active_listings: active listing-level data for a region
 * - altos_pending_sales: pending sales (under contract) for a region
 * - altos_new_listings: new listings (on market less than a week)
 * - altos_list_files: list available data files for a region
 */


// ── Helpers ────────────────────────────────────────────────────────────

function getAuth(apiKey: string): string {
  return `Basic ${btoa(apiKey + ':')}`;
}

function lastFriday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (day + 2) % 7; // days since last Friday
  d.setDate(d.getDate() - (diff === 0 ? 7 : diff));
  return d.toISOString().slice(0, 10);
}

function fridayNWeeksAgo(n: number): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (day + 2) % 7;
  d.setDate(d.getDate() - (diff === 0 ? 7 : diff));
  d.setDate(d.getDate() - n * 7);
  return d.toISOString().slice(0, 10);
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

function extractKey(args: Record<string, unknown>): string {
  const key = args._altosKey as string;
  delete args._altosKey;
  if (!key) throw new Error('Altos Research API key required. Get one at https://altosresearch.com and pass via _altosKey.');
  return key;
}

async function fetchAltosCSV(apiKey: string, params: Record<string, string>): Promise<Record<string, string>[]> {
  const url = new URL('https://intel.altosresearch.com/api/data');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: getAuth(apiKey) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Altos API error (${res.status}): ${text}`);
  }

  // Response may be gzipped — try to decompress
  const contentType = res.headers.get('content-type') || '';
  const contentEncoding = res.headers.get('content-encoding') || '';

  let text: string;
  if (contentType.includes('gzip') || contentEncoding.includes('gzip') || res.url.endsWith('.csv.gz')) {
    const ds = new DecompressionStream('gzip');
    const decompressed = res.body!.pipeThrough(ds);
    const reader = decompressed.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLength = chunks.reduce((a, c) => a + c.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    text = new TextDecoder().decode(merged);
  } else {
    text = await res.text();
  }

  return parseCSV(text);
}

async function fetchAltosJSON(apiKey: string, path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`https://intel.altosresearch.com/api${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: getAuth(apiKey) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Altos API error (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Tool definitions ───────────────────────────────────────────────────

const tools: McpToolExport['tools'] = [
  {
    name: 'altos_market_stats',
    description:
      'Get aggregated market statistics for a region — inventory, new listings, median price, days on market, and market action index.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _altosKey: { type: 'string', description: 'Altos Research API key' },
        region: { type: 'string', description: 'Region code (e.g., "us_national", "ca_los-angeles", "ca_94105")' },
        date: { type: 'string', description: 'Date (must be a Friday, YYYY-MM-DD). Defaults to most recent Friday.' },
        res_type: { type: 'string', description: 'Residential type filter: "single_family" or "multi_family". Default: single_family.' },
        quartile: { type: 'string', description: 'Price quartile: "ALL", "FIRST", "SECOND", "THIRD", "FOURTH". Default: ALL.' },
      },
      required: ['_altosKey', 'region'],
    },
  },
  {
    name: 'altos_inventory_trend',
    description:
      'Get inventory trend over multiple weeks — tracks inventory, new listings, days on market, median price, and percent price decreased over time.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _altosKey: { type: 'string', description: 'Altos Research API key' },
        region: { type: 'string', description: 'Region code (e.g., "us_national", "ca_los-angeles")' },
        weeks: { type: 'number', description: 'Number of weeks to look back (default 12, max 52)' },
      },
      required: ['_altosKey', 'region'],
    },
  },
  {
    name: 'altos_active_listings',
    description:
      'Get active listing-level data for a region — individual property details including address, price, beds, baths, and square footage.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _altosKey: { type: 'string', description: 'Altos Research API key' },
        region: { type: 'string', description: 'Region code (e.g., "ca_los-angeles", "ca_94105")' },
        date: { type: 'string', description: 'Date (must be a Friday, YYYY-MM-DD). Defaults to most recent Friday.' },
        limit: { type: 'number', description: 'Max rows to return (default 100)' },
      },
      required: ['_altosKey', 'region'],
    },
  },
  {
    name: 'altos_pending_sales',
    description:
      'Get pending sales (under contract) for a region — properties that have accepted offers but have not yet closed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _altosKey: { type: 'string', description: 'Altos Research API key' },
        region: { type: 'string', description: 'Region code (e.g., "ca_los-angeles", "ca_94105")' },
        date: { type: 'string', description: 'Date (must be a Friday, YYYY-MM-DD). Defaults to most recent Friday.' },
        limit: { type: 'number', description: 'Max rows to return (default 100)' },
      },
      required: ['_altosKey', 'region'],
    },
  },
  {
    name: 'altos_new_listings',
    description:
      'Get new listings (on market less than a week) for a region — freshly listed properties.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _altosKey: { type: 'string', description: 'Altos Research API key' },
        region: { type: 'string', description: 'Region code (e.g., "ca_los-angeles", "ca_94105")' },
        date: { type: 'string', description: 'Date (must be a Friday, YYYY-MM-DD). Defaults to most recent Friday.' },
        limit: { type: 'number', description: 'Max rows to return (default 100)' },
      },
      required: ['_altosKey', 'region'],
    },
  },
  {
    name: 'altos_list_files',
    description:
      'List available data files for a region — returns the catalog of downloadable data files from Altos Research.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _altosKey: { type: 'string', description: 'Altos Research API key' },
        region: { type: 'string', description: 'Region code (default: "us_national")' },
        type: { type: 'string', description: 'Data type: "stats", "listings", "listings-new", "pendings" (default: "stats")' },
      },
      required: ['_altosKey'],
    },
  },
];

// ── callTool dispatcher ────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const key = extractKey(args);

  switch (name) {
    case 'altos_market_stats': {
      const region = args.region as string;
      const date = (args.date as string) || lastFriday();
      const resType = (args.res_type as string) || 'single_family';
      const quartile = (args.quartile as string) || 'ALL';

      const rows = await fetchAltosCSV(key, {
        region,
        date,
        type: 'stats',
        columnset: 'classic',
      });

      // Filter rows by res_type, quartile, and 7-day rolling average
      const filtered = rows.filter(r =>
        (!r.res_type || r.res_type === resType) &&
        (!r.quartile || r.quartile === quartile) &&
        (!r.rolling_average || r.rolling_average === '7-day')
      );

      const result = (filtered.length > 0 ? filtered : rows.slice(0, 5)).map(r => ({
        date: r.date ?? date,
        inventory_total: r.inventory_total ?? '',
        new_listings_total: r.new_listings_total ?? '',
        listings_absorbed_total: r.listings_absorbed_total ?? '',
        days_on_market_median: r.days_on_market_median ?? '',
        price_median: r.price_median ?? '',
        percent_price_decreased_median: r.percent_price_decreased_median ?? '',
        market_action_median: r.market_action_median ?? '',
        months_of_inventory_median: r.months_of_inventory_median ?? '',
        estimated_sales_total: r.estimated_sales_total ?? '',
      }));

      return { region, date, res_type: resType, quartile, stats: result };
    }

    case 'altos_inventory_trend': {
      const region = args.region as string;
      const weeksRaw = Math.min(Math.max((args.weeks as number) || 12, 1), 52);

      // Limit actual API calls: fetch at most 6 snapshots, sampling evenly
      const maxCalls = 6;
      const datesToFetch: string[] = [];

      if (weeksRaw <= maxCalls) {
        for (let i = 0; i < weeksRaw; i++) {
          datesToFetch.push(fridayNWeeksAgo(i));
        }
      } else {
        // Sample evenly across the range
        const step = Math.floor(weeksRaw / maxCalls);
        for (let i = 0; i < maxCalls; i++) {
          datesToFetch.push(fridayNWeeksAgo(i * step));
        }
      }

      const snapshots = await Promise.all(
        datesToFetch.map(async (date) => {
          try {
            const rows = await fetchAltosCSV(key, {
              region,
              date,
              type: 'stats',
              columnset: 'classic',
            });

            const match = rows.find(r =>
              (!r.res_type || r.res_type === 'single_family') &&
              (!r.quartile || r.quartile === 'ALL') &&
              (!r.rolling_average || r.rolling_average === '7-day')
            ) || rows[0];

            if (!match) return null;

            return {
              date,
              inventory: match.inventory_total ?? '',
              new_listings: match.new_listings_total ?? '',
              days_on_market: match.days_on_market_median ?? '',
              price_median: match.price_median ?? '',
              pct_price_decreased: match.percent_price_decreased_median ?? '',
            };
          } catch {
            return null;
          }
        })
      );

      return {
        region,
        weeks_requested: weeksRaw,
        snapshots_fetched: datesToFetch.length,
        trend: snapshots.filter(Boolean),
      };
    }

    case 'altos_active_listings': {
      const region = args.region as string;
      const date = (args.date as string) || lastFriday();
      const limit = Math.min((args.limit as number) || 100, 500);

      const rows = await fetchAltosCSV(key, {
        region,
        date,
        type: 'listings',
        columnset: 'classic',
      });

      const listings = rows.slice(0, limit).map(r => ({
        property_id: r.property_id ?? '',
        street_address: r.street_address ?? '',
        city: r.city ?? '',
        state: r.state ?? '',
        zip: r.zip ?? '',
        price: r.price ?? '',
        type: r.type ?? '',
        beds: r.beds ?? '',
        baths: r.baths ?? '',
        floor_size: r.floor_size ?? '',
        lot_size: r.lot_size ?? '',
        built_in: r.built_in ?? '',
        days_on_market: r.days_on_market ?? '',
      }));

      return { region, date, total_available: rows.length, returned: listings.length, listings };
    }

    case 'altos_pending_sales': {
      const region = args.region as string;
      const date = (args.date as string) || lastFriday();
      const limit = Math.min((args.limit as number) || 100, 500);

      const rows = await fetchAltosCSV(key, {
        region,
        date,
        type: 'pendings',
        columnset: 'classic',
      });

      return { region, date, total_available: rows.length, returned: Math.min(rows.length, limit), pendings: rows.slice(0, limit) };
    }

    case 'altos_new_listings': {
      const region = args.region as string;
      const date = (args.date as string) || lastFriday();
      const limit = Math.min((args.limit as number) || 100, 500);

      const rows = await fetchAltosCSV(key, {
        region,
        date,
        type: 'listings-new',
        columnset: 'classic',
      });

      return { region, date, total_available: rows.length, returned: Math.min(rows.length, limit), new_listings: rows.slice(0, limit) };
    }

    case 'altos_list_files': {
      const region = (args.region as string) || 'us_national';
      const type = (args.type as string) || 'stats';

      return fetchAltosJSON(key, '/list', { region, type });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 25 } } satisfies McpToolExport;
