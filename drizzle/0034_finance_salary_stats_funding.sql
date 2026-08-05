CREATE TABLE `finance_funding_campaign_events` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_teacher_id` text,
	`actor_student_id` text,
	`actor_label` text NOT NULL,
	`intervention_reason` text,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`campaign_snapshot_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`,`class_id`) REFERENCES `finance_funding_campaigns`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_funding_campaign_events_action_ck" CHECK("finance_funding_campaign_events"."action" IN ('created', 'edited', 'paused', 'resumed', 'funded', 'refund_started', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "finance_funding_campaign_events_actor_ck" CHECK(("finance_funding_campaign_events"."actor_type" = 'teacher'
        AND "finance_funding_campaign_events"."actor_teacher_id" IS NOT NULL
        AND "finance_funding_campaign_events"."actor_student_id" IS NULL
        AND LENGTH(TRIM(COALESCE("finance_funding_campaign_events"."intervention_reason", ''))) >= 2)
      OR ("finance_funding_campaign_events"."actor_type" = 'student'
        AND "finance_funding_campaign_events"."actor_teacher_id" IS NULL
        AND "finance_funding_campaign_events"."actor_student_id" IS NOT NULL
        AND "finance_funding_campaign_events"."intervention_reason" IS NULL)
      OR ("finance_funding_campaign_events"."actor_type" = 'system'
        AND "finance_funding_campaign_events"."actor_teacher_id" IS NULL
        AND "finance_funding_campaign_events"."actor_student_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_campaign_events_campaign_revision_uq` ON `finance_funding_campaign_events` (`campaign_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_campaign_events_class_idempotency_uq` ON `finance_funding_campaign_events` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `finance_funding_campaign_events_class_created_idx` ON `finance_funding_campaign_events` (`class_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_funding_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`creator_student_id` text NOT NULL,
	`recipient_wallet_account_id` text NOT NULL,
	`creator_student_number_snapshot` integer NOT NULL,
	`creator_student_name_snapshot` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`target_amount` integer NOT NULL,
	`pledged_amount` integer DEFAULT 0 NOT NULL,
	`refunded_amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`deadline_at` integer NOT NULL,
	`terminal_reason` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`payout_transaction_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`funded_at` integer,
	`settled_at` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_wallet_account_id`,`class_id`) REFERENCES `finance_accounts`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payout_transaction_id`,`class_id`) REFERENCES `finance_transactions`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_funding_campaigns_text_ck" CHECK(LENGTH(TRIM("finance_funding_campaigns"."title")) BETWEEN 1 AND 50
      AND LENGTH("finance_funding_campaigns"."description") <= 300),
	CONSTRAINT "finance_funding_campaigns_amount_ck" CHECK("finance_funding_campaigns"."target_amount" BETWEEN 1 AND 1000000000
      AND "finance_funding_campaigns"."pledged_amount" BETWEEN 0 AND "finance_funding_campaigns"."target_amount"
      AND "finance_funding_campaigns"."refunded_amount" BETWEEN 0 AND "finance_funding_campaigns"."pledged_amount"),
	CONSTRAINT "finance_funding_campaigns_status_ck" CHECK("finance_funding_campaigns"."status" IN ('active', 'paused', 'funded', 'refunding', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "finance_funding_campaigns_revision_ck" CHECK("finance_funding_campaigns"."revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_campaigns_id_class_uq` ON `finance_funding_campaigns` (`id`,`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_campaigns_class_creator_idempotency_uq` ON `finance_funding_campaigns` (`class_id`,`creator_student_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_campaigns_creator_nonterminal_uq` ON `finance_funding_campaigns` (`class_id`,`creator_student_id`) WHERE "finance_funding_campaigns"."status" IN ('active', 'paused', 'funded', 'refunding');--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_campaigns_payout_transaction_uq` ON `finance_funding_campaigns` (`payout_transaction_id`) WHERE "finance_funding_campaigns"."payout_transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `finance_funding_campaigns_class_status_idx` ON `finance_funding_campaigns` (`class_id`,`status`,`deadline_at`);--> statement-breakpoint
CREATE TABLE `finance_funding_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`contributor_student_id` text NOT NULL,
	`wallet_account_id` text NOT NULL,
	`student_number_snapshot` integer NOT NULL,
	`student_name_snapshot` text NOT NULL,
	`amount` integer NOT NULL,
	`campaign_revision_before` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`posted_transaction_id` text NOT NULL,
	`transaction_payload_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contributor_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`,`class_id`) REFERENCES `finance_funding_campaigns`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wallet_account_id`,`class_id`) REFERENCES `finance_accounts`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_transaction_id`,`class_id`) REFERENCES `finance_transactions`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_funding_contributions_amount_ck" CHECK("finance_funding_contributions"."amount" BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_contributions_id_class_uq` ON `finance_funding_contributions` (`id`,`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_contributions_student_idempotency_uq` ON `finance_funding_contributions` (`class_id`,`contributor_student_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_contributions_posted_transaction_uq` ON `finance_funding_contributions` (`posted_transaction_id`) WHERE "finance_funding_contributions"."posted_transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `finance_funding_contributions_campaign_created_idx` ON `finance_funding_contributions` (`campaign_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_funding_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`contribution_id` text NOT NULL,
	`student_id` text NOT NULL,
	`amount` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`posted_transaction_id` text NOT NULL,
	`transaction_payload_hash` text NOT NULL,
	`refunded_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`,`class_id`) REFERENCES `finance_funding_campaigns`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contribution_id`,`class_id`) REFERENCES `finance_funding_contributions`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_transaction_id`,`class_id`) REFERENCES `finance_transactions`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_funding_refunds_amount_ck" CHECK("finance_funding_refunds"."amount" BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_refunds_contribution_uq` ON `finance_funding_refunds` (`contribution_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_refunds_class_idempotency_uq` ON `finance_funding_refunds` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_refunds_posted_transaction_uq` ON `finance_funding_refunds` (`posted_transaction_id`);--> statement-breakpoint
CREATE INDEX `finance_funding_refunds_campaign_idx` ON `finance_funding_refunds` (`campaign_id`,`refunded_at`);--> statement-breakpoint
CREATE TABLE `finance_funding_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`recipient_student_id` text NOT NULL,
	`amount` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`posted_transaction_id` text NOT NULL,
	`transaction_payload_hash` text NOT NULL,
	`settled_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`recipient_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`,`class_id`) REFERENCES `finance_funding_campaigns`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_transaction_id`,`class_id`) REFERENCES `finance_transactions`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_funding_settlements_amount_ck" CHECK("finance_funding_settlements"."amount" BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_settlements_campaign_uq` ON `finance_funding_settlements` (`campaign_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_settlements_class_idempotency_uq` ON `finance_funding_settlements` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_funding_settlements_posted_transaction_uq` ON `finance_funding_settlements` (`posted_transaction_id`);--> statement-breakpoint
CREATE TABLE `finance_payroll_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`class_id` text NOT NULL,
	`closure_result_id` text NOT NULL,
	`student_id` text NOT NULL,
	`student_number` integer NOT NULL,
	`student_name` text NOT NULL,
	`class_job_id` text NOT NULL,
	`job_name` text NOT NULL,
	`job_grade` text NOT NULL,
	`base_amount` integer NOT NULL,
	`total_amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`posted_transaction_id` text,
	`created_at` integer NOT NULL,
	`posted_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `finance_payroll_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closure_result_id`) REFERENCES `class_job_month_results`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`,`class_id`) REFERENCES `finance_payroll_runs`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_transaction_id`,`class_id`) REFERENCES `finance_transactions`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_payroll_items_grade_ck" CHECK("finance_payroll_items"."job_grade" IN ('A', 'B', 'C')),
	CONSTRAINT "finance_payroll_items_amount_ck" CHECK("finance_payroll_items"."base_amount" BETWEEN 0 AND 1000000000
      AND "finance_payroll_items"."total_amount" = "finance_payroll_items"."base_amount"),
	CONSTRAINT "finance_payroll_items_status_ck" CHECK("finance_payroll_items"."status" IN ('pending', 'posted')
      AND (("finance_payroll_items"."status" = 'posted'
          AND "finance_payroll_items"."posted_transaction_id" IS NOT NULL
          AND "finance_payroll_items"."posted_at" IS NOT NULL)
        OR ("finance_payroll_items"."status" = 'pending'
          AND "finance_payroll_items"."posted_transaction_id" IS NULL
          AND "finance_payroll_items"."posted_at" IS NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_payroll_items_run_student_uq` ON `finance_payroll_items` (`run_id`,`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_payroll_items_closure_result_uq` ON `finance_payroll_items` (`closure_result_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_payroll_items_posted_transaction_uq` ON `finance_payroll_items` (`posted_transaction_id`) WHERE "finance_payroll_items"."posted_transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `finance_payroll_items_class_status_idx` ON `finance_payroll_items` (`class_id`,`status`);--> statement-breakpoint
CREATE TABLE `finance_payroll_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`closure_id` text NOT NULL,
	`source_period_id` text NOT NULL,
	`source_year` integer NOT NULL,
	`source_month` integer NOT NULL,
	`salary_settings_revision` integer NOT NULL,
	`salary_settings_json` text NOT NULL,
	`status` text DEFAULT 'prepared' NOT NULL,
	`recipient_count` integer NOT NULL,
	`posted_count` integer DEFAULT 0 NOT NULL,
	`total_amount` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`initiated_by_teacher_id` text,
	`created_at` integer NOT NULL,
	`posted_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closure_id`) REFERENCES `class_job_month_closures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_period_id`) REFERENCES `class_job_assignment_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`initiated_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_payroll_runs_status_ck" CHECK("finance_payroll_runs"."status" IN ('prepared', 'posting', 'completed')),
	CONSTRAINT "finance_payroll_runs_counts_ck" CHECK("finance_payroll_runs"."recipient_count" > 0
      AND "finance_payroll_runs"."posted_count" BETWEEN 0 AND "finance_payroll_runs"."recipient_count"),
	CONSTRAINT "finance_payroll_runs_amount_ck" CHECK("finance_payroll_runs"."total_amount" BETWEEN 0 AND 1000000000),
	CONSTRAINT "finance_payroll_runs_time_ck" CHECK(("finance_payroll_runs"."status" = 'completed' AND "finance_payroll_runs"."posted_at" IS NOT NULL)
      OR ("finance_payroll_runs"."status" <> 'completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_payroll_runs_closure_uq` ON `finance_payroll_runs` (`closure_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_payroll_runs_class_idempotency_uq` ON `finance_payroll_runs` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_payroll_runs_id_class_uq` ON `finance_payroll_runs` (`id`,`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_payroll_runs_class_posting_uq` ON `finance_payroll_runs` (`class_id`) WHERE "finance_payroll_runs"."status" = 'posting';--> statement-breakpoint
CREATE INDEX `finance_payroll_runs_class_created_idx` ON `finance_payroll_runs` (`class_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_salary_setting_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`revision` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`previous_settings_json` text NOT NULL,
	`settings_json` text NOT NULL,
	`change_reason` text NOT NULL,
	`actor_teacher_id` text NOT NULL,
	`actor_label` text DEFAULT '교사' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_salary_setting_revisions_revision_ck" CHECK("finance_salary_setting_revisions"."revision" > 0),
	CONSTRAINT "finance_salary_setting_revisions_reason_ck" CHECK(LENGTH(TRIM("finance_salary_setting_revisions"."change_reason")) BETWEEN 2 AND 300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_salary_setting_revisions_class_revision_uq` ON `finance_salary_setting_revisions` (`class_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_salary_setting_revisions_class_idempotency_uq` ON `finance_salary_setting_revisions` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `finance_salary_setting_revisions_class_created_idx` ON `finance_salary_setting_revisions` (`class_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_salary_settings` (
	`class_id` text PRIMARY KEY NOT NULL,
	`grade_a_amount` integer DEFAULT 1300 NOT NULL,
	`grade_b_amount` integer DEFAULT 1000 NOT NULL,
	`grade_c_amount` integer DEFAULT 700 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_by_teacher_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_salary_settings_amount_ck" CHECK("finance_salary_settings"."grade_a_amount" BETWEEN 0 AND 1000000000
      AND "finance_salary_settings"."grade_b_amount" BETWEEN 0 AND "finance_salary_settings"."grade_a_amount"
      AND "finance_salary_settings"."grade_c_amount" BETWEEN 0 AND "finance_salary_settings"."grade_b_amount"),
	CONSTRAINT "finance_salary_settings_revision_ck" CHECK("finance_salary_settings"."revision" >= 0)
);
--> statement-breakpoint
CREATE INDEX `finance_salary_settings_updated_by_idx` ON `finance_salary_settings` (`updated_by_teacher_id`);
--> statement-breakpoint
CREATE TRIGGER finance_salary_setting_revisions_update_guard
BEFORE UPDATE ON finance_salary_setting_revisions
BEGIN SELECT RAISE(ABORT, 'FINANCE_SALARY_REVISION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_salary_setting_revisions_delete_guard
BEFORE DELETE ON finance_salary_setting_revisions
BEGIN SELECT RAISE(ABORT, 'FINANCE_SALARY_REVISION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_salary_settings_revision_guard
BEFORE UPDATE ON finance_salary_settings
WHEN NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'FINANCE_SALARY_SETTINGS_STALE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_payroll_items_posted_guard
BEFORE UPDATE ON finance_payroll_items
WHEN NOT (
  OLD.status = 'pending' AND NEW.status = 'posted'
  AND NEW.run_id = OLD.run_id AND NEW.class_id = OLD.class_id
  AND NEW.closure_result_id = OLD.closure_result_id
  AND NEW.student_id = OLD.student_id
  AND NEW.student_number = OLD.student_number
  AND NEW.student_name = OLD.student_name
  AND NEW.class_job_id = OLD.class_job_id
  AND NEW.job_name = OLD.job_name AND NEW.job_grade = OLD.job_grade
  AND NEW.base_amount = OLD.base_amount AND NEW.total_amount = OLD.total_amount
  AND NEW.created_at = OLD.created_at
  AND NEW.posted_transaction_id IS NOT NULL AND NEW.posted_at IS NOT NULL
  AND NEW.updated_at >= OLD.updated_at
)
BEGIN SELECT RAISE(ABORT, 'FINANCE_PAYROLL_ITEM_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_payroll_items_delete_guard
BEFORE DELETE ON finance_payroll_items
BEGIN SELECT RAISE(ABORT, 'FINANCE_PAYROLL_ITEM_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_classes_create_salary_settings
AFTER INSERT ON classes
BEGIN
  INSERT OR IGNORE INTO finance_salary_settings (
    class_id, grade_a_amount, grade_b_amount, grade_c_amount,
    revision, updated_by_teacher_id, updated_at
  ) VALUES (NEW.id, 1300, 1000, 700, 0, NULL, NEW.updated_at);
END;
--> statement-breakpoint
INSERT OR IGNORE INTO finance_salary_settings (
  class_id, grade_a_amount, grade_b_amount, grade_c_amount,
  revision, updated_by_teacher_id, updated_at
)
SELECT class_row.id, 1300, 1000, 700, 0, NULL, class_row.updated_at
FROM classes class_row;
--> statement-breakpoint
CREATE TRIGGER finance_funding_events_update_guard
BEFORE UPDATE ON finance_funding_campaign_events
BEGIN SELECT RAISE(ABORT, 'FINANCE_FUNDING_EVENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_funding_events_delete_guard
BEFORE DELETE ON finance_funding_campaign_events
BEGIN SELECT RAISE(ABORT, 'FINANCE_FUNDING_EVENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_funding_contributions_update_guard
BEFORE UPDATE ON finance_funding_contributions
BEGIN SELECT RAISE(ABORT, 'FINANCE_FUNDING_CONTRIBUTION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_funding_contributions_delete_guard
BEFORE DELETE ON finance_funding_contributions
BEGIN SELECT RAISE(ABORT, 'FINANCE_FUNDING_CONTRIBUTION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_funding_refunds_update_guard
BEFORE UPDATE ON finance_funding_refunds
BEGIN SELECT RAISE(ABORT, 'FINANCE_FUNDING_REFUND_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_funding_refunds_delete_guard
BEFORE DELETE ON finance_funding_refunds
BEGIN SELECT RAISE(ABORT, 'FINANCE_FUNDING_REFUND_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_funding_settlements_update_guard
BEFORE UPDATE ON finance_funding_settlements
BEGIN SELECT RAISE(ABORT, 'FINANCE_FUNDING_SETTLEMENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_funding_settlements_delete_guard
BEFORE DELETE ON finance_funding_settlements
BEGIN SELECT RAISE(ABORT, 'FINANCE_FUNDING_SETTLEMENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER finance_funding_transactions_reversal_guard
BEFORE INSERT ON finance_transactions
WHEN NEW.transaction_type = 'reversal' AND EXISTS (
  SELECT 1 FROM finance_transactions original
  WHERE original.id = NEW.reversal_of_transaction_id
    AND original.source_type IN (
      'funding_contribution', 'funding_settlement', 'funding_refund'
    )
)
BEGIN SELECT RAISE(ABORT, 'FINANCE_FUNDING_REVERSAL_REQUIRES_CAMPAIGN'); END;
--> statement-breakpoint
CREATE TRIGGER finance_funding_classes_archive_guard
BEFORE UPDATE OF status ON classes
WHEN NEW.status = 'archived' AND OLD.status <> 'archived'
  AND EXISTS (
    SELECT 1 FROM finance_funding_campaigns campaign
    WHERE campaign.class_id = NEW.id
      AND campaign.status IN ('active', 'paused', 'funded', 'refunding')
  )
BEGIN SELECT RAISE(ABORT, 'FINANCE_FUNDING_ACTIVE_CLASS'); END;
--> statement-breakpoint
CREATE TRIGGER finance_funding_students_exclude_guard
BEFORE UPDATE OF status ON students
WHEN NEW.status = 'excluded' AND OLD.status <> 'excluded'
  AND (
    EXISTS (
      SELECT 1 FROM finance_funding_campaigns campaign
      WHERE campaign.class_id = NEW.class_id
        AND campaign.creator_student_id = NEW.id
        AND campaign.status IN ('active', 'paused', 'funded', 'refunding')
    )
    OR EXISTS (
      SELECT 1
      FROM finance_funding_contributions contribution
      JOIN finance_funding_campaigns campaign
        ON campaign.id = contribution.campaign_id
       AND campaign.class_id = contribution.class_id
      WHERE contribution.class_id = NEW.class_id
        AND contribution.contributor_student_id = NEW.id
        AND campaign.status IN ('active', 'paused', 'funded', 'refunding')
    )
  )
BEGIN SELECT RAISE(ABORT, 'FINANCE_FUNDING_ACTIVE_STUDENT'); END;
