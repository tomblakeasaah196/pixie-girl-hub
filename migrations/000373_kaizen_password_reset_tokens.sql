-- Kaizen password reset tokens (OTP flow)
-- Stores OTP codes sent to operators during forgot-password flow
-- TTL: 15 minutes with 3 attempt limit

CREATE TABLE IF NOT EXISTS shared.kaizen_password_reset_tokens (
  token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code text NOT NULL,  -- 6-digit OTP
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  CONSTRAINT email_not_empty CHECK (email <> ''),
  CONSTRAINT code_length CHECK (length(code) = 6)
);

CREATE INDEX idx_kaizen_password_reset_email_active
  ON shared.kaizen_password_reset_tokens (email)
  WHERE used_at IS NULL AND expires_at > now();

CREATE INDEX idx_kaizen_password_reset_code_active
  ON shared.kaizen_password_reset_tokens (code)
  WHERE used_at IS NULL AND expires_at > now();
