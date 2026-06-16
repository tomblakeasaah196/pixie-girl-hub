-- Push subscription storage for Web Push (VAPID). One device ↔ one row.
-- The endpoint is the unique key (browser issues a new one on re-subscribe).

CREATE TABLE IF NOT EXISTS shared.push_subscriptions (
  sub_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES shared.users(user_id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth_key      TEXT NOT NULL,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  last_used_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX idx_push_subs_user ON shared.push_subscriptions(user_id);
