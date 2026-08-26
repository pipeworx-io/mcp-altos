# Altos Research — Real-Time Real Estate Market Data

Altos Research is the industry's standard for weekly-cadence US real estate market statistics: median list prices, price reductions, days on market, inventory by ZIP / metro / state, broken out by property type (single-family, condo) and market quartile. Where MLS data is fragmented and lagged, Altos aggregates and publishes weekly.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Why this matters for AI agents

Most public housing data (Census ACS, FRED home price index) updates monthly or quarterly. Altos updates weekly with the data agents and lenders actually use to gauge market temperature. If an agent is answering "is this market hot or cold right now?" the Altos data is most fit-for-purpose.

Common flows:

- **Metro stats.** `altos_market_stats({region: "us-co-denver"})` → median list, days on market, inventory, weekly trend.
- **Property type filter.** Same call with `res_type: "single_family"` or `"condo"`.
- **Quartile filter.** `quartile: "FIRST"` to focus on the bottom-quartile market (entry-level), `"FOURTH"` for luxury.
- **Multi-metro comparison.** Iterate calls in parallel for a peer comparison.

Used by the `housing_property_report` and `housing_market_brief` compounds.

## Auth

Altos is a paid commercial data product. Two paths:

1. **BYO key**: get an Altos partner key directly (commercial relationship), pass via `_altosKey`.
2. **Pipeworx Housing Vertical**: subscribe at [pipeworx.io/account](https://pipeworx.io/account) and Pipeworx fronts the relationship. No `_altosKey` needed.

The vertical option is the common case — most agents using Altos also want ATTOM, FRED, and BLS for housing analysis. Bundling them is cheaper than separate keys.

## Region codes

Altos uses geo-coded region IDs:

| Format | Example |
|---|---|
| National | `us_national` |
| State | `us-co` (Colorado) |
| Metro | `us-co-denver` (Denver MSA) |
| ZIP | `us-co-denver-80202` |

Smaller geographies have noisier data — single-ZIP weekly stats can swing wildly with low listing counts.

## Update cadence

Weekly, typically published Monday or Tuesday for the prior week's data. Pipeworx caches with 24-hour TTL; intra-week, the same number is returned (Altos doesn't intra-week update).

## Common pitfalls

- **List vs. sale price.** Altos primarily tracks active listings — list price, days on market, price reductions. Sale prices and YoY-sale-price-change come from county records (ATTOM) and have longer lag. Don't conflate "Altos median price" with "sold for."
- **Active inventory ≠ months-of-supply.** Altos gives you the level; months-of-supply (a more interpretable metric) needs absorption rate too. Compute as inventory / monthly sales rate.
- **Quartile semantics.** Altos splits the market into 4 price quartiles per region. The first quartile is bottom 25%, fourth is top 25%. Quartile boundaries are recomputed each week.
- **Property type changes coverage.** Single-family is universally covered; condos exist in metros where condos are common (urban centers). Rural metros may return null for condo queries.
- **"This week" gets revised.** The most recent week is provisional and gets revised slightly the following week as more listings flow in. Don't deploy production decisions on the most-recent-week number alone.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "altos": {
      "url": "https://gateway.pipeworx.io/altos/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/altos/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Altos data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
