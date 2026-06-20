-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 000230 — Help/FAQ: IG + email first, WhatsApp last (Praxis-indexed)   ║
-- ║                                                                      ║
-- ║ Adds one plain-English article answering the questions the CEO       ║
-- ║ actually asks Praxis: "why can't my staff just WhatsApp everyone?"   ║
-- ║ and "why do automated updates mostly go by email?". Mirrors it into  ║
-- ║ ai_knowledge_chunks (same idempotent pattern as 000214) so Praxis    ║
-- ║ can ground its answer in it. Additive — new slug, ON CONFLICT safe.  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

INSERT INTO shared.help_articles
  (category_id, slug, title, summary, audience, related_module,
   body_markdown, sort_order, tags)
VALUES
  ((SELECT category_id FROM shared.help_categories WHERE slug = 'messaging'),
   'why-email-instagram-before-whatsapp',
   'Why we use Email & Instagram before WhatsApp',
   'The simple money reason our automated messages default to email and Instagram, and why staff don''t fire off WhatsApp messages first.',
   'all',
   'smartcomm',
$$
# Why we use Email & Instagram before WhatsApp

Short version: **the customer talking to us is always free; us talking first
can cost money — and only on WhatsApp.** So we lead with the free channels and
keep WhatsApp for the few moments where it genuinely pays for itself.

## The one rule that explains everything

WhatsApp only charges us when **we** open a conversation (a "template" message)
to someone who hasn't messaged us in the last 24 hours. Instagram and email
never charge per message. So:

- **A customer DMs us (IG or WhatsApp)** → every reply for 24 hours is free.
- **We message first on WhatsApp** → a small fee (~₦11 utility, ~₦88 marketing).
- **We message first on email or Instagram** → free.

## So why can't staff just WhatsApp everyone?

Two reasons, both protective:

1. **Cost discipline.** If everyone could blast WhatsApp templates, the bill
   could run to six figures a month. Replying inside an open chat is always
   free and never blocked — it's only *initiating* WhatsApp that's gated.
2. **Meta's rules.** Outside the 24-hour window WhatsApp only accepts approved
   template messages; free-form text is rejected. So an "initiate WhatsApp"
   button that mostly fails would just confuse staff.

The permission to send WhatsApp templates is therefore granted deliberately,
not given to everyone by default. Replying to a customer who messaged us needs
no special permission — it's free and always available.

## Why automated updates mostly go by email

Receipts, invoices and order confirmations go by **email**: it's free, it
carries the PDF the customer wants to keep, and it looks professional. Only the
time-sensitive, money-recovering moments use WhatsApp:

- **Out for delivery / delivery failed** — the customer must be reachable now.
- **Payment / layaway overdue** — WhatsApp recovers far more than email, so the
  ~₦11 pays for itself many times over.

**Marketing never goes on WhatsApp** — it runs on Instagram and email, which
reach the whole list for free. WhatsApp marketing is blocked by a hard
guardrail in Channel Policy.

## The bottom line for the budget

Running costs stay under a few thousand naira a month for everything
transactional, because the expensive channel is reserved for the handful of
high-value sends. Instagram and email do the heavy lifting for free.
$$,
   25,
   ARRAY['cost', 'whatsapp', 'email', 'instagram', 'strategy', 'channel'])
ON CONFLICT (slug) DO NOTHING;

-- Mirror into the Praxis knowledge base (same idempotent select as 000214).
INSERT INTO shared.ai_knowledge_chunks
  (source_type, source_ref, business, title, content, token_count,
   sensitivity, content_hash, metadata)
SELECT
  'custom',
  'help_article:' || a.slug,
  NULL,
  a.title,
  a.body_markdown,
  GREATEST(1, LENGTH(a.body_markdown) / 4),
  'public',
  md5(a.body_markdown),
  jsonb_build_object(
    'article_id', a.article_id,
    'slug',       a.slug,
    'audience',   a.audience,
    'related_module', a.related_module,
    'tags',       a.tags
  )
FROM shared.help_articles a
WHERE a.slug = 'why-email-instagram-before-whatsapp'
  AND a.praxis_indexed = true
  AND a.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM shared.ai_knowledge_chunks k
     WHERE k.source_type = 'custom'
       AND k.source_ref  = 'help_article:' || a.slug
  );

COMMIT;
