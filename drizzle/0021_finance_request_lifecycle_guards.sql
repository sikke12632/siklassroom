CREATE TRIGGER IF NOT EXISTS finance_cash_requests_classes_archive_guard
BEFORE UPDATE OF status ON classes
WHEN NEW.status = 'archived'
  AND OLD.status <> 'archived'
  AND EXISTS (
    SELECT 1
    FROM finance_cash_requests request_row
    WHERE request_row.class_id = NEW.id
      AND NOT EXISTS (
        SELECT 1
        FROM finance_request_resolutions resolution
        WHERE resolution.request_id = request_row.id
          AND resolution.class_id = request_row.class_id
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_REQUEST_PENDING_CLASS');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_cash_requests_students_exclude_guard
BEFORE UPDATE OF status ON students
WHEN NEW.status = 'excluded'
  AND OLD.status <> 'excluded'
  AND EXISTS (
    SELECT 1
    FROM finance_cash_requests request_row
    WHERE request_row.class_id = NEW.class_id
      AND request_row.requester_student_id = NEW.id
      AND NOT EXISTS (
        SELECT 1
        FROM finance_request_resolutions resolution
        WHERE resolution.request_id = request_row.id
          AND resolution.class_id = request_row.class_id
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_REQUEST_PENDING_STUDENT');
END;
