-- ============================================================
-- MIGRATION 000213 — Smartcomm V2 (WhatsApp / Instagram / Email
-- unified inbox + commerce-in-chat + Praxis-assisted replies)
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- This migration takes the V2.0 messaging skeleton from
-- 000004_shared_comms.sql and brings it up to the V2.2 vision
-- documented in `docs/Frontend_Engineering_Guide_v2.2.md §2.22`
-- (Smartcomm) — a WhatsApp/Instagram-feel inbox where 70% of
-- revenue arrives.
--
-- Adds:
--   1. Channel/member quality-of-life columns: pin, mute-until,
--      assignment, denormalised last_message_at + last_message_preview
--      so the inbox list is one indexed read.
--   2. Message edit/forward/delivery columns; message_reactions and
--      message_stars tables.
--   3. message_drafts — the staging area where Praxis (or a human)
--      writes a reply before hitting Send. One draft per user per
--      channel; cleared on send.
--   4. message_quick_replies — saved snippets (personal + brand-shared)
--      with {{variable}} interpolation.
--   5. contact_social_handles — the bridge that turns "DM from
--      @yourgirlie" into the right contact across IG/FB/TikTok.
--   6. messaging_accounts — which brand owns which WhatsApp number /
--      IG business account / inbound mailbox. Drives webhook → brand
--      routing without a hard-coded mapping.
--   7. smartcomm_platform_permissions — per-user × per-platform ×
--      per-business access (view / reply / send_template / close) with
--      a personal mute window. CEO bypasses (see 000210).
--   8. user_dnd_schedules — silence sound + push (badge still counts)
--      on a weekday × local-time window.
--   9. customer_onboarding_submissions — the Online QR / shareable
--      welcome form. Captures full delivery address, IG handle,
--      WhatsApp number, DOB, channel preference; pre-fills from
--      known contact data.
--  10. service_offerings — the Service Catalogue (revamp, custom
--      style, repairs, install, etc.) — config not code: a new row
--      shows up automatically in the chat "Convert to..." menu and
--      the public order form.
--  11. brand_voice_config — Praxis's source of truth for tone,
--      signature, do/don'ts, FAQ, sample transcripts per brand. The
--      "AI Control" page (governance.routes.js) reads/writes this.
--
-- Also widens the social_accounts platform check to include
-- 'whatsapp_business' (so we have one place to keep all connected
-- comms accounts).
--
-- Permission keys added to permission_module_keys:
--   - service_catalogue        — Service Catalogue admin (tab in /catalogue)
--   - customer_onboarding      — Online QR form admin
--
-- None of this migration drops data; column additions use IF NOT
-- EXISTS guards so re-applying is a no-op.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. message_channels — pin, mute, assignment, denorm last-message  ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.message_channels
  ADD COLUMN IF NOT EXISTS status              TEXT        NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','resolved')),
  ADD COLUMN IF NOT EXISTS assigned_to         UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at         TIMESTAMPTZ,
  -- WhatsApp service-window expiry — last inbound customer message + 24h.
  -- Free-form replies allowed until then; outside it, template-only.
  -- NULL = internal or never received an inbound from customer.
  ADD COLUMN IF NOT EXISTS wa_window_expires_at TIMESTAMPTZ,
  -- Denormalised for inbox list perf — one indexed read, no per-row JOIN.
  -- Updated by trigger on shared.messages insert (see 000214 trigger pack).
  ADD COLUMN IF NOT EXISTS last_message_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_message_preview TEXT,
  ADD COLUMN IF NOT EXISTS last_message_kind   TEXT;

