-- Adds self-service profile columns (avatar URL + direct phone contact).
-- Idempotent: safe to run multiple times.
ALTER TABLE shared.users
  ADD COLUMN IF NOT EXISTS avatar_url  TEXT,
  ADD COLUMN IF NOT EXISTS phone       TEXT;
