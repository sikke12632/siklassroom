import assert from "node:assert/strict";
import test from "node:test";
import {
  FINANCE_FUNDING_DAY_MS,
  FINANCE_FUNDING_MAX_DURATION_DAYS,
  FinanceFundingRuleError,
  assertFinanceFundingTransition,
  financeFundingActionRequest,
  financeFundingDeadlineAtEndOfSeoulDay,
  financeFundingDeadlineInputRange,
  financeFundingProgress,
  financeFundingTerminalStatus,
  normalizeFinanceFundingAction,
  normalizeFinanceFundingCampaign,
  normalizeFinanceFundingCampaignEdit,
  normalizeFinanceFundingCampaignFields,
  normalizeFinanceFundingContribution,
} from "../lib/finance-funding-rules";

function fundingError(code: string) {
  return (error: unknown) => (
    error instanceof FinanceFundingRuleError
    && error.code === code
  );
}

test("campaign input is normalized and keeps an exact integer target", () => {
  const now = Date.UTC(2026, 7, 5, 0, 0, 0, 0);
  assert.deepEqual(
    normalizeFinanceFundingCampaign({
      title: "  교실   영화제  ",
      description: "  우리 반이 함께   만드는 영화제  ",
      targetAmount: 12_000,
      deadlineAt: now + (7 * FINANCE_FUNDING_DAY_MS),
      now,
    }),
    {
      title: "교실 영화제",
      description: "우리 반이 함께 만드는 영화제",
      targetAmount: 12_000,
      deadlineAt: now + (7 * FINANCE_FUNDING_DAY_MS),
    },
  );
});

test("campaign target and deadline boundaries are enforced", () => {
  const now = 10_000_000;
  const valid = {
    title: "Class project",
    targetAmount: 1_000,
    now,
  };

  assert.throws(
    () => normalizeFinanceFundingCampaign({
      ...valid,
      deadlineAt: now + FINANCE_FUNDING_DAY_MS - 1,
    }),
    fundingError("FINANCE_FUNDING_INVALID_DEADLINE"),
  );
  assert.throws(
    () => normalizeFinanceFundingCampaign({
      ...valid,
      deadlineAt: now
        + ((FINANCE_FUNDING_MAX_DURATION_DAYS * FINANCE_FUNDING_DAY_MS) + 1),
    }),
    fundingError("FINANCE_FUNDING_INVALID_DEADLINE"),
  );
  assert.throws(
    () => normalizeFinanceFundingCampaign({
      ...valid,
      targetAmount: 1.5,
      deadlineAt: now + FINANCE_FUNDING_DAY_MS,
    }),
    fundingError("FINANCE_FUNDING_INVALID_AMOUNT"),
  );
  assert.throws(
    () => normalizeFinanceFundingCampaign({
      ...valid,
      title: " ",
      deadlineAt: now + FINANCE_FUNDING_DAY_MS,
    }),
    fundingError("FINANCE_FUNDING_INPUT_REQUIRED"),
  );
});

test("date input boundaries always produce deadlines accepted by the server", () => {
  const now = Date.UTC(2026, 7, 5, 3, 30, 0, 0);
  const range = financeFundingDeadlineInputRange(now);
  assert.deepEqual(range, {
    minDate: "2026-08-06",
    maxDate: "2026-09-04",
    defaultDate: "2026-08-12",
  });

  for (const date of [range.minDate, range.maxDate]) {
    assert.doesNotThrow(() => normalizeFinanceFundingCampaign({
      title: "Boundary campaign",
      targetAmount: 1_000,
      deadlineAt: financeFundingDeadlineAtEndOfSeoulDay(date),
      now,
    }));
  }
  assert.throws(
    () => normalizeFinanceFundingCampaign({
      title: "Too far campaign",
      targetAmount: 1_000,
      deadlineAt: financeFundingDeadlineAtEndOfSeoulDay("2026-09-05"),
      now,
    }),
    fundingError("FINANCE_FUNDING_INVALID_DEADLINE"),
  );
  assert.throws(
    () => financeFundingDeadlineAtEndOfSeoulDay("2026-02-31"),
    fundingError("FINANCE_FUNDING_INVALID_DEADLINE"),
  );
});

test("editing text keeps an unchanged near deadline but validates a changed deadline", () => {
  const now = Date.UTC(2026, 7, 5, 3, 30, 0, 0);
  const currentDeadlineAt = now + (12 * 60 * 60 * 1_000);
  assert.deepEqual(normalizeFinanceFundingCampaignEdit({
    title: "  Updated title ",
    description: " Updated description ",
    targetAmount: 1_000,
    deadlineAt: currentDeadlineAt,
    now,
  }, { deadlineAt: currentDeadlineAt }), {
    title: "Updated title",
    description: "Updated description",
    targetAmount: 1_000,
    deadlineAt: currentDeadlineAt,
  });

  assert.throws(
    () => normalizeFinanceFundingCampaignEdit({
      title: "Updated title",
      targetAmount: 1_000,
      deadlineAt: currentDeadlineAt + 1,
      now,
    }, { deadlineAt: currentDeadlineAt }),
    fundingError("FINANCE_FUNDING_INVALID_DEADLINE"),
  );
  assert.equal(normalizeFinanceFundingCampaignEdit({
    title: "Updated title",
    targetAmount: 2_000,
    deadlineAt: now + (2 * FINANCE_FUNDING_DAY_MS),
    now,
  }, { deadlineAt: currentDeadlineAt }).targetAmount, 2_000);
});

