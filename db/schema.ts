import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const teachers = sqliteTable("teachers", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  status: text("status").notNull().default("active"),
  emailVerifiedAt: integer("email_verified_at"),
  teacherAccessStatus: text("teacher_access_status").notNull().default("pending"),
  teacherAccessVerifiedAt: integer("teacher_access_verified_at"),
  schoolId: text("school_id"),
  manualSchoolRequestId: text("manual_school_request_id"),
  teacherAccessNote: text("teacher_access_note"),
  teacherAccessUpdatedAt: integer("teacher_access_updated_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("teachers_email_uq").on(table.email)]);

export const classes = sqliteTable("classes", {
  id: text("id").primaryKey(),
  teacherId: text("teacher_id").notNull().references(() => teachers.id),
  schoolName: text("school_name").notNull(),
  schoolNormalized: text("school_normalized").notNull(),
  schoolId: text("school_id"),
  manualSchoolRequestId: text("manual_school_request_id"),
  schoolYear: integer("school_year").notNull(),
  grade: integer("grade").notNull(),
  classNumber: integer("class_number").notNull(),
  displayName: text("display_name"),
  status: text("status").notNull().default("active"),
  timeZone: text("time_zone").notNull().default("Asia/Seoul"),
  setupStage: text("setup_stage").notNull().default("roster"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("classes_identity_uq").on(
    table.schoolNormalized,
    table.schoolYear,
    table.grade,
    table.classNumber,
  ),
  index("classes_teacher_idx").on(table.teacherId),
]);

export const students = sqliteTable("students", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  studentNumber: integer("student_number").notNull(),
  officialName: text("official_name").notNull(),
  passwordHash: text("password_hash"),
  status: text("status").notNull().default("pending"),
  qrGeneration: integer("qr_generation").notNull().default(0),
  activatedAt: integer("activated_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("students_class_number_uq").on(table.classId, table.studentNumber),
  index("students_class_idx").on(table.classId),
]);

export const registrationTokens = sqliteTable("registration_tokens", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => students.id),
  tokenHash: text("token_hash").notNull(),
  purpose: text("purpose").notNull(),
  generation: integer("generation").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("registration_tokens_hash_uq").on(table.tokenHash),
  index("registration_tokens_student_idx").on(table.studentId),
]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  actorType: text("actor_type").notNull(),
  teacherId: text("teacher_id"),
  studentId: text("student_id"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
}, (table) => [
  uniqueIndex("sessions_hash_uq").on(table.tokenHash),
  index("sessions_teacher_idx").on(table.teacherId),
  index("sessions_student_idx").on(table.studentId),
]);

export const teacherPasswordResets = sqliteTable("teacher_password_resets", {
  id: text("id").primaryKey(),
  teacherId: text("teacher_id").notNull().references(() => teachers.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("teacher_password_resets_hash_uq").on(table.tokenHash),
  index("teacher_password_resets_teacher_idx").on(table.teacherId),
]);

export const loginThrottles = sqliteTable("login_throttles", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  windowStartedAt: integer("window_started_at").notNull(),
  blockedUntil: integer("blocked_until"),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  teacherId: text("teacher_id"),
  classId: text("class_id"),
  studentId: text("student_id"),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("audit_logs_teacher_idx").on(table.teacherId),
  index("audit_logs_class_idx").on(table.classId),
]);

export const schools = sqliteTable("schools", {
  id: text("id").primaryKey(),
  officeCode: text("office_code").notNull(),
  schoolCode: text("school_code").notNull(),
  officialName: text("official_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  searchName: text("search_name").notNull(),
  schoolLevel: text("school_level").notNull(),
  provinceName: text("province_name").notNull(),
  districtName: text("district_name"),
  roadAddress: text("road_address"),
  status: text("status").notNull().default("active"),
  source: text("source").notNull().default("neis"),
  sourceUpdatedAt: integer("source_updated_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("schools_office_school_uq").on(table.officeCode, table.schoolCode),
  index("schools_normalized_idx").on(table.normalizedName),
  index("schools_search_idx").on(table.searchName),
  index("schools_filters_idx").on(table.provinceName, table.schoolLevel, table.status),
]);

export const schoolAliases = sqliteTable("school_aliases", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schools.id),
  alias: text("alias").notNull(),
  normalizedAlias: text("normalized_alias").notNull(),
  aliasType: text("alias_type").notNull(),
}, (table) => [
  uniqueIndex("school_aliases_school_normalized_uq").on(table.schoolId, table.normalizedAlias),
  index("school_aliases_normalized_idx").on(table.normalizedAlias),
]);

export const schoolManualRequests = sqliteTable("school_manual_requests", {
  id: text("id").primaryKey(),
  submittedByTeacherId: text("submitted_by_teacher_id").notNull().references(() => teachers.id),
  enteredName: text("entered_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  provinceName: text("province_name").notNull(),
  schoolLevel: text("school_level").notNull(),
  districtOrAddress: text("district_or_address"),
  note: text("note"),
  status: text("status").notNull().default("pending"),
  linkedSchoolId: text("linked_school_id").references(() => schools.id),
  createdAt: integer("created_at").notNull(),
  reviewedAt: integer("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
}, (table) => [
  index("school_manual_requests_teacher_idx").on(table.submittedByTeacherId),
  index("school_manual_requests_lookup_idx").on(table.normalizedName, table.provinceName, table.status),
]);

export const teacherEmailVerifications = sqliteTable("teacher_email_verifications", {
  id: text("id").primaryKey(),
  teacherId: text("teacher_id").notNull().references(() => teachers.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  invalidatedAt: integer("invalidated_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("teacher_email_verifications_hash_uq").on(table.tokenHash),
  index("teacher_email_verifications_teacher_idx").on(table.teacherId, table.createdAt),
]);

export const teacherInviteCodes = sqliteTable("teacher_invite_codes", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull(),
  status: text("status").notNull().default("active"),
  issuedBy: text("issued_by").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  usedByTeacherId: text("used_by_teacher_id").references(() => teachers.id),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
  memo: text("memo"),
}, (table) => [
  uniqueIndex("teacher_invite_codes_hash_uq").on(table.codeHash),
  index("teacher_invite_codes_status_idx").on(table.status, table.expiresAt),
]);

export const jobTemplates = sqliteTable("job_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  shortDescription: text("short_description").notNull(),
  detailedTasks: text("detailed_tasks").notNull(),
  category: text("category").notNull(),
  recommendedMinMembers: integer("recommended_min_members").notNull(),
  recommendedMaxMembers: integer("recommended_max_members").notNull(),
  iconKey: text("icon_key").notNull(),
  defaultPriority: integer("default_priority").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
}, (table) => [
  index("job_templates_category_idx").on(table.category),
]);

export const classJobSetup = sqliteTable("class_job_setup", {
  classId: text("class_id").primaryKey().references(() => classes.id),
  status: text("status").notNull().default("not_started"),
  setupMode: text("setup_mode"),
  surveyAnswers: text("survey_answers"),
  draftJobs: text("draft_jobs"),
  studentCountSnapshot: integer("student_count_snapshot").notNull().default(0),
  selectedJobCount: integer("selected_job_count").notNull().default(0),
  selectedCapacity: integer("selected_capacity").notNull().default(0),
  lastStep: integer("last_step").notNull().default(1),
  revision: integer("revision").notNull().default(0),
  completedAt: integer("completed_at"),
  updatedAt: integer("updated_at").notNull(),
});

export const classJobs = sqliteTable("class_jobs", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  templateId: text("template_id").references(() => jobTemplates.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  memberCapacity: integer("member_capacity").notNull(),
  category: text("category").notNull(),
  source: text("source").notNull(),
  sortOrder: integer("sort_order").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("class_jobs_class_idx").on(table.classId),
  index("class_jobs_template_idx").on(table.templateId),
]);

export const classJobAssignmentPeriods = sqliteTable("class_job_assignment_periods", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  assignmentYear: integer("assignment_year").notNull(),
  assignmentMonth: integer("assignment_month").notNull(),
  assignmentType: text("assignment_type").notNull().default("initial"),
  mode: text("mode"),
  status: text("status").notNull().default("draft"),
  calendarRevision: integer("calendar_revision"),
  firstJobStartDate: text("first_job_start_date"),
  firstJobEndDate: text("first_job_end_date"),
  confirmedAt: integer("confirmed_at"),
  confirmedByTeacherId: text("confirmed_by_teacher_id").references(() => teachers.id),
  revision: integer("revision").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("class_job_assignment_periods_period_uq").on(
    table.classId,
    table.assignmentYear,
    table.assignmentMonth,
    table.assignmentType,
  ),
  index("class_job_assignment_periods_class_idx").on(table.classId),
]);

export const studentJobAssignments = sqliteTable("student_job_assignments", {
  id: text("id").primaryKey(),
  periodId: text("period_id").notNull().references(() => classJobAssignmentPeriods.id),
  classId: text("class_id").notNull().references(() => classes.id),
  classJobId: text("class_job_id").notNull().references(() => classJobs.id),
  studentId: text("student_id").notNull().references(() => students.id),
  assignmentMethod: text("assignment_method").notNull(),
  requestId: text("request_id"),
  assignmentSequence: integer("assignment_sequence").notNull().default(0),
  assignedAt: integer("assigned_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("student_job_assignments_period_student_uq").on(table.periodId, table.studentId),
  uniqueIndex("student_job_assignments_period_request_uq").on(table.periodId, table.requestId),
  index("student_job_assignments_period_job_idx").on(table.periodId, table.classJobId),
  index("student_job_assignments_class_idx").on(table.classId),
]);

export const classJobEvaluationSessions = sqliteTable("class_job_evaluation_sessions", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  sourcePeriodId: text("source_period_id").notNull().references(() => classJobAssignmentPeriods.id),
  sourceYear: integer("source_year").notNull(),
  sourceMonth: integer("source_month").notNull(),
  status: text("status").notNull().default("open"),
  jobsJson: text("jobs_json").notNull(),
  studentIdsJson: text("student_ids_json").notNull(),
  studentCountSnapshot: integer("student_count_snapshot").notNull(),
  jobCountSnapshot: integer("job_count_snapshot").notNull(),
  sourcePeriodRevision: integer("source_period_revision").notNull(),
  jobSetupRevision: integer("job_setup_revision").notNull(),
  revision: integer("revision").notNull().default(0),
  responseRevision: integer("response_revision").notNull().default(0),
  calculatedResponseRevision: integer("calculated_response_revision"),
  algorithmVersion: text("algorithm_version").notNull().default("legacy-rank-v1"),
  finalGradesJson: text("final_grades_json"),
  openedByTeacherId: text("opened_by_teacher_id").notNull().references(() => teachers.id),
  openedAt: integer("opened_at").notNull(),
  closedByTeacherId: text("closed_by_teacher_id").references(() => teachers.id),
  closedAt: integer("closed_at"),
  finalizedByTeacherId: text("finalized_by_teacher_id").references(() => teachers.id),
  finalizedAt: integer("finalized_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("class_job_evaluation_sessions_source_uq").on(table.sourcePeriodId),
  index("class_job_evaluation_sessions_class_idx").on(table.classId, table.updatedAt),
]);

export const classJobEvaluationResponses = sqliteTable("class_job_evaluation_responses", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => classJobEvaluationSessions.id),
  classId: text("class_id").notNull().references(() => classes.id),
  studentId: text("student_id").notNull().references(() => students.id),
  studentNumber: integer("student_number").notNull(),
  studentName: text("student_name").notNull(),
  scoresJson: text("scores_json").notNull(),
  revision: integer("revision").notNull().default(1),
  requestId: text("request_id").notNull(),
  writeNonce: text("write_nonce").notNull(),
  submittedAt: integer("submitted_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("class_job_evaluation_responses_student_uq").on(table.sessionId, table.studentId),
  uniqueIndex("class_job_evaluation_responses_request_uq").on(table.sessionId, table.requestId),
  index("class_job_evaluation_responses_session_idx").on(table.sessionId, table.submittedAt),
  index("class_job_evaluation_responses_class_idx").on(table.classId),
]);

export const classJobEvaluationResults = sqliteTable("class_job_evaluation_results", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => classJobEvaluationSessions.id),
  classId: text("class_id").notNull().references(() => classes.id),
  classJobId: text("class_job_id").notNull(),
  jobName: text("job_name").notNull(),
  hardAverage: real("hard_average").notNull(),
  responsibilityAverage: real("responsibility_average").notNull(),
  consistencyAverage: real("consistency_average").notNull(),
  burdenAverage: real("burden_average").notNull(),
  totalAverage: real("total_average").notNull(),
  responseCount: integer("response_count").notNull(),
  rank: integer("rank").notNull(),
  recommendedGrade: text("recommended_grade").notNull(),
  cutoffTie: integer("cutoff_tie", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("class_job_evaluation_results_job_uq").on(table.sessionId, table.classJobId),
  index("class_job_evaluation_results_session_idx").on(table.sessionId, table.rank),
  index("class_job_evaluation_results_class_idx").on(table.classId),
]);

export const classJobMonthClosures = sqliteTable("class_job_month_closures", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  sourcePeriodId: text("source_period_id").notNull().references(() => classJobAssignmentPeriods.id),
  sourceYear: integer("source_year").notNull(),
  sourceMonth: integer("source_month").notNull(),
  status: text("status").notNull().default("closed"),
  evaluationSessionId: text("evaluation_session_id").references(() => classJobEvaluationSessions.id),
  evaluationRevision: integer("evaluation_revision"),
  closedByTeacherId: text("closed_by_teacher_id").notNull().references(() => teachers.id),
  closedAt: integer("closed_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("class_job_month_closures_source_uq").on(table.sourcePeriodId),
  index("class_job_month_closures_class_idx").on(table.classId, table.closedAt),
]);

export const classJobMonthResults = sqliteTable("class_job_month_results", {
  id: text("id").primaryKey(),
  closureId: text("closure_id").notNull().references(() => classJobMonthClosures.id),
  classId: text("class_id").notNull().references(() => classes.id),
  studentId: text("student_id").notNull(),
  studentNumber: integer("student_number").notNull(),
  studentName: text("student_name").notNull(),
  classJobId: text("class_job_id").notNull(),
  jobName: text("job_name").notNull(),
  jobGrade: text("job_grade").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("class_job_month_results_student_uq").on(table.closureId, table.studentId),
  index("class_job_month_results_closure_idx").on(table.closureId, table.studentNumber),
  index("class_job_month_results_class_idx").on(table.classId),
]);

export const classJobChoiceSessions = sqliteTable("class_job_choice_sessions", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  closureId: text("closure_id").notNull().references(() => classJobMonthClosures.id),
  targetYear: integer("target_year").notNull(),
  targetMonth: integer("target_month").notNull(),
  status: text("status").notNull().default("draft"),
  orderMode: text("order_mode").notNull().default("roster"),
  orderJson: text("order_json").notNull(),
  studentCountSnapshot: integer("student_count_snapshot").notNull(),
  jobSetupRevision: integer("job_setup_revision").notNull(),
  revision: integer("revision").notNull().default(0),
  confirmedPeriodId: text("confirmed_period_id").references(() => classJobAssignmentPeriods.id),
  confirmedByTeacherId: text("confirmed_by_teacher_id").references(() => teachers.id),
  confirmedAt: integer("confirmed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("class_job_choice_sessions_closure_uq").on(table.closureId),
  uniqueIndex("class_job_choice_sessions_target_uq").on(table.classId, table.targetYear, table.targetMonth),
  index("class_job_choice_sessions_class_idx").on(table.classId, table.updatedAt),
]);

export const classCalendars = sqliteTable("class_calendars", {
  classId: text("class_id").primaryKey().references(() => classes.id),
  schoolYear: integer("school_year").notNull(),
  timeZone: text("time_zone").notNull().default("Asia/Seoul"),
  classStartDate: text("class_start_date").notNull(),
  firstJobStartDate: text("first_job_start_date").notNull(),
  firstJobEndDate: text("first_job_end_date").notNull(),
  revision: integer("revision").notNull().default(1),
  savedAt: integer("saved_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const classCalendarDays = sqliteTable("class_calendar_days", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  calendarDate: text("calendar_date").notNull(),
  dayType: text("day_type").notNull().default("class"),
  memo: text("memo"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("class_calendar_days_class_date_uq").on(table.classId, table.calendarDate),
  index("class_calendar_days_class_idx").on(table.classId),
]);

export const jobAssignmentCandidates = sqliteTable("job_assignment_candidates", {
  id: text("id").primaryKey(),
  periodId: text("period_id").notNull().references(() => classJobAssignmentPeriods.id),
  classJobId: text("class_job_id").notNull().references(() => classJobs.id),
  studentId: text("student_id").notNull().references(() => students.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("job_assignment_candidates_period_job_student_uq").on(
    table.periodId,
    table.classJobId,
    table.studentId,
  ),
  index("job_assignment_candidates_period_idx").on(table.periodId),
]);

export const systemAdminSessions = sqliteTable("system_admin_sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  csrfHash: text("csrf_hash").notNull(),
  adminKey: text("admin_key").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  revokedAt: integer("revoked_at"),
}, (table) => [
  uniqueIndex("system_admin_sessions_token_uq").on(table.tokenHash),
  index("system_admin_sessions_admin_idx").on(table.adminKey),
]);

export const serviceAnnouncements = sqliteTable("service_announcements", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audience: text("audience").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("service_announcements_active_idx").on(table.isActive, table.audience),
]);

export const systemAdminAuditLogs = sqliteTable("system_admin_audit_logs", {
  id: text("id").primaryKey(),
  adminKey: text("admin_key").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  success: integer("success", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("system_admin_audit_created_idx").on(table.createdAt),
  index("system_admin_audit_target_idx").on(table.targetType, table.targetId),
]);

export const financeAccounts = sqliteTable("finance_accounts", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  studentId: text("student_id").references(() => students.id),
  accountType: text("account_type").notNull(),
  balance: integer("balance").notNull().default(0),
  allowNegative: integer("allow_negative", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("active"),
  revision: integer("revision").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("finance_accounts_class_student_type_uq").on(
    table.classId,
    table.studentId,
    table.accountType,
  ),
  uniqueIndex("finance_accounts_class_issuance_uq")
    .on(table.classId)
    .where(sql`${table.accountType} = 'class_issuance'`),
  uniqueIndex("finance_accounts_id_class_uq").on(table.id, table.classId),
  index("finance_accounts_class_type_idx").on(
    table.classId,
    table.accountType,
    table.status,
  ),
  index("finance_accounts_student_idx").on(table.studentId),
  check("finance_accounts_status_ck", sql`${table.status} IN ('active', 'frozen', 'closed')`),
  check(
    "finance_accounts_type_ck",
    sql`${table.accountType} IN ('student_wallet', 'class_issuance')`,
  ),
  check("finance_accounts_revision_ck", sql`${table.revision} >= 0`),
  check("finance_accounts_allow_negative_ck", sql`${table.allowNegative} IN (0, 1)`),
  check(
    "finance_accounts_balance_ck",
    sql`${table.allowNegative} = 1 OR ${table.balance} >= 0`,
  ),
  check(
    "finance_accounts_student_wallet_ck",
    sql`${table.accountType} <> 'student_wallet'
      OR (${table.studentId} IS NOT NULL AND ${table.allowNegative} = 0)`,
  ),
  check(
    "finance_accounts_class_issuance_ck",
    sql`${table.accountType} <> 'class_issuance'
      OR (${table.studentId} IS NULL AND ${table.allowNegative} = 1)`,
  ),
]);

export const financeTransactions = sqliteTable("finance_transactions", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  status: text("status").notNull().default("pending"),
  transactionType: text("transaction_type").notNull(),
  description: text("description").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  reversalOfTransactionId: text("reversal_of_transaction_id"),
  actorType: text("actor_type").notNull(),
  actorTeacherId: text("actor_teacher_id").references(() => teachers.id),
  actorStudentId: text("actor_student_id").references(() => students.id),
  actorJobPeriodId: text("actor_job_period_id").references(() => classJobAssignmentPeriods.id),
  actorLabel: text("actor_label").notNull(),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull(),
  postedAt: integer("posted_at"),
}, (table) => [
  uniqueIndex("finance_transactions_class_idempotency_uq").on(
    table.classId,
    table.idempotencyKey,
  ),
  uniqueIndex("finance_transactions_class_source_uq").on(
    table.classId,
    table.sourceType,
    table.sourceId,
  ),
  uniqueIndex("finance_transactions_reversal_uq").on(table.reversalOfTransactionId),
  uniqueIndex("finance_transactions_id_class_uq").on(table.id, table.classId),
  index("finance_transactions_class_posted_idx").on(
    table.classId,
    table.status,
    table.postedAt,
  ),
  index("finance_transactions_actor_student_idx").on(table.actorStudentId, table.postedAt),
  check("finance_transactions_status_ck", sql`${table.status} IN ('pending', 'posted')`),
  check(
    "finance_transactions_source_ck",
    sql`(${table.sourceType} IS NULL) = (${table.sourceId} IS NULL)`,
  ),
  check(
    "finance_transactions_reversal_ck",
    sql`(${table.transactionType} = 'reversal') = (${table.reversalOfTransactionId} IS NOT NULL)`,
  ),
  check(
    "finance_transactions_actor_ck",
    sql`(
      (${table.actorType} = 'teacher'
        AND ${table.actorTeacherId} IS NOT NULL
        AND ${table.actorStudentId} IS NULL
        AND ${table.actorJobPeriodId} IS NULL)
      OR
      (${table.actorType} = 'banker'
        AND ${table.actorTeacherId} IS NULL
        AND ${table.actorStudentId} IS NOT NULL
        AND ${table.actorJobPeriodId} IS NOT NULL)
      OR
      (${table.actorType} = 'system'
        AND ${table.actorTeacherId} IS NULL
        AND ${table.actorStudentId} IS NULL
        AND ${table.actorJobPeriodId} IS NULL)
    )`,
  ),
]);

export const financeLedgerEntries = sqliteTable("finance_ledger_entries", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull(),
  classId: text("class_id").notNull(),
  accountId: text("account_id").notNull(),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  accountRevisionAfter: integer("account_revision_after").notNull(),
  memo: text("memo"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("finance_ledger_entries_transaction_account_uq").on(
    table.transactionId,
    table.accountId,
  ),
  index("finance_ledger_entries_account_idx").on(table.accountId, table.createdAt),
  index("finance_ledger_entries_class_idx").on(table.classId, table.createdAt),
  foreignKey({
    columns: [table.transactionId, table.classId],
    foreignColumns: [financeTransactions.id, financeTransactions.classId],
    name: "finance_ledger_entries_transaction_class_fk",
  }),
  foreignKey({
    columns: [table.accountId, table.classId],
    foreignColumns: [financeAccounts.id, financeAccounts.classId],
    name: "finance_ledger_entries_account_class_fk",
  }),
  check("finance_ledger_entries_amount_ck", sql`${table.amount} <> 0`),
  check(
    "finance_ledger_entries_revision_ck",
    sql`${table.accountRevisionAfter} > 0`,
  ),
]);

export const financeCashRequests = sqliteTable("finance_cash_requests", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  requesterStudentId: text("requester_student_id").notNull().references(() => students.id),
  walletAccountId: text("wallet_account_id").notNull(),
  requestType: text("request_type").notNull(),
  amount: integer("amount").notNull(),
  memo: text("memo"),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  studentNumberSnapshot: integer("student_number_snapshot").notNull(),
  studentNameSnapshot: text("student_name_snapshot").notNull(),
  walletBalanceSnapshot: integer("wallet_balance_snapshot").notNull(),
  walletRevisionSnapshot: integer("wallet_revision_snapshot").notNull(),
  revision: integer("revision").notNull().default(0),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("finance_cash_requests_class_student_idempotency_uq").on(
    table.classId,
    table.requesterStudentId,
    table.idempotencyKey,
  ),
  uniqueIndex("finance_cash_requests_id_class_uq").on(table.id, table.classId),
  index("finance_cash_requests_class_created_idx").on(table.classId, table.createdAt),
  index("finance_cash_requests_student_created_idx").on(
    table.requesterStudentId,
    table.createdAt,
  ),
  foreignKey({
    columns: [table.walletAccountId, table.classId],
    foreignColumns: [financeAccounts.id, financeAccounts.classId],
    name: "finance_cash_requests_wallet_class_fk",
  }),
  check(
    "finance_cash_requests_type_ck",
    sql`${table.requestType} IN ('deposit', 'withdrawal')`,
  ),
  check(
    "finance_cash_requests_amount_ck",
    sql`${table.amount} > 0 AND ${table.amount} <= 1000000000`,
  ),
  check(
    "finance_cash_requests_wallet_snapshot_ck",
    sql`${table.walletBalanceSnapshot} >= 0 AND ${table.walletRevisionSnapshot} >= 0`,
  ),
  check("finance_cash_requests_revision_ck", sql`${table.revision} >= 0`),
]);

export const financeRequestResolutions = sqliteTable("finance_request_resolutions", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  classId: text("class_id").notNull(),
  decision: text("decision").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  expectedRequestRevision: integer("expected_request_revision").notNull(),
  actorType: text("actor_type").notNull(),
  actorTeacherId: text("actor_teacher_id").references(() => teachers.id),
  actorStudentId: text("actor_student_id").references(() => students.id),
  actorJobPeriodId: text("actor_job_period_id").references(() => classJobAssignmentPeriods.id),
  actorLabel: text("actor_label").notNull(),
  reasonCode: text("reason_code"),
  reasonNote: text("reason_note"),
  interventionReason: text("intervention_reason"),
  isEmergency: integer("is_emergency", { mode: "boolean" }).notNull().default(false),
  postedTransactionId: text("posted_transaction_id"),
  transactionPayloadHash: text("transaction_payload_hash"),
  resolvedAt: integer("resolved_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("finance_request_resolutions_request_uq").on(table.requestId),
  uniqueIndex("finance_request_resolutions_class_idempotency_uq").on(
    table.classId,
    table.idempotencyKey,
  ),
  uniqueIndex("finance_request_resolutions_posted_transaction_uq")
    .on(table.postedTransactionId)
    .where(sql`${table.postedTransactionId} IS NOT NULL`),
  index("finance_request_resolutions_class_resolved_idx").on(
    table.classId,
    table.resolvedAt,
  ),
  index("finance_request_resolutions_actor_student_idx").on(
    table.actorStudentId,
    table.resolvedAt,
  ),
  foreignKey({
    columns: [table.requestId, table.classId],
    foreignColumns: [financeCashRequests.id, financeCashRequests.classId],
    name: "finance_request_resolutions_request_class_fk",
  }),
  foreignKey({
    columns: [table.postedTransactionId, table.classId],
    foreignColumns: [financeTransactions.id, financeTransactions.classId],
    name: "finance_request_resolutions_transaction_class_fk",
  }),
  check(
    "finance_request_resolutions_decision_ck",
    sql`${table.decision} IN ('approved', 'rejected', 'cancelled')`,
  ),
  check(
    "finance_request_resolutions_actor_ck",
    sql`(
      (${table.actorType} = 'banker'
        AND ${table.actorTeacherId} IS NULL
        AND ${table.actorStudentId} IS NOT NULL
        AND ${table.actorJobPeriodId} IS NOT NULL
        AND ${table.isEmergency} = 0)
      OR
      (${table.actorType} = 'teacher'
        AND ${table.actorTeacherId} IS NOT NULL
        AND ${table.actorStudentId} IS NULL
        AND ${table.actorJobPeriodId} IS NULL
        AND ${table.isEmergency} = 1)
      OR
      (${table.actorType} = 'student'
        AND ${table.actorTeacherId} IS NULL
        AND ${table.actorStudentId} IS NOT NULL
        AND ${table.actorJobPeriodId} IS NULL
        AND ${table.isEmergency} = 0)
    )`,
  ),
  check(
    "finance_request_resolutions_transaction_ck",
    sql`(
      (${table.decision} = 'approved'
        AND ${table.postedTransactionId} IS NOT NULL
        AND ${table.transactionPayloadHash} IS NOT NULL)
      OR
      (${table.decision} IN ('rejected', 'cancelled')
        AND ${table.postedTransactionId} IS NULL
        AND ${table.transactionPayloadHash} IS NULL)
    )`,
  ),
  check(
    "finance_request_resolutions_note_ck",
    sql`(${table.decision} <> 'rejected'
        OR LENGTH(TRIM(COALESCE(${table.reasonCode}, ''))) > 0
        OR LENGTH(TRIM(COALESCE(${table.reasonNote}, ''))) > 0)
      AND (${table.actorType} <> 'teacher'
        OR LENGTH(TRIM(COALESCE(${table.interventionReason}, ''))) > 0)`,
  ),
  check(
    "finance_request_resolutions_expected_revision_ck",
    sql`${table.expectedRequestRevision} >= 0`,
  ),
]);

export const financeSettings = sqliteTable("finance_settings", {
  classId: text("class_id").primaryKey().references(() => classes.id),
  currencyName: text("currency_name").notNull().default("우리 반 화폐"),
  currencyUnit: text("currency_unit").notNull().default("학급화폐"),
  denominationsJson: text("denominations_json").notNull().default("[100,500,1000,5000]"),
  bankOpen: integer("bank_open", { mode: "boolean" }).notNull().default(true),
  depositEnabled: integer("deposit_enabled", { mode: "boolean" }).notNull().default(true),
  withdrawalEnabled: integer("withdrawal_enabled", { mode: "boolean" }).notNull().default(true),
  bankerProcessingEnabled: integer("banker_processing_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  maxRequestAmount: integer("max_request_amount").notNull().default(100000),
  revision: integer("revision").notNull().default(0),
  updatedByTeacherId: text("updated_by_teacher_id").references(() => teachers.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("finance_settings_updated_by_idx").on(table.updatedByTeacherId),
  check(
    "finance_settings_text_ck",
    sql`LENGTH(TRIM(${table.currencyName})) BETWEEN 1 AND 30
      AND LENGTH(TRIM(${table.currencyUnit})) BETWEEN 1 AND 10`,
  ),
  check(
    "finance_settings_boolean_ck",
    sql`${table.bankOpen} IN (0, 1)
      AND ${table.depositEnabled} IN (0, 1)
      AND ${table.withdrawalEnabled} IN (0, 1)
      AND ${table.bankerProcessingEnabled} IN (0, 1)`,
  ),
  check(
    "finance_settings_amount_ck",
    sql`${table.maxRequestAmount} BETWEEN 1 AND 1000000000`,
  ),
  check("finance_settings_revision_ck", sql`${table.revision} >= 0`),
  check(
    "finance_settings_actor_ck",
    sql`(${table.revision} = 0 AND ${table.updatedByTeacherId} IS NULL)
      OR (${table.revision} > 0 AND ${table.updatedByTeacherId} IS NOT NULL)`,
  ),
]);

export const financeSettingRevisions = sqliteTable("finance_setting_revisions", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  revision: integer("revision").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  previousSettingsJson: text("previous_settings_json").notNull(),
  settingsJson: text("settings_json").notNull(),
  changeReason: text("change_reason").notNull(),
  actorTeacherId: text("actor_teacher_id").notNull().references(() => teachers.id),
  actorLabel: text("actor_label").notNull().default("교사"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("finance_setting_revisions_class_revision_uq").on(
    table.classId,
    table.revision,
  ),
  uniqueIndex("finance_setting_revisions_class_idempotency_uq").on(
    table.classId,
    table.idempotencyKey,
  ),
  index("finance_setting_revisions_class_created_idx").on(
    table.classId,
    table.createdAt,
  ),
  check("finance_setting_revisions_revision_ck", sql`${table.revision} > 0`),
  check(
    "finance_setting_revisions_reason_ck",
    sql`LENGTH(TRIM(${table.changeReason})) BETWEEN 2 AND 300`,
  ),
]);
