# Praxis AI Architecture

V2.2 §6.29-6.31 + §8.1-8.5

## What Praxis is

A conversational agent the CEO can talk to (text or voice) to query the business or execute actions. Backed by DeepSeek for general intelligence, with strong guardrails:

- Can only execute actions from the **Action Catalogue**
- Every WRITE requires **explicit confirmation** before execution
- Acts with the **user's own permissions** — never elevates
- Logs every action to `shared.audit_log`

## The thin-server principle (§8.1)

All heavy compute is API-based:

- **LLM:** DeepSeek API
- **Transcription:** Groq Whisper API
- **Embeddings:** OpenAI text-embedding-3-small API
- **Vector store:** pgvector inside PostgreSQL (no separate vector DB)
- **Orchestration:** lightweight Node.js (no LangChain dependency lock-in)

No GPU. No large server. The backend stays small.

## Action Catalogue (§8.3)

The Action Catalogue (`shared.ai_action_catalogue`) is the grounding mechanism that prevents hallucination. It's built by scanning the OpenAPI spec (`scripts/build-action-catalogue.js`) and listing every real endpoint with:

- `action_key` (`invoice.create`, `stock.transfer.initiate`)
- `title`, `description` (plain language)
- `http_method`, `route` (real endpoint)
- `payload_schema` (JSON Schema for inputs)
- `required_permission` (the RBAC grant needed)
- `entity_scope` (pixiegirl | faitlynhair | both)
- `is_write` (forces confirmation)
- `ai_enabled` (manual toggle by CEO)
- `examples` (sample utterances — embedded for retrieval)

New routes appear as `ai_enabled = false` until a human reviews and enables them. **Praxis cannot construct an endpoint that isn't in the catalogue.**

## RAG (§8.4)

Embeddings live in `shared.ai_embeddings`:

- `embedding` (vector(1536))
- `source_text` (the original text — kept for re-embedding)
- `embedding_model`, `embedding_version` (so we can migrate models)
- `entity_scope` (which brand owns this content)
- `access_scope` (which roles can see this content)

Retrieval flow:

```
user query
  ↓
embed
  ↓
similarity search filtered by:
  - entity_scope ⊆ user's available_businesses
  - access_scope ⊆ user's permissions
  ↓
top-k chunks → prompt
  ↓
LLM
```

This is what stops PII / cost prices / other-brand data from leaking into the model context.

## Orchestrator (§8.2)

The multi-agent pipeline:

```
1. Input              text or Whisper transcript
2. Intent classify    LLM call against summary of catalogue
3. RAG retrieve       permission-scoped similarity
4. Plan               decompose into ordered steps
5. Per step:
   a. Match action    from catalogue (top candidates by similarity)
   b. Fill payload    ask user for missing required fields
   c. Confirm         show exact action + payload, wait for explicit "Yes"
   d. Execute         call the real endpoint with user's auth
   e. Verify + log    audit_log entry
   f. Carry result    forward to next step if needed
6. Assemble reply     summarise + provide links to created records
```

For writes, the confirm step persists the proposed action to `shared.ai_pending_actions`. The frontend shows a card; the user clicks Confirm; the action executes. A cron sweeps stale unconfirmed actions every 15 minutes.

## Usage metering (§6.31)

Every AI call MUST go through `src/ai/usage-meter.js`:

- Pre-check: feature enabled? under hard cap?
- Make call
- Post: write to `shared.ai_usage_ledger`, broadcast new total on `system:ai_usage_meter`

Budgets are per calendar month, with **soft** and **hard** caps. Soft cap → notification to CEO. Hard cap → AI pauses gracefully; deterministic Tier-1 insights keep running.

## Insights (§6.30 / §6.31) — the unified engine

All tier-1 findings live in ONE store, `shared.ai_insights` (module + detector +
severity + status + typed `context` JSONB + drill target), written through the
declarative detector registry in `src/modules/ai_insights/insights.registry.js`.
**Every one of the 27 modules has at least one detector**; several carry two or
more (stock: reorder + negative count; purchasing: delivery overdue + stalled
approval; pricing: below-cost on every sales channel + below-floor on the
storefront).

**The CEO's switchboard** is `shared.ai_insight_modules`, edited at
AI Control → Insights (`/ai-control/insights`): per module,
`insights_enabled` (tier-1 rules), `narration_enabled` (tier-2 AI), and
`frequency`. The sweep (`runDetectorSweep`, cron every 30 min; stock via its own
scheduler at 08:00/14:00) runs **only enabled modules** — a disabled module
costs zero compute. This is the "activate/deactivate insights per module to cut
spend" control.

**Lifecycle**: open → acknowledged / investigating → resolved / dismissed, all
audited. Findings are idempotent on a partial-unique `(module, business,
suppression_key)` index while open — one condition, one flag. **Auto-resolve**:
after each clean detector pass, open findings whose condition no longer appears
are closed with "Auto-resolved: condition cleared" (a failed detector never
mass-resolves; the stock scheduler auto-resolves its own brand's findings).

**Delivery**: `brand:{brand}:insights` Socket.io room (live cards + Center),
CEO notification bell for genuinely-new high/critical findings (suppressed
duplicates never re-ping), the `<ModuleInsights>` slot on every fitting module
page, the Insights Center at `/insights`, App-Grid urgent badges, and the
`insights_open` Praxis query ("what needs my attention?").

- **Tier 1 — deterministic** (always on, zero AI cost): SQL rules over the
  live spine — everything above.
- **Tier 2 — AI narration** (opt-in per module, low cost): the 07:00 daily
  briefing narrates the SUMMARISED counts (never raw rows) when at least one
  module has narration on, the `insights_briefing` feature is usable, and a
  vendor is configured; metered as `insight_narration` on the governance
  ledger, with `ai_briefing_insight_refs` linking each briefing to the top
  open findings it covered.

When the AI budget hard-caps, Tier 2 pauses and the briefing falls back to the
deterministic text. Tier 1 keeps running. Insight surfaces never go blank.

User documentation: the Help Center's **Praxis Insights** category (7 seeded
articles, `related_module = 'ai_insights'`) covers the full system, including
the 27-module detector reference and FAQ.
