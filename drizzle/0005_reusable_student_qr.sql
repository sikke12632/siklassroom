-- Keep each student's current printed QR usable through a full school year.
-- Older generations remain unusable because registration validation also checks qr_generation.
UPDATE registration_tokens
SET expires_at = CASE
  WHEN expires_at < created_at + 34560000000 THEN created_at + 34560000000
  ELSE expires_at
END
WHERE revoked_at IS NULL
  AND generation = (
    SELECT students.qr_generation
    FROM students
    WHERE students.id = registration_tokens.student_id
  );
