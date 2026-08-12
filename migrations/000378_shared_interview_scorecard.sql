-- ============================================================
-- 000378_shared_interview_scorecard
--
-- Reframes the 5 AI screening questions from an employer-written "rubric" into
-- an INTERVIEW SCORECARD. The questions (shared.vacancy_screening_questions,
-- from 000377) stay as-is, but instead of the hiring manager typing an ideal
-- answer, interviewers now rate each CANDIDATE against each question with 1–5
-- stars during the interview. Candidates never see any of this.
--
-- One row per (application, question, rater). The candidate's overall star
-- rating (shared.job_application_ratings) rolls up from the average of that
-- rater's per-question stars.
--
-- Idempotent; the runner wraps this in its own transaction (no BEGIN/COMMIT).
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.job_application_question_ratings (
  rating_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID        NOT NULL REFERENCES shared.job_applications (application_id) ON DELETE CASCADE,
  question_id     UUID        NOT NULL REFERENCES shared.vacancy_screening_questions (question_id) ON DELETE CASCADE,
  rater_id        UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  stars           SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  note            TEXT,                       -- optional one-line interview note
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, question_id, rater_id)
);
CREATE INDEX IF NOT EXISTS idx_job_app_question_ratings_app
  ON shared.job_application_question_ratings (application_id);
CREATE INDEX IF NOT EXISTS idx_job_app_question_ratings_q
  ON shared.job_application_question_ratings (question_id);

DROP TRIGGER IF EXISTS trg_job_app_question_ratings_updated_at
  ON shared.job_application_question_ratings;
CREATE TRIGGER trg_job_app_question_ratings_updated_at
  BEFORE UPDATE ON shared.job_application_question_ratings
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