CREATE INDEX IF NOT EXISTS idx_message_channels_business_last
  ON shared.message_channels (business, last_message_at DESC NULLS LAST)
  WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS idx_message_channels_assigned
  ON shared.message_channels (assigned_to)
  WHERE assigned_to IS NOT NULL;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. channel_members — per-member pin, mute-until, notification pref║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.channel_members
  ADD COLUMN IF NOT EXISTS is_pinned           BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS muted_until         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_pref   TEXT        NOT NULL DEFAULT 'all'
                            CHECK (notification_pref IN ('all','mentions_only','none')),
  -- Soft presence — updated by the socket layer on disconnect / ping.
  -- Used for "last seen" subtitles. NULL = never connected.
  ADD COLUMN IF NOT EXISTS last_seen_at        TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_channel_members_pinned
  ON shared.channel_members (user_id, is_pinned)
  WHERE user_id IS NOT NULL AND is_pinned = true;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 3. messages — edit, forward, delivery status                       ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.messages
  ADD COLUMN IF NOT EXISTS edited_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_forwarded        BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS forwarded_from_id   UUID        REFERENCES shared.messages (message_id) ON DELETE SET NULL,
  -- For outbound customer messages: provider delivery state.
  -- queued → sent → delivered → read   (or failed at any step).
  ADD COLUMN IF NOT EXISTS delivery_status     TEXT        NOT NULL DEFAULT 'sent'
                            CHECK (delivery_status IN ('queued','sent','delivered','read','failed')),
  ADD COLUMN IF NOT EXISTS delivery_error      TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_delivery_pending
  ON shared.messages (delivery_status, created_at)
  WHERE delivery_status IN ('queued','failed');

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 4. message_reactions                                               ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shared.message_reactions (
  reaction_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id            UUID        NOT NULL REFERENCES shared.messages (message_id) ON DELETE CASCADE,
  user_id               UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  emoji                 TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_msg_reactions_message ON shared.message_reactions (message_id);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 5. message_stars (personal "Saved messages" per user)              ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shared.message_stars (
  message_id            UUID        NOT NULL REFERENCES shared.messages (message_id) ON DELETE CASCADE,
  user_id               UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_msg_stars_user ON shared.message_stars (user_id, created_at DESC);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 6. message_drafts — staging area for composer + Praxis drafts     ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- One row per (channel, user). UPSERT on every keystroke / Praxis return;
-- DELETE on send. generated_by lets the UI show a "✨ Praxis-drafted"
-- chip next to the input until the user edits or sends.

CREATE TABLE IF NOT EXISTS shared.message_drafts (
  channel_id            UUID        NOT NULL REFERENCES shared.message_channels (channel_id) ON DELETE CASCADE,
  user_id               UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  content               TEXT        NOT NULL DEFAULT '',
  attachments           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  reply_to_id           UUID        REFERENCES shared.messages (message_id) ON DELETE SET NULL,
  generated_by          TEXT        NOT NULL DEFAULT 'human'
                        CHECK (generated_by IN ('human','praxis')),
  generated_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 7. message_quick_replies — saved snippets + {{variables}}          ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- scope='personal' → owner_user_id is the author, business optional.
-- scope='brand'    → owner_user_id NULL, business required (CEO/manager
--                    publishes a brand-wide library).
-- slug is the slash-command trigger (/welcome, /shipping, /price).

CREATE TABLE IF NOT EXISTS shared.message_quick_replies (
  reply_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope                 TEXT        NOT NULL CHECK (scope IN ('personal','brand')),
  owner_user_id         UUID        REFERENCES shared.users (user_id) ON DELETE CASCADE,
  business              TEXT        REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  slug                  TEXT        NOT NULL,
  title                 TEXT        NOT NULL,
  body                  TEXT        NOT NULL,
  -- Detected {{var_name}} tokens; the UI can show a quick form to fill
  -- any that don't auto-resolve from the contact + their latest order.
  variables             TEXT[]      NOT NULL DEFAULT '{}',
  category              TEXT,
  sort_order            INTEGER     NOT NULL DEFAULT 0,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Personal slugs unique per user; brand slugs unique per business.
  CONSTRAINT quick_reply_scope_check CHECK (
    (scope = 'personal' AND owner_user_id IS NOT NULL) OR
    (scope = 'brand'    AND owner_user_id IS NULL AND business IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_replies_personal_slug
  ON shared.message_quick_replies (owner_user_id, slug)
  WHERE scope = 'personal';
CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_replies_brand_slug
  ON shared.message_quick_replies (business, slug)
  WHERE scope = 'brand';
CREATE INDEX IF NOT EXISTS idx_quick_replies_owner
  ON shared.message_quick_replies (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quick_replies_business
  ON shared.message_quick_replies (business) WHERE business IS NOT NULL;
CREATE TRIGGER trg_quick_replies_updated_at
  BEFORE UPDATE ON shared.message_quick_replies
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 8. contact_social_handles — multi-platform identity bridge        ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- A customer DMing from @yourgirlie on IG and replying from a
-- WhatsApp number resolves to ONE contact thanks to these rows.
-- external_user_id is the platform's stable id (IGSID for IG,
-- phone-number-id-scoped wa_id for WA), so handle renames don't
-- orphan the contact.

CREATE TABLE IF NOT EXISTS shared.contact_social_handles (
  handle_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID        NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  platform              TEXT        NOT NULL
                        CHECK (platform IN ('instagram','facebook','tiktok','youtube','whatsapp','email')),
  handle                TEXT,                                    -- '@yourgirlie' / phone / email
  external_user_id      TEXT,                                    -- platform-stable id
  display_name          TEXT,
  profile_picture_url   TEXT,
  verified_at           TIMESTAMPTZ,                             -- first time we confirmed it
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- An external_user_id is globally unique per platform (IG's IGSID, WA's wa_id).
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_handles_external
  ON shared.contact_social_handles (platform, external_user_id)
  WHERE external_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_handles_contact
  ON shared.contact_social_handles (contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_handles_handle
  ON shared.contact_social_handles (platform, lower(handle))
  WHERE handle IS NOT NULL;
CREATE TRIGGER trg_contact_handles_updated_at
  BEFORE UPDATE ON shared.contact_social_handles
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 9. messaging_accounts — which brand owns which channel address    ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- Separate from social_accounts (which is for POSTING content). This
-- table answers "an inbound message just arrived on phone-number-id
-- X — which brand's inbox does it belong to?". One row per
-- WhatsApp phone, IG business account, FB page (Messenger) and
-- inbound mailbox per brand. Tokens are encrypted at the app layer.

CREATE TABLE IF NOT EXISTS shared.messaging_accounts (
  account_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  platform              TEXT        NOT NULL
                        CHECK (platform IN ('whatsapp','instagram','facebook','email')),
  -- Stable provider id this account is reached at:
  --   whatsapp  → phone_number_id (from Meta WA Cloud)
  --   instagram → IG Business Account id
  --   facebook  → FB Page id
  --   email     → inbound mailbox (e.g. support@pixiegirl.ng)
  external_account_id   TEXT        NOT NULL,
  display_name          TEXT        NOT NULL,
  -- For WA + IG/FB: the page/system-user access token (encrypted).
  -- For email: NULL.
  access_token_enc      TEXT,
  webhook_verify_token  TEXT,                                    -- Meta GET-handshake token
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  connected_by          UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  connected_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_inbound_at       TIMESTAMPTZ,
  metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, external_account_id)
);
CREATE INDEX IF NOT EXISTS idx_messaging_accounts_business
  ON shared.messaging_accounts (business, platform) WHERE is_active = true;
CREATE TRIGGER trg_messaging_accounts_updated_at
  BEFORE UPDATE ON shared.messaging_accounts
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 10. smartcomm_platform_permissions                                ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- The matrix the CEO uses to say "this junior CS rep can reply on
-- WhatsApp only, this stylist sees IG DMs for Faitlyn, this senior
-- can send templates and close threads on every platform." CEO
-- bypasses (handled in service layer). muted_until is a per-user
-- per-platform silence ("mute Instagram for 8h").

CREATE TABLE IF NOT EXISTS shared.smartcomm_platform_permissions (
  permission_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  platform              TEXT        NOT NULL
                        CHECK (platform IN ('whatsapp','instagram','facebook','email','internal')),
  can_view              BOOLEAN     NOT NULL DEFAULT true,
  can_reply             BOOLEAN     NOT NULL DEFAULT false,
  can_send_template     BOOLEAN     NOT NULL DEFAULT false,
  can_close             BOOLEAN     NOT NULL DEFAULT false,
  muted_until           TIMESTAMPTZ,
  updated_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, business, platform)
);
CREATE INDEX IF NOT EXISTS idx_smartcomm_perms_user
  ON shared.smartcomm_platform_permissions (user_id);
CREATE TRIGGER trg_smartcomm_perms_updated_at
  BEFORE UPDATE ON shared.smartcomm_platform_permissions
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 11. user_dnd_schedules — personal quiet hours                     ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- weekday 0..6 (Sunday=0). Times are local to the user's timezone.
-- During a DND window, sound + push are suppressed but @mentions
-- still ping (mute never silences @mentions — see service layer).

CREATE TABLE IF NOT EXISTS shared.user_dnd_schedules (
  schedule_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  weekday               SMALLINT    NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_local           TIME        NOT NULL,
  end_local             TIME        NOT NULL,
  timezone              TEXT        NOT NULL DEFAULT 'Africa/Lagos',
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, weekday, start_local, end_local)
);
CREATE INDEX IF NOT EXISTS idx_user_dnd_user ON shared.user_dnd_schedules (user_id);
CREATE TRIGGER trg_user_dnd_updated_at
  BEFORE UPDATE ON shared.user_dnd_schedules
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 12. customer_onboarding_submissions — the "Online QR" form        ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- A staff member taps "Send Online QR" in the composer → we generate
-- a token, the customer opens /welcome/{business}/{token}, fills it,
-- POST lands here. The handler upserts the matching contact +
-- contact_social_handles + contact_addresses and updates the channel
-- with the new identity. Tokens expire (default 30 days).
--
-- Payload schema (validated server-side) carries: first_name,
-- last_name, dob_day, dob_month, primary_phone, whatsapp_number,
-- email, instagram_handle, preferred_channel, delivery + billing
-- addresses (with lat/lng from Google Places), inspiration_photo_ids.

CREATE TABLE IF NOT EXISTS shared.customer_onboarding_submissions (
  submission_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token                 TEXT        NOT NULL UNIQUE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  -- Optional channel binding — when the form was sent FROM a chat
  -- thread, completion auto-attaches identity back to that thread.
  channel_id            UUID        REFERENCES shared.message_channels (channel_id) ON DELETE SET NULL,
  -- contact_id is populated post-submission once we resolve / create
  -- the contact. Pre-fill data lives in seed_payload (what we knew
  -- before sending the form); payload holds what the customer typed.
  contact_id            UUID        REFERENCES shared.contacts (contact_id) ON DELETE SET NULL,
  seed_payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  payload               JSONB,
  source                TEXT        NOT NULL DEFAULT 'online'
                        CHECK (source IN ('online','walkin','staff')),
  created_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days',
  completed_at          TIMESTAMPTZ,
  -- IP captured server-side at submission for anti-fraud signals.
  submitted_ip          INET
);
CREATE INDEX IF NOT EXISTS idx_onboarding_token
  ON shared.customer_onboarding_submissions (token);
CREATE INDEX IF NOT EXISTS idx_onboarding_channel
  ON shared.customer_onboarding_submissions (channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_onboarding_business_pending
  ON shared.customer_onboarding_submissions (business, created_at DESC)
  WHERE completed_at IS NULL;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 13. service_offerings — the Service Catalogue                      ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- "Wig revamp", "Bleach knots", "Custom style", "Closure repair", etc.
-- A new row here shows up automatically in the composer's "Convert
-- to..." menu, the public order form's service tab, and the price
-- list. Owner: catalogue module (new tab in /catalogue).

CREATE TABLE IF NOT EXISTS shared.service_offerings (
  service_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  name                  TEXT        NOT NULL,
  slug                  TEXT        NOT NULL,
  description           TEXT,
  -- Base price in NGN (display currency conversion happens in app).
  base_price_ngn        NUMERIC(14,2) NOT NULL DEFAULT 0,
  duration_minutes      INTEGER,
  -- Free-text category — keeps the catalogue tab groupable without a
  -- second table. Examples: 'revamp', 'styling', 'repair', 'install'.
  category              TEXT,
  image_url             TEXT,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  sort_order            INTEGER     NOT NULL DEFAULT 0,
  -- When a service is tied to a stylist tier (e.g. "Master Stylists
  -- only"), the conversion flow filters assignees accordingly.
  required_stylist_tier TEXT,
  created_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, slug)
);
CREATE INDEX IF NOT EXISTS idx_service_offerings_business_active
  ON shared.service_offerings (business, sort_order)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_service_offerings_category
  ON shared.service_offerings (business, category) WHERE category IS NOT NULL;
CREATE TRIGGER trg_service_offerings_updated_at
  BEFORE UPDATE ON shared.service_offerings
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 14. brand_voice_config — Praxis's per-brand tone source-of-truth ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- Read every time Praxis drafts a reply. Lives under AI Control
-- (ai_governance) and respects its permission key. sample_transcripts
-- is a small JSONB array of anonymised past DMs Praxis uses for
-- few-shot tone matching.

CREATE TABLE IF NOT EXISTS shared.brand_voice_config (
  business              TEXT        PRIMARY KEY REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  tone                  TEXT,                                    -- 'warm', 'luxe', 'playful', etc.
  voice_summary         TEXT,                                    -- 1-paragraph brand voice
  signature_html        TEXT,                                    -- appended to drafted replies
  do_donts              JSONB       NOT NULL DEFAULT '{"do":[],"dont":[]}'::jsonb,
  faq_markdown          TEXT,
  sample_transcripts    JSONB       NOT NULL DEFAULT '[]'::jsonb, -- few-shot examples
  primary_emojis        TEXT[]      NOT NULL DEFAULT '{}',
  -- Per-business toggles (CEO controls). Defaults: classification OFF
  -- (paid feature), draft-on-tap ON (only fires when user clicks).
  classify_inbound      BOOLEAN     NOT NULL DEFAULT false,
  draft_on_tap          BOOLEAN     NOT NULL DEFAULT true,
  updated_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_brand_voice_updated_at
  BEFORE UPDATE ON shared.brand_voice_config
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 15. social_accounts platform widening                             ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- 000011 limits social_accounts.platform to publishing platforms.
-- Drop and recreate with the wider set so existing data is fine.

ALTER TABLE shared.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_platform_check;
ALTER TABLE shared.social_accounts
  ADD CONSTRAINT social_accounts_platform_check
  CHECK (platform IN ('instagram','facebook','tiktok','youtube','whatsapp_business','email'));

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 16. message_channels.external_platform widening (audit trail-    ║
-- ║     friendly).  000004 already includes the values we need but we ║
-- ║     re-state the check so the constraint name lines up.           ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.message_channels
  DROP CONSTRAINT IF EXISTS message_channels_external_platform_check;
ALTER TABLE shared.message_channels
  ADD CONSTRAINT message_channels_external_platform_check
  CHECK (external_platform IS NULL OR
         external_platform IN ('instagram','whatsapp','facebook','website_chat','email'));

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 17. Trigger: keep channel last_message_* in sync                  ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- One indexed read powers the inbox list. The trigger updates the
-- denormalised columns whenever a message is inserted / soft-deleted
-- / edited. Preview is text-truncated; non-text messages emit a
-- friendly placeholder ("📷 Photo", "🎤 Voice note", "📄 Document").

CREATE OR REPLACE FUNCTION shared.fn_smartcomm_touch_channel()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  preview TEXT;
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.content IS DISTINCT FROM NEW.content) THEN
    preview := CASE NEW.message_type
      WHEN 'image' THEN '📷 Photo'
      WHEN 'voice_note' THEN '🎤 Voice note'
      WHEN 'document' THEN '📄 Document'
      WHEN 'video' THEN '🎬 Video'
      WHEN 'sticker' THEN '🌟 Sticker'
      WHEN 'system' THEN COALESCE(NEW.content, '')
      ELSE LEFT(COALESCE(NEW.content, ''), 140)
    END;
    UPDATE shared.message_channels
       SET last_message_at      = NEW.created_at,
           last_message_preview = preview,
           last_message_kind    = NEW.message_type,
           updated_at           = now()
     WHERE channel_id = NEW.channel_id
       AND (last_message_at IS NULL OR NEW.created_at >= last_message_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_smartcomm_touch_channel ON shared.messages;
CREATE TRIGGER trg_smartcomm_touch_channel
  AFTER INSERT OR UPDATE OF content, is_deleted ON shared.messages
  FOR EACH ROW EXECUTE FUNCTION shared.fn_smartcomm_touch_channel();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 18. Trigger: keep WhatsApp 24-hour window fresh on inbound        ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- A new inbound from the customer (sender_contact_id NOT NULL) on a
-- WhatsApp customer_thread resets wa_window_expires_at to NOW + 24h.
-- Outbound messages and non-WA threads are ignored.

CREATE OR REPLACE FUNCTION shared.fn_smartcomm_refresh_wa_window()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sender_contact_id IS NOT NULL THEN
    UPDATE shared.message_channels
       SET wa_window_expires_at = NEW.created_at + interval '24 hours'
     WHERE channel_id = NEW.channel_id
       AND channel_type = 'customer_thread'
       AND external_platform = 'whatsapp';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_smartcomm_refresh_wa_window ON shared.messages;
CREATE TRIGGER trg_smartcomm_refresh_wa_window
  AFTER INSERT ON shared.messages
  FOR EACH ROW EXECUTE FUNCTION shared.fn_smartcomm_refresh_wa_window();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 19. permission_module_keys — new module entries                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.permission_module_keys (module_key, display_name, description, display_order) VALUES
  ('service_catalogue',     'Service Catalogue',              'Revamps, custom styles, repairs & other services',        145),
  ('customer_onboarding',   'Customer Onboarding',            'Online QR welcome form: handles + delivery address',      146)
ON CONFLICT (module_key) DO NOTHING;

-- Mirror 000210_shared_ceo_full_access for the new module keys so the
-- owner role gets full grants without waiting for the next re-run of
-- that migration. Idempotent (ON CONFLICT DO NOTHING).
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT
  '11111111-1111-1111-1111-000000000001'::uuid,
  mk.module_key,
  a.action,
  'all'
FROM shared.permission_module_keys mk
CROSS JOIN (VALUES ('view'),('create'),('edit'),('delete'),('approve'),('export')) AS a(action)
WHERE mk.module_key IN ('service_catalogue','customer_onboarding')
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema='shared' AND table_name IN (
--      'message_reactions','message_stars','message_drafts',
--      'message_quick_replies','contact_social_handles',
--      'messaging_accounts','smartcomm_platform_permissions',
--      'user_dnd_schedules','customer_onboarding_submissions',
--      'service_offerings','brand_voice_config'
--    ) ORDER BY table_name;
-- ============================================================