test("lost-response action retries have a state-independent canonical payload", () => {
  const editValues = normalizeFinanceFundingCampaignFields({
    title: "  Class   festival ",
    description: " Together ",
    targetAmount: 3_000,
    deadlineAt: 9_999_999,
  });
  for (const action of ["edit", "pause", "resume", "cancel"] as const) {
    const request = {
      action,
      campaignId: "campaign-one",
      classId: "class-one",
      expectedRevision: 4,
      actorType: "student" as const,
      actorId: "student-one",
      interventionReason: null,
      editValues: action === "edit" ? editValues : null,
    };
    const firstAttempt = financeFundingActionRequest(request);
    const lostResponseRetry = financeFundingActionRequest(request);
    assert.deepEqual(lostResponseRetry, firstAttempt);
    assert.equal("status" in firstAttempt, false);
    assert.equal("next" in firstAttempt, false);
  }
});

test("a contribution may reach but never pass the exact target", () => {
  assert.deepEqual(
    normalizeFinanceFundingContribution({ amount: 400, remainingAmount: 400 }),
    { amount: 400, remainingAmount: 400, reachesTarget: true },
  );
  assert.deepEqual(
    normalizeFinanceFundingContribution({ amount: 399, remainingAmount: 400 }),
    { amount: 399, remainingAmount: 400, reachesTarget: false },
  );
  assert.throws(
    () => normalizeFinanceFundingContribution({
      amount: 401,
      remainingAmount: 400,
    }),
    fundingError("FINANCE_FUNDING_OVER_TARGET"),
  );
  assert.throws(
    () => normalizeFinanceFundingContribution({ amount: 0, remainingAmount: 1 }),
    fundingError("FINANCE_FUNDING_INVALID_AMOUNT"),
  );
});

test("only the student creator controls a campaign, except teacher emergency cancel", () => {
  assert.doesNotThrow(() => assertFinanceFundingTransition({
    action: "pause",
    status: "active",
    pledgedAmount: 0,
    isCreator: true,
    isTeacher: false,
  }));
  assert.doesNotThrow(() => assertFinanceFundingTransition({
    action: "resume",
    status: "paused",
    pledgedAmount: 0,
    isCreator: true,
    isTeacher: false,
  }));
  assert.doesNotThrow(() => assertFinanceFundingTransition({
    action: "cancel",
    status: "active",
    pledgedAmount: 100,
    isCreator: false,
    isTeacher: true,
  }));

  assert.throws(
    () => assertFinanceFundingTransition({
      action: "pause",
      status: "active",
      pledgedAmount: 0,
      isCreator: false,
      isTeacher: false,
    }),
    fundingError("FINANCE_FUNDING_CREATOR_REQUIRED"),
  );
  assert.throws(
    () => assertFinanceFundingTransition({
      action: "pause",
      status: "active",
      pledgedAmount: 0,
      isCreator: false,
      isTeacher: true,
    }),
    fundingError("FINANCE_FUNDING_TEACHER_ACTION_DENIED"),
  );
});

test("editing locks after the first pledge and transitions reject stale states", () => {
  assert.throws(
    () => assertFinanceFundingTransition({
      action: "edit",
      status: "active",
      pledgedAmount: 1,
      isCreator: true,
      isTeacher: false,
    }),
    fundingError("FINANCE_FUNDING_EDIT_LOCKED"),
  );
  assert.throws(
    () => assertFinanceFundingTransition({
      action: "resume",
      status: "active",
      pledgedAmount: 0,
      isCreator: true,
      isTeacher: false,
    }),
    fundingError("FINANCE_FUNDING_INVALID_TRANSITION"),
  );
  assert.throws(
    () => assertFinanceFundingTransition({
      action: "cancel",
      status: "succeeded",
      pledgedAmount: 1_000,
      isCreator: true,
      isTeacher: false,
    }),
    fundingError("FINANCE_FUNDING_INVALID_TRANSITION"),
  );
  assert.equal(normalizeFinanceFundingAction("cancel"), "cancel");
  assert.throws(
    () => normalizeFinanceFundingAction("delete"),
    fundingError("FINANCE_FUNDING_INVALID_ACTION"),
  );
});

test("progress is clamped and terminal reason maps to a visible outcome", () => {
  assert.equal(financeFundingProgress(0, 1_000), 0);
  assert.equal(financeFundingProgress(499, 1_000), 49);
  assert.equal(financeFundingProgress(1_500, 1_000), 100);
  assert.equal(financeFundingProgress(100, 0), 0);
  assert.equal(financeFundingTerminalStatus("deadline"), "failed");
  assert.equal(financeFundingTerminalStatus("student_cancelled"), "cancelled");
  assert.equal(financeFundingTerminalStatus("teacher_cancelled"), "cancelled");
});
