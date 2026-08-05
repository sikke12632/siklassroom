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
  credentialRevision: integer("credential_revision").notNull().default(0),
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
  credentialRevision: integer("credential_revision").notNull().default(0),
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
  uniqueIndex("registration_tokens_student_generation_uq")
    .on(table.studentId, table.generation)
    .where(sql`${table.revokedAt} IS NULL`),
]);

export const studentQrResetGrants = sqliteTable("student_qr_reset_grants", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => students.id),
  qrGeneration: integer("qr_generation").notNull(),
  issuedByTeacherId: text("issued_by_teacher_id").notNull().references(() => teachers.id),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("student_qr_reset_grants_student_idx").on(table.studentId, table.expiresAt),
  uniqueIndex("student_qr_reset_grants_open_uq")
    .on(table.studentId)
    .where(sql`${table.usedAt} IS NULL AND ${table.revokedAt} IS NULL`),
]);

export const registrationChallenges = sqliteTable("registration_challenges", {
  id: text("id").primaryKey(),
  registrationTokenId: text("registration_token_id").notNull().references(() => registrationTokens.id),
  studentId: text("student_id").notNull().references(() => students.id),
  qrGeneration: integer("qr_generation").notNull(),
  credentialRevisionSnapshot: integer("credential_revision_snapshot").notNull(),
  challengeHash: text("challenge_hash").notNull(),
  mode: text("mode").notNull(),
  resetGrantId: text("reset_grant_id").references(() => studentQrResetGrants.id),
  expiresAt: integer("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  usedAt: integer("used_at"),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("registration_challenges_hash_uq").on(table.challengeHash),
  index("registration_challenges_student_idx").on(table.studentId, table.expiresAt),
]);

export const registrationOperationGuards = sqliteTable("registration_operation_guards", {
  id: text("id").primaryKey().notNull(),
  operation: text("operation").notNull(),
  createdAt: integer("created_at").notNull(),
});

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
  index("finance_cash_requests_wallet_pending_idx").on(
    table.classId,
    table.walletAccountId,
    table.requestType,
    table.createdAt,
  ),
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

export const financeDepositProducts = sqliteTable("finance_deposit_products", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  termWeeks: integer("term_weeks").notNull(),
  maturityInterestBps: integer("maturity_interest_bps").notNull(),
  earlyInterestBps: integer("early_interest_bps").notNull().default(0),
  minAmount: integer("min_amount").notNull(),
  maxAmount: integer("max_amount").notNull(),
  isOpen: integer("is_open", { mode: "boolean" }).notNull().default(true),
  revision: integer("revision").notNull().default(0),
  createdByTeacherId: text("created_by_teacher_id").notNull().references(() => teachers.id),
  updatedByTeacherId: text("updated_by_teacher_id").notNull().references(() => teachers.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("finance_deposit_products_id_class_uq").on(table.id, table.classId),
  index("finance_deposit_products_class_open_idx").on(
    table.classId,
    table.isOpen,
    table.createdAt,
  ),
  check(
    "finance_deposit_products_text_ck",
    sql`LENGTH(TRIM(${table.name})) BETWEEN 1 AND 40
      AND LENGTH(${table.description}) <= 200`,
  ),
  check(
    "finance_deposit_products_term_ck",
    sql`${table.termWeeks} BETWEEN 1 AND 52`,
  ),
  check(
    "finance_deposit_products_rate_ck",
    sql`${table.maturityInterestBps} BETWEEN 0 AND 10000
      AND ${table.earlyInterestBps} BETWEEN 0 AND 10000`,
  ),
  check(
    "finance_deposit_products_amount_ck",
    sql`${table.minAmount} BETWEEN 1 AND 1000000000
      AND ${table.maxAmount} BETWEEN ${table.minAmount} AND 1000000000`,
  ),
  check("finance_deposit_products_open_ck", sql`${table.isOpen} IN (0, 1)`),
  check("finance_deposit_products_revision_ck", sql`${table.revision} >= 0`),
]);

export const financeDepositProductEvents = sqliteTable("finance_deposit_product_events", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull(),
  productId: text("product_id").notNull(),
  revision: integer("revision").notNull(),
  action: text("action").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  productSnapshotJson: text("product_snapshot_json").notNull(),
  actorTeacherId: text("actor_teacher_id").notNull().references(() => teachers.id),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("finance_deposit_product_events_product_revision_uq").on(
    table.productId,
    table.revision,
  ),
  uniqueIndex("finance_deposit_product_events_class_idempotency_uq").on(
    table.classId,
    table.idempotencyKey,
  ),
  index("finance_deposit_product_events_class_created_idx").on(
    table.classId,
    table.createdAt,
  ),
  foreignKey({
    columns: [table.productId, table.classId],
    foreignColumns: [financeDepositProducts.id, financeDepositProducts.classId],
    name: "finance_deposit_product_events_product_class_fk",
  }),
  check(
    "finance_deposit_product_events_action_ck",
    sql`${table.action} IN ('issued', 'opened', 'paused')`,
  ),
  check("finance_deposit_product_events_revision_ck", sql`${table.revision} >= 0`),
]);

export const financeDepositContracts = sqliteTable("finance_deposit_contracts", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  productId: text("product_id").notNull(),
  productRevision: integer("product_revision").notNull(),
  studentId: text("student_id").notNull().references(() => students.id),
  walletAccountId: text("wallet_account_id").notNull(),
  principal: integer("principal").notNull(),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  termWeeksSnapshot: integer("term_weeks_snapshot").notNull(),
  maturityInterestBpsSnapshot: integer("maturity_interest_bps_snapshot").notNull(),
  earlyInterestBpsSnapshot: integer("early_interest_bps_snapshot").notNull(),
  maturityInterest: integer("maturity_interest").notNull(),
  earlyInterest: integer("early_interest").notNull(),
  maturityPayout: integer("maturity_payout").notNull(),
  earlyPayout: integer("early_payout").notNull(),
  openedAt: integer("opened_at").notNull(),
  maturesAt: integer("matures_at").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  postedTransactionId: text("posted_transaction_id").notNull(),
  transactionPayloadHash: text("transaction_payload_hash").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("finance_deposit_contracts_id_class_uq").on(table.id, table.classId),
  uniqueIndex("finance_deposit_contracts_class_student_idempotency_uq").on(
    table.classId,
    table.studentId,
    table.idempotencyKey,
  ),
  uniqueIndex("finance_deposit_contracts_posted_transaction_uq").on(
    table.postedTransactionId,
  ),
  index("finance_deposit_contracts_student_created_idx").on(
    table.studentId,
    table.createdAt,
  ),
  index("finance_deposit_contracts_class_maturity_idx").on(
    table.classId,
    table.maturesAt,
  ),
  index("finance_deposit_contracts_maturity_idx").on(
    table.maturesAt,
    table.id,
  ),
  foreignKey({
    columns: [table.productId, table.classId],
    foreignColumns: [financeDepositProducts.id, financeDepositProducts.classId],
    name: "finance_deposit_contracts_product_class_fk",
  }),
  foreignKey({
    columns: [table.walletAccountId, table.classId],
    foreignColumns: [financeAccounts.id, financeAccounts.classId],
    name: "finance_deposit_contracts_wallet_class_fk",
  }),
  foreignKey({
    columns: [table.postedTransactionId, table.classId],
    foreignColumns: [financeTransactions.id, financeTransactions.classId],
    name: "finance_deposit_contracts_transaction_class_fk",
  }),
  check(
    "finance_deposit_contracts_amount_ck",
    sql`${table.principal} BETWEEN 1 AND 1000000000
      AND ${table.maturityInterest} BETWEEN 0 AND 1000000000
      AND ${table.earlyInterest} BETWEEN 0 AND ${table.maturityInterest}
      AND ${table.maturityPayout} = ${table.principal} + ${table.maturityInterest}
      AND ${table.earlyPayout} = ${table.principal} + ${table.earlyInterest}
      AND ${table.maturityPayout} <= 1000000000`,
  ),
  check(
    "finance_deposit_contracts_terms_ck",
    sql`${table.productRevision} >= 0
      AND ${table.termWeeksSnapshot} BETWEEN 1 AND 52
      AND ${table.maturityInterestBpsSnapshot} BETWEEN 0 AND 10000
      AND ${table.earlyInterestBpsSnapshot} BETWEEN 0 AND 10000
      AND ${table.maturesAt} > ${table.openedAt}`,
  ),
]);

export const financeDepositMaturityRetries = sqliteTable(
  "finance_deposit_maturity_retries",
  {
    contractId: text("contract_id").primaryKey(),
    classId: text("class_id").notNull().references(() => classes.id),
    attemptCount: integer("attempt_count").notNull().default(1),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    lastErrorCode: text("last_error_code").notNull(),
    lastFailedAt: integer("last_failed_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("finance_deposit_maturity_retries_next_attempt_idx").on(
      table.nextAttemptAt,
      table.contractId,
    ),
    index("finance_deposit_maturity_retries_class_idx").on(
      table.classId,
      table.nextAttemptAt,
    ),
    foreignKey({
      columns: [table.contractId, table.classId],
      foreignColumns: [financeDepositContracts.id, financeDepositContracts.classId],
      name: "finance_deposit_maturity_retries_contract_class_fk",
    }),
    check(
      "finance_deposit_maturity_retries_attempt_ck",
      sql`${table.attemptCount} BETWEEN 1 AND 1000000`,
    ),
    check(
      "finance_deposit_maturity_retries_timing_ck",
      sql`${table.nextAttemptAt} >= ${table.lastFailedAt}
        AND ${table.lastFailedAt} >= 0
        AND ${table.createdAt} >= 0
        AND ${table.updatedAt} >= ${table.createdAt}`,
    ),
    check(
      "finance_deposit_maturity_retries_error_ck",
      sql`LENGTH(TRIM(${table.lastErrorCode})) BETWEEN 1 AND 100`,
    ),
  ],
);

export const financeDepositSettlements = sqliteTable("finance_deposit_settlements", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  contractId: text("contract_id").notNull(),
  studentId: text("student_id").notNull().references(() => students.id),
  settlementType: text("settlement_type").notNull(),
  principal: integer("principal").notNull(),
  interest: integer("interest").notNull(),
  payout: integer("payout").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  postedTransactionId: text("posted_transaction_id").notNull(),
  transactionPayloadHash: text("transaction_payload_hash").notNull(),
  settledAt: integer("settled_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("finance_deposit_settlements_contract_uq").on(table.contractId),
  uniqueIndex("finance_deposit_settlements_class_student_idempotency_uq").on(
    table.classId,
    table.studentId,
    table.idempotencyKey,
  ),
  uniqueIndex("finance_deposit_settlements_posted_transaction_uq").on(
    table.postedTransactionId,
  ),
  index("finance_deposit_settlements_class_created_idx").on(
    table.classId,
    table.createdAt,
  ),
  foreignKey({
    columns: [table.contractId, table.classId],
    foreignColumns: [financeDepositContracts.id, financeDepositContracts.classId],
    name: "finance_deposit_settlements_contract_class_fk",
  }),
  foreignKey({
    columns: [table.postedTransactionId, table.classId],
    foreignColumns: [financeTransactions.id, financeTransactions.classId],
    name: "finance_deposit_settlements_transaction_class_fk",
  }),
  check(
    "finance_deposit_settlements_type_ck",
    sql`${table.settlementType} IN ('early_termination', 'maturity')`,
  ),
  check(
    "finance_deposit_settlements_amount_ck",
    sql`${table.principal} BETWEEN 1 AND 1000000000
      AND ${table.interest} BETWEEN 0 AND 1000000000
      AND ${table.payout} = ${table.principal} + ${table.interest}
      AND ${table.payout} <= 1000000000`,
  ),
]);

export const financeStockMarkets = sqliteTable("finance_stock_markets", {
  classId: text("class_id").primaryKey().references(() => classes.id),
  isOpen: integer("is_open", { mode: "boolean" }).notNull().default(false),
  buyFeeBps: integer("buy_fee_bps").notNull().default(0),
  sellFeeBps: integer("sell_fee_bps").notNull().default(0),
  buySpread: integer("buy_spread").notNull().default(0),
  sellSpread: integer("sell_spread").notNull().default(0),
  marketMood: text("market_mood").notNull().default("mixed"),
  tickIntervalMinutes: integer("tick_interval_minutes").notNull().default(15),
  nextTickAt: integer("next_tick_at"),
  revision: integer("revision").notNull().default(0),
  updatedByTeacherId: text("updated_by_teacher_id").references(() => teachers.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("finance_stock_markets_due_idx").on(
    table.isOpen,
    table.nextTickAt,
    table.classId,
  ),
  check("finance_stock_markets_open_ck", sql`${table.isOpen} IN (0, 1)`),
  check(
    "finance_stock_markets_fee_ck",
    sql`${table.buyFeeBps} BETWEEN 0 AND 1000
      AND ${table.sellFeeBps} BETWEEN 0 AND 1000`,
  ),
  check(
    "finance_stock_markets_spread_ck",
    sql`${table.buySpread} BETWEEN 0 AND 1000000000
      AND ${table.sellSpread} BETWEEN 0 AND 1000000000`,
  ),
  check(
    "finance_stock_markets_mood_ck",
    sql`${table.marketMood} IN ('surge', 'bull', 'mixed', 'bear', 'crash')`,
  ),
  check(
    "finance_stock_markets_tick_ck",
    sql`${table.tickIntervalMinutes} BETWEEN 1 AND 1440
      AND (${table.nextTickAt} IS NULL OR ${table.nextTickAt} >= 0)
      AND (${table.isOpen} = 0 OR ${table.nextTickAt} IS NOT NULL)`,
  ),
  check("finance_stock_markets_revision_ck", sql`${table.revision} >= 0`),
]);

export const financeStockMarketEvents = sqliteTable("finance_stock_market_events", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => financeStockMarkets.classId),
  revision: integer("revision").notNull(),
  action: text("action").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  previousSnapshotJson: text("previous_snapshot_json"),
  marketSnapshotJson: text("market_snapshot_json").notNull(),
  actorTeacherId: text("actor_teacher_id").notNull().references(() => teachers.id),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("finance_stock_market_events_class_revision_uq").on(
    table.classId,
    table.revision,
  ),
  uniqueIndex("finance_stock_market_events_class_idempotency_uq").on(
    table.classId,
    table.idempotencyKey,
  ),
  index("finance_stock_market_events_class_created_idx").on(
    table.classId,
    table.createdAt,
  ),
  check(
    "finance_stock_market_events_action_ck",
    sql`${table.action} IN ('configured', 'opened', 'closed', 'updated')`,
  ),
  check("finance_stock_market_events_revision_ck", sql`${table.revision} > 0`),
]);

export const financeStocks = sqliteTable("finance_stocks", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  description: text("description").notNull().default(""),
  initialPrice: integer("initial_price").notNull(),
  currentPrice: integer("current_price").notNull(),
  previousPrice: integer("previous_price").notNull(),
  totalShares: integer("total_shares").notNull(),
  availableShares: integer("available_shares").notNull(),
  maxSharesPerStudent: integer("max_shares_per_student").notNull(),
  status: text("status").notNull().default("active"),
  revision: integer("revision").notNull().default(0),
  inventoryRevision: integer("inventory_revision").notNull().default(0),
  lastTradeId: text("last_trade_id"),
  createdByTeacherId: text("created_by_teacher_id").notNull().references(() => teachers.id),
  updatedByActorType: text("updated_by_actor_type").notNull().default("teacher"),
  updatedByTeacherId: text("updated_by_teacher_id").references(() => teachers.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("finance_stocks_class_uq").on(table.classId),
  uniqueIndex("finance_stocks_id_class_uq").on(table.id, table.classId),
  uniqueIndex("finance_stocks_class_symbol_uq").on(table.classId, table.symbol),
  index("finance_stocks_class_status_idx").on(table.classId, table.status),
  check(
    "finance_stocks_text_ck",
    sql`LENGTH(TRIM(${table.name})) BETWEEN 1 AND 40
      AND LENGTH(TRIM(${table.symbol})) BETWEEN 1 AND 12
      AND LENGTH(${table.description}) <= 300`,
  ),
  check(
    "finance_stocks_price_ck",
    sql`${table.initialPrice} BETWEEN 1 AND 1000000000
      AND ${table.currentPrice} BETWEEN 1 AND 1000000000
      AND ${table.previousPrice} BETWEEN 1 AND 1000000000`,
  ),
  check(
    "finance_stocks_supply_ck",
    sql`${table.totalShares} BETWEEN 1 AND 1000000000
      AND ${table.availableShares} BETWEEN 0 AND ${table.totalShares}
      AND ${table.maxSharesPerStudent} BETWEEN 1 AND ${table.totalShares}`,
  ),
  check(
    "finance_stocks_status_ck",
    sql`${table.status} IN ('active', 'sell_only', 'halted', 'archived')`,
  ),
  check(
    "finance_stocks_revision_ck",
    sql`${table.revision} >= 0 AND ${table.inventoryRevision} >= 0`,
  ),
  check(
    "finance_stocks_actor_ck",
    sql`(${table.updatedByActorType} = 'teacher'
        AND ${table.updatedByTeacherId} IS NOT NULL)
      OR (${table.updatedByActorType} = 'system'
        AND ${table.updatedByTeacherId} IS NULL)`,
  ),
]);

export const financeStockTickRetries = sqliteTable(
  "finance_stock_tick_retries",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull().references(() => financeStockMarkets.classId),
    stockId: text("stock_id").notNull(),
    stockRevision: integer("stock_revision").notNull(),
    marketRevision: integer("market_revision").notNull(),
    scheduledTickAt: integer("scheduled_tick_at").notNull(),
    attemptCount: integer("attempt_count").notNull().default(1),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    lastErrorCode: text("last_error_code").notNull(),
    lastFailedAt: integer("last_failed_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("finance_stock_tick_retries_occurrence_uq").on(
      table.classId,
      table.stockId,
      table.stockRevision,
      table.marketRevision,
      table.scheduledTickAt,
    ),
    index("finance_stock_tick_retries_next_attempt_idx").on(
      table.nextAttemptAt,
      table.classId,
    ),
    index("finance_stock_tick_retries_class_idx").on(
      table.classId,
      table.updatedAt,
    ),
    foreignKey({
      columns: [table.stockId, table.classId],
      foreignColumns: [financeStocks.id, financeStocks.classId],
      name: "finance_stock_tick_retries_stock_class_fk",
    }),
    check(
      "finance_stock_tick_retries_revision_ck",
      sql`${table.stockRevision} >= 0 AND ${table.marketRevision} >= 0`,
    ),
    check(
      "finance_stock_tick_retries_attempt_ck",
      sql`${table.attemptCount} BETWEEN 1 AND 1000000`,
    ),
    check(
      "finance_stock_tick_retries_timing_ck",
      sql`${table.scheduledTickAt} >= 0
        AND ${table.lastFailedAt} >= ${table.scheduledTickAt}
        AND ${table.nextAttemptAt} >= ${table.lastFailedAt}
        AND ${table.createdAt} >= 0
        AND ${table.updatedAt} >= ${table.createdAt}`,
    ),
    check(
      "finance_stock_tick_retries_error_ck",
      sql`LENGTH(TRIM(${table.lastErrorCode})) BETWEEN 1 AND 100`,
    ),
  ],
);

export const financeStockEvents = sqliteTable("finance_stock_events", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull(),
  stockId: text("stock_id").notNull(),
  revision: integer("revision").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  previousSnapshotJson: text("previous_snapshot_json"),
  stockSnapshotJson: text("stock_snapshot_json").notNull(),
  actorType: text("actor_type").notNull(),
  actorTeacherId: text("actor_teacher_id").references(() => teachers.id),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("finance_stock_events_stock_revision_uq").on(
    table.stockId,
    table.revision,
  ),
  uniqueIndex("finance_stock_events_class_idempotency_uq").on(
    table.classId,
    table.idempotencyKey,
  ),
  index("finance_stock_events_class_created_idx").on(table.classId, table.createdAt),
  foreignKey({
    columns: [table.stockId, table.classId],
    foreignColumns: [financeStocks.id, financeStocks.classId],
    name: "finance_stock_events_stock_class_fk",
  }),
  check(
    "finance_stock_events_action_ck",
    sql`${table.action} IN (
      'issued', 'price_changed', 'status_changed', 'automatic_tick', 'news_tick'
    )`,
  ),
  check(
    "finance_stock_events_actor_ck",
    sql`(${table.actorType} = 'teacher' AND ${table.actorTeacherId} IS NOT NULL)
      OR (${table.actorType} = 'system' AND ${table.actorTeacherId} IS NULL)`,
  ),
  check("finance_stock_events_revision_ck", sql`${table.revision} >= 0`),
  check(
    "finance_stock_events_reason_ck",
    sql`LENGTH(TRIM(${table.reason})) BETWEEN 1 AND 300`,
  ),
]);

export const financeStockNews = sqliteTable("finance_stock_news", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  impactBps: integer("impact_bps").notNull(),
  status: text("status").notNull().default("active"),
  revision: integer("revision").notNull().default(0),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  cancellationIdempotencyKey: text("cancellation_idempotency_key"),
  cancellationPayloadHash: text("cancellation_payload_hash"),
  createdByTeacherId: text("created_by_teacher_id").notNull().references(() => teachers.id),
  updatedByActorType: text("updated_by_actor_type").notNull().default("teacher"),
  updatedByTeacherId: text("updated_by_teacher_id").references(() => teachers.id),
  cancellationReason: text("cancellation_reason"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  cancelledAt: integer("cancelled_at"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("finance_stock_news_class_idempotency_uq").on(
    table.classId,
    table.idempotencyKey,
  ),
  uniqueIndex("finance_stock_news_class_cancellation_idempotency_uq")
    .on(table.classId, table.cancellationIdempotencyKey)
    .where(sql`${table.cancellationIdempotencyKey} IS NOT NULL`),
  index("finance_stock_news_class_status_idx").on(
    table.classId,
    table.status,
    table.createdAt,
  ),
  check(
    "finance_stock_news_text_ck",
    sql`LENGTH(TRIM(${table.title})) BETWEEN 1 AND 80
      AND LENGTH(TRIM(${table.content})) BETWEEN 1 AND 500`,
  ),
  check(
    "finance_stock_news_impact_ck",
    sql`${table.impactBps} BETWEEN -10000 AND 10000`,
  ),
  check(
    "finance_stock_news_status_ck",
    sql`${table.status} IN ('active', 'cancelled', 'expired')`,
  ),
  check(
    "finance_stock_news_state_ck",
    sql`${table.revision} >= 0 AND ${table.expiresAt} > ${table.createdAt}
      AND (
        (${table.status} = 'active' AND ${table.cancelledAt} IS NULL
          AND ${table.cancellationReason} IS NULL
          AND ${table.cancellationIdempotencyKey} IS NULL
          AND ${table.cancellationPayloadHash} IS NULL)
        OR (${table.status} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL
          AND LENGTH(TRIM(COALESCE(${table.cancellationReason}, ''))) > 0
          AND ${table.cancellationIdempotencyKey} IS NOT NULL
          AND ${table.cancellationPayloadHash} IS NOT NULL)
        OR (${table.status} = 'expired' AND ${table.cancelledAt} IS NULL
          AND ${table.cancellationReason} IS NULL
          AND ${table.cancellationIdempotencyKey} IS NULL
          AND ${table.cancellationPayloadHash} IS NULL)
      )`,
  ),
  check(
    "finance_stock_news_actor_ck",
    sql`(${table.updatedByActorType} = 'teacher'
        AND ${table.updatedByTeacherId} IS NOT NULL)
      OR (${table.updatedByActorType} = 'system'
        AND ${table.updatedByTeacherId} IS NULL)`,
  ),
]);

export const financeStockNewsEvents = sqliteTable(
  "finance_stock_news_events",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull().references(() => classes.id),
    newsId: text("news_id").notNull().references(() => financeStockNews.id),
    revision: integer("revision").notNull(),
    action: text("action").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    impactBps: integer("impact_bps").notNull(),
    reason: text("reason").notNull(),
    requestIdempotencyKey: text("request_idempotency_key"),
    requestPayloadHash: text("request_payload_hash"),
    actorType: text("actor_type").notNull(),
    actorTeacherId: text("actor_teacher_id").references(() => teachers.id),
    expiresAt: integer("expires_at").notNull(),
    cancelledAt: integer("cancelled_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("finance_stock_news_events_news_revision_uq").on(
      table.newsId,
      table.revision,
    ),
    uniqueIndex("finance_stock_news_events_class_action_request_uq")
      .on(table.classId, table.action, table.requestIdempotencyKey)
      .where(sql`${table.requestIdempotencyKey} IS NOT NULL`),
    index("finance_stock_news_events_class_created_idx").on(
      table.classId,
      table.createdAt,
    ),
    check(
      "finance_stock_news_events_text_ck",
      sql`LENGTH(TRIM(${table.title})) BETWEEN 1 AND 80
        AND LENGTH(TRIM(${table.content})) BETWEEN 1 AND 500
        AND LENGTH(TRIM(${table.reason})) BETWEEN 1 AND 300`,
    ),
    check(
      "finance_stock_news_events_impact_ck",
      sql`${table.impactBps} BETWEEN -10000 AND 10000`,
    ),
    check(
      "finance_stock_news_events_action_ck",
      sql`${table.action} IN ('published', 'cancelled', 'expired')`,
    ),
    check(
      "finance_stock_news_events_revision_ck",
      sql`(${table.action} = 'published' AND ${table.revision} = 0)
        OR (${table.action} IN ('cancelled', 'expired') AND ${table.revision} > 0)`,
    ),
    check(
      "finance_stock_news_events_request_ck",
      sql`(${table.action} IN ('published', 'cancelled')
          AND ${table.requestIdempotencyKey} IS NOT NULL
          AND ${table.requestPayloadHash} IS NOT NULL
          AND LENGTH(TRIM(${table.requestIdempotencyKey})) BETWEEN 8 AND 200
          AND LENGTH(TRIM(${table.requestPayloadHash})) BETWEEN 8 AND 500)
        OR (${table.action} = 'expired'
          AND ${table.requestIdempotencyKey} IS NULL
          AND ${table.requestPayloadHash} IS NULL)`,
    ),
    check(
      "finance_stock_news_events_actor_ck",
      sql`(${table.action} IN ('published', 'cancelled')
          AND ${table.actorType} = 'teacher'
          AND ${table.actorTeacherId} IS NOT NULL)
        OR (${table.action} = 'expired'
          AND ${table.actorType} = 'system'
          AND ${table.actorTeacherId} IS NULL)`,
    ),
    check(
      "finance_stock_news_events_timing_ck",
      sql`${table.expiresAt} > 0 AND ${table.createdAt} >= 0
        AND ((${table.action} = 'published'
            AND ${table.cancelledAt} IS NULL
            AND ${table.createdAt} < ${table.expiresAt})
          OR (${table.action} = 'cancelled'
            AND ${table.cancelledAt} = ${table.createdAt})
          OR (${table.action} = 'expired'
            AND ${table.cancelledAt} IS NULL
            AND ${table.createdAt} >= ${table.expiresAt}))`,
    ),
  ],
);

export const financeStockHoldings = sqliteTable("finance_stock_holdings", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull(),
  stockId: text("stock_id").notNull(),
  studentId: text("student_id").notNull().references(() => students.id),
  walletAccountId: text("wallet_account_id").notNull(),
  quantity: integer("quantity").notNull(),
  costBasis: integer("cost_basis").notNull(),
  revision: integer("revision").notNull(),
  lastTradeId: text("last_trade_id").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("finance_stock_holdings_stock_student_uq").on(
    table.stockId,
    table.studentId,
  ),
  uniqueIndex("finance_stock_holdings_id_class_uq").on(table.id, table.classId),
  index("finance_stock_holdings_class_student_idx").on(
    table.classId,
    table.studentId,
  ),
  foreignKey({
    columns: [table.stockId, table.classId],
    foreignColumns: [financeStocks.id, financeStocks.classId],
    name: "finance_stock_holdings_stock_class_fk",
  }),
  foreignKey({
    columns: [table.walletAccountId, table.classId],
    foreignColumns: [financeAccounts.id, financeAccounts.classId],
    name: "finance_stock_holdings_wallet_class_fk",
  }),
  check(
    "finance_stock_holdings_projection_ck",
    sql`${table.quantity} BETWEEN 0 AND 1000000000
      AND ${table.costBasis} BETWEEN 0 AND 1000000000
      AND ((${table.quantity} = 0 AND ${table.costBasis} = 0)
        OR (${table.quantity} > 0 AND ${table.costBasis} > 0))
      AND ${table.revision} > 0`,
  ),
]);

export const financeStockTrades = sqliteTable("finance_stock_trades", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull(),
  stockId: text("stock_id").notNull(),
  stockRevision: integer("stock_revision").notNull(),
  inventoryRevisionBefore: integer("inventory_revision_before").notNull(),
  inventoryRevisionAfter: integer("inventory_revision_after").notNull(),
  marketRevision: integer("market_revision").notNull(),
  financeSettingsRevision: integer("finance_settings_revision").notNull(),
  studentId: text("student_id").notNull().references(() => students.id),
  walletAccountId: text("wallet_account_id").notNull(),
  walletRevisionBefore: integer("wallet_revision_before").notNull(),
  walletRevisionAfter: integer("wallet_revision_after").notNull(),
  side: text("side").notNull(),
  quantity: integer("quantity").notNull(),
  referencePrice: integer("reference_price").notNull(),
  spreadSnapshot: integer("spread_snapshot").notNull(),
  unitPrice: integer("unit_price").notNull(),
  grossAmount: integer("gross_amount").notNull(),
  feeBpsSnapshot: integer("fee_bps_snapshot").notNull(),
  feeAmount: integer("fee_amount").notNull(),
  walletDelta: integer("wallet_delta").notNull(),
  availableSharesBefore: integer("available_shares_before").notNull(),
  availableSharesAfter: integer("available_shares_after").notNull(),
  holdingQuantityBefore: integer("holding_quantity_before").notNull(),
  holdingQuantityAfter: integer("holding_quantity_after").notNull(),
  holdingCostBasisBefore: integer("holding_cost_basis_before").notNull(),
  holdingCostBasisAfter: integer("holding_cost_basis_after").notNull(),
  holdingRevisionBefore: integer("holding_revision_before").notNull(),
  holdingRevisionAfter: integer("holding_revision_after").notNull(),
  costBasisRemoved: integer("cost_basis_removed").notNull(),
  realizedGain: integer("realized_gain").notNull(),
  status: text("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  postedTransactionId: text("posted_transaction_id"),
  transactionPayloadHash: text("transaction_payload_hash"),
  createdAt: integer("created_at").notNull(),
  postedAt: integer("posted_at"),
}, (table) => [
  uniqueIndex("finance_stock_trades_id_class_uq").on(table.id, table.classId),
  uniqueIndex("finance_stock_trades_class_student_idempotency_uq").on(
    table.classId,
    table.studentId,
    table.idempotencyKey,
  ),
  uniqueIndex("finance_stock_trades_posted_transaction_uq")
    .on(table.postedTransactionId)
    .where(sql`${table.postedTransactionId} IS NOT NULL`),
  index("finance_stock_trades_student_created_idx").on(
    table.studentId,
    table.createdAt,
  ),
  index("finance_stock_trades_class_created_idx").on(table.classId, table.createdAt),
  foreignKey({
    columns: [table.stockId, table.classId],
    foreignColumns: [financeStocks.id, financeStocks.classId],
    name: "finance_stock_trades_stock_class_fk",
  }),
  foreignKey({
    columns: [table.walletAccountId, table.classId],
    foreignColumns: [financeAccounts.id, financeAccounts.classId],
    name: "finance_stock_trades_wallet_class_fk",
  }),
  foreignKey({
    columns: [table.postedTransactionId, table.classId],
    foreignColumns: [financeTransactions.id, financeTransactions.classId],
    name: "finance_stock_trades_transaction_class_fk",
  }),
  check("finance_stock_trades_side_ck", sql`${table.side} IN ('buy', 'sell')`),
  check(
    "finance_stock_trades_revision_ck",
    sql`${table.stockRevision} >= 0
      AND ${table.marketRevision} >= 0
      AND ${table.financeSettingsRevision} >= 0
      AND ${table.inventoryRevisionAfter} = ${table.inventoryRevisionBefore} + 1
      AND ${table.holdingRevisionAfter} = ${table.holdingRevisionBefore} + 1
      AND ${table.walletRevisionAfter} = ${table.walletRevisionBefore} + 1`,
  ),
  check(
    "finance_stock_trades_amount_ck",
    sql`${table.quantity} BETWEEN 1 AND 1000000000
      AND ${table.referencePrice} BETWEEN 1 AND 1000000000
      AND ${table.spreadSnapshot} BETWEEN 0 AND 1000000000
      AND ${table.unitPrice} BETWEEN 1 AND 1000000000
      AND ${table.unitPrice} = CASE ${table.side}
        WHEN 'buy' THEN ${table.referencePrice} + ${table.spreadSnapshot}
        ELSE ${table.referencePrice} - ${table.spreadSnapshot} END
      AND ${table.grossAmount} = ${table.unitPrice} * ${table.quantity}
      AND ${table.grossAmount} BETWEEN 1 AND 1000000000
      AND ${table.feeBpsSnapshot} BETWEEN 0 AND 1000
      AND ${table.feeAmount} BETWEEN 0 AND ${table.grossAmount}
      AND ${table.walletDelta} = CASE ${table.side}
        WHEN 'buy' THEN -(${table.grossAmount} + ${table.feeAmount})
        ELSE ${table.grossAmount} - ${table.feeAmount} END
      AND ${table.walletDelta} <> 0
      AND ABS(${table.walletDelta}) <= 1000000000`,
  ),
  check(
    "finance_stock_trades_inventory_ck",
    sql`${table.availableSharesBefore} BETWEEN 0 AND 1000000000
      AND ${table.availableSharesAfter} BETWEEN 0 AND 1000000000
      AND ${table.availableSharesAfter} = CASE ${table.side}
        WHEN 'buy' THEN ${table.availableSharesBefore} - ${table.quantity}
        ELSE ${table.availableSharesBefore} + ${table.quantity} END`,
  ),
  check(
    "finance_stock_trades_holding_ck",
    sql`${table.holdingQuantityBefore} BETWEEN 0 AND 1000000000
      AND ${table.holdingQuantityAfter} BETWEEN 0 AND 1000000000
      AND ${table.holdingCostBasisBefore} BETWEEN 0 AND 1000000000
      AND ${table.holdingCostBasisAfter} BETWEEN 0 AND 1000000000
      AND ${table.costBasisRemoved} BETWEEN 0 AND 1000000000
      AND ${table.holdingQuantityAfter} = CASE ${table.side}
        WHEN 'buy' THEN ${table.holdingQuantityBefore} + ${table.quantity}
        ELSE ${table.holdingQuantityBefore} - ${table.quantity} END
      AND (
        (${table.side} = 'buy'
          AND ${table.costBasisRemoved} = 0
          AND ${table.realizedGain} = 0
          AND ${table.holdingCostBasisAfter} = ${table.holdingCostBasisBefore}
            + ${table.grossAmount} + ${table.feeAmount})
        OR (${table.side} = 'sell'
          AND ${table.holdingQuantityBefore} > 0
          AND ${table.quantity} <= ${table.holdingQuantityBefore}
          AND ${table.costBasisRemoved} = CAST(
            (${table.holdingCostBasisBefore} * ${table.quantity})
              / ${table.holdingQuantityBefore} AS INTEGER)
          AND ${table.holdingCostBasisAfter} = ${table.holdingCostBasisBefore}
            - ${table.costBasisRemoved}
          AND ${table.realizedGain} = ${table.walletDelta}
            - ${table.costBasisRemoved})
      )
      AND ((${table.holdingQuantityAfter} = 0 AND ${table.holdingCostBasisAfter} = 0)
        OR (${table.holdingQuantityAfter} > 0 AND ${table.holdingCostBasisAfter} > 0))`,
  ),
  check(
    "finance_stock_trades_status_ck",
    sql`(${table.status} = 'pending'
        AND ${table.postedTransactionId} IS NULL
        AND ${table.transactionPayloadHash} IS NULL
        AND ${table.postedAt} IS NULL)
      OR (${table.status} = 'posted'
        AND ${table.postedTransactionId} IS NOT NULL
        AND ${table.transactionPayloadHash} IS NOT NULL
        AND ${table.postedAt} IS NOT NULL)`,
  ),
]);

export const financeStockLiquidationOperations = sqliteTable(
  "finance_stock_liquidation_operations",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull(),
    stockId: text("stock_id").notNull(),
    studentId: text("student_id").notNull().references(() => students.id),
    teacherId: text("teacher_id").notNull().references(() => teachers.id),
    rootIdempotencyKey: text("root_idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    origin: text("origin").notNull(),
    interventionReason: text("intervention_reason").notNull(),
    status: text("status").notNull().default("running"),
    snapshotReferencePrice: integer("snapshot_reference_price").notNull(),
    snapshotSpread: integer("snapshot_spread").notNull(),
    snapshotUnitPrice: integer("snapshot_unit_price").notNull(),
    snapshotFeeBps: integer("snapshot_fee_bps").notNull(),
    snapshotDenominationStep: integer("snapshot_denomination_step").notNull(),
    snapshotStockRevision: integer("snapshot_stock_revision").notNull(),
    snapshotMarketRevision: integer("snapshot_market_revision").notNull(),
    snapshotFinanceSettingsRevision: integer("snapshot_finance_settings_revision")
      .notNull(),
    snapshotHoldingRevision: integer("snapshot_holding_revision").notNull(),
    snapshotWalletRevision: integer("snapshot_wallet_revision").notNull(),
    snapshotWalletBalance: integer("snapshot_wallet_balance").notNull(),
    snapshotStudentStatus: text("snapshot_student_status").notNull(),
    snapshotStockStatus: text("snapshot_stock_status").notNull(),
    snapshotMarketWasOpen: integer("snapshot_market_was_open").notNull(),
    initialQuantity: integer("initial_quantity").notNull(),
    remainingQuantity: integer("remaining_quantity").notNull(),
    soldQuantity: integer("sold_quantity").notNull(),
    initialCostBasis: integer("initial_cost_basis").notNull(),
    remainingCostBasis: integer("remaining_cost_basis").notNull(),
    expectedGrossAmount: integer("expected_gross_amount").notNull(),
    expectedFeeAmount: integer("expected_fee_amount").notNull(),
    expectedWalletDelta: integer("expected_wallet_delta").notNull(),
    completedChunkCount: integer("completed_chunk_count").notNull().default(0),
    totalGrossAmount: integer("total_gross_amount").notNull().default(0),
    totalFeeAmount: integer("total_fee_amount").notNull().default(0),
    totalWalletDelta: integer("total_wallet_delta").notNull().default(0),
    totalCostBasisRemoved: integer("total_cost_basis_removed").notNull().default(0),
    totalRealizedGain: integer("total_realized_gain").notNull().default(0),
    nextChunkIndex: integer("next_chunk_index").notNull().default(0),
    lastTradeId: text("last_trade_id"),
    revision: integer("revision").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
    cancelledAt: integer("cancelled_at"),
    cancellationReason: text("cancellation_reason"),
    cancellationIdempotencyKey: text("cancellation_idempotency_key"),
    cancellationPayloadHash: text("cancellation_payload_hash"),
  },
  (table) => [
    uniqueIndex("finance_stock_liquidation_operations_id_class_uq").on(
      table.id,
      table.classId,
    ),
    uniqueIndex("finance_stock_liquidation_operations_root_uq").on(
      table.rootIdempotencyKey,
    ),
    uniqueIndex("finance_stock_liquidation_operations_running_uq")
      .on(table.classId, table.stockId, table.studentId)
      .where(sql`${table.status} = 'running'`),
    uniqueIndex("finance_stock_liquidation_operations_cancellation_uq")
      .on(table.cancellationIdempotencyKey)
      .where(sql`${table.cancellationIdempotencyKey} IS NOT NULL`),
    index("finance_stock_liquidation_operations_class_status_idx").on(
      table.classId,
      table.status,
      table.updatedAt,
    ),
    foreignKey({
      columns: [table.stockId, table.classId],
      foreignColumns: [financeStocks.id, financeStocks.classId],
      name: "finance_stock_liquidation_operations_stock_class_fk",
    }),
    foreignKey({
      columns: [table.lastTradeId, table.classId],
      foreignColumns: [financeStockTrades.id, financeStockTrades.classId],
      name: "finance_stock_liquidation_operations_trade_class_fk",
    }),
    check(
      "finance_stock_liquidation_operations_text_ck",
      sql`LENGTH(TRIM(${table.rootIdempotencyKey})) BETWEEN 8 AND 200
        AND LENGTH(TRIM(${table.payloadHash})) BETWEEN 8 AND 500
        AND ${table.origin} IN (
          'finance_center', 'student_exclusion', 'class_archive', 'account_recovery'
        )
        AND LENGTH(TRIM(${table.interventionReason})) BETWEEN 2 AND 300`,
    ),
    check(
      "finance_stock_liquidation_operations_snapshot_ck",
      sql`${table.snapshotReferencePrice} BETWEEN 1 AND 1000000000
        AND ${table.snapshotSpread} BETWEEN 0 AND 1000000000
        AND ${table.snapshotUnitPrice} = ${table.snapshotReferencePrice}
          - ${table.snapshotSpread}
        AND ${table.snapshotUnitPrice} BETWEEN 1 AND 1000000000
        AND ${table.snapshotFeeBps} BETWEEN 0 AND 1000
        AND ${table.snapshotDenominationStep} BETWEEN 1 AND 1000000000
        AND ${table.snapshotReferencePrice} % ${table.snapshotDenominationStep} = 0
        AND ${table.snapshotSpread} % ${table.snapshotDenominationStep} = 0
        AND ${table.snapshotStockRevision} >= 0
        AND ${table.snapshotMarketRevision} >= 0
        AND ${table.snapshotFinanceSettingsRevision} >= 0
        AND ${table.snapshotHoldingRevision} > 0
        AND ${table.snapshotWalletRevision} >= 0
        AND ${table.snapshotWalletBalance} BETWEEN 0 AND 1000000000
        AND ${table.snapshotMarketWasOpen} IN (0, 1)`,
    ),
    check(
      "finance_stock_liquidation_operations_progress_ck",
      sql`${table.initialQuantity} BETWEEN 1 AND 1000000000
        AND ${table.remainingQuantity} BETWEEN 0 AND ${table.initialQuantity}
        AND ${table.soldQuantity} = ${table.initialQuantity}
          - ${table.remainingQuantity}
        AND ${table.initialCostBasis} BETWEEN 1 AND 1000000000
        AND ${table.remainingCostBasis} BETWEEN 0 AND ${table.initialCostBasis}
        AND ((${table.remainingQuantity} = 0 AND ${table.remainingCostBasis} = 0)
          OR (${table.remainingQuantity} > 0 AND ${table.remainingCostBasis} > 0))
        AND ${table.expectedGrossAmount}
          = ${table.snapshotUnitPrice} * ${table.initialQuantity}
        AND ${table.expectedGrossAmount} BETWEEN 1 AND 1111111111
        AND ${table.expectedFeeAmount} BETWEEN 0 AND ${table.expectedGrossAmount}
        AND ${table.expectedFeeAmount} <= CAST(
          ${table.expectedGrossAmount} * ${table.snapshotFeeBps} / 10000
          AS INTEGER)
        AND ${table.expectedWalletDelta}
          = ${table.expectedGrossAmount} - ${table.expectedFeeAmount}
        AND ${table.expectedWalletDelta} > 0
        AND ${table.expectedWalletDelta}
          <= 1000000000 - ${table.snapshotWalletBalance}
        AND ${table.completedChunkCount} BETWEEN 0 AND 2
        AND ${table.nextChunkIndex} = ${table.completedChunkCount}
        AND ${table.revision} = ${table.completedChunkCount}
          + CASE ${table.status} WHEN 'cancelled' THEN 1 ELSE 0 END
        AND ${table.totalGrossAmount}
          = ${table.snapshotUnitPrice} * ${table.soldQuantity}
        AND ${table.totalFeeAmount} BETWEEN 0 AND ${table.totalGrossAmount}
        AND ${table.totalWalletDelta}
          = ${table.totalGrossAmount} - ${table.totalFeeAmount}
        AND ${table.totalCostBasisRemoved}
          = ${table.initialCostBasis} - ${table.remainingCostBasis}
        AND ${table.totalRealizedGain}
          = ${table.totalWalletDelta} - ${table.totalCostBasisRemoved}`,
    ),
    check(
      "finance_stock_liquidation_operations_state_ck",
      sql`((${table.status} = 'running'
          AND ${table.remainingQuantity} > 0
          AND ${table.completedChunkCount} < 2
          AND ${table.completedAt} IS NULL
          AND ${table.cancelledAt} IS NULL
          AND ${table.cancellationReason} IS NULL
          AND ${table.cancellationIdempotencyKey} IS NULL
          AND ${table.cancellationPayloadHash} IS NULL)
        OR (${table.status} = 'completed'
          AND ${table.remainingQuantity} = 0
          AND ${table.remainingCostBasis} = 0
          AND ${table.soldQuantity} = ${table.initialQuantity}
          AND ${table.totalGrossAmount} = ${table.expectedGrossAmount}
          AND ${table.totalFeeAmount} = ${table.expectedFeeAmount}
          AND ${table.totalWalletDelta} = ${table.expectedWalletDelta}
          AND ${table.totalCostBasisRemoved} = ${table.initialCostBasis}
          AND ${table.completedAt} IS NOT NULL
          AND ${table.cancelledAt} IS NULL
          AND ${table.cancellationReason} IS NULL
          AND ${table.cancellationIdempotencyKey} IS NULL
          AND ${table.cancellationPayloadHash} IS NULL)
        OR (${table.status} = 'cancelled'
          AND ${table.remainingQuantity} > 0
          AND ${table.completedAt} IS NULL
          AND ${table.cancelledAt} IS NOT NULL
          AND LENGTH(TRIM(COALESCE(${table.cancellationReason}, '')))
            BETWEEN 2 AND 300
          AND LENGTH(TRIM(COALESCE(${table.cancellationIdempotencyKey}, '')))
            BETWEEN 8 AND 200
          AND LENGTH(TRIM(COALESCE(${table.cancellationPayloadHash}, '')))
            BETWEEN 8 AND 500))
        AND ((${table.completedChunkCount} = 0 AND ${table.lastTradeId} IS NULL)
          OR (${table.completedChunkCount} > 0 AND ${table.lastTradeId} IS NOT NULL))
        AND ${table.updatedAt} >= ${table.createdAt}
        AND (${table.completedAt} IS NULL OR ${table.completedAt} = ${table.updatedAt})
        AND (${table.cancelledAt} IS NULL OR ${table.cancelledAt} = ${table.updatedAt})`,
    ),
  ],
);

export const financeStockLiquidationChunks = sqliteTable(
  "finance_stock_liquidation_chunks",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id").notNull(),
    classId: text("class_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    tradeId: text("trade_id").notNull(),
    quantity: integer("quantity").notNull(),
    grossAmount: integer("gross_amount").notNull(),
    feeAmount: integer("fee_amount").notNull(),
    walletDelta: integer("wallet_delta").notNull(),
    costBasisRemoved: integer("cost_basis_removed").notNull(),
    realizedGain: integer("realized_gain").notNull(),
    holdingQuantityBefore: integer("holding_quantity_before").notNull(),
    holdingQuantityAfter: integer("holding_quantity_after").notNull(),
    holdingCostBasisBefore: integer("holding_cost_basis_before").notNull(),
    holdingCostBasisAfter: integer("holding_cost_basis_after").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("finance_stock_liquidation_chunks_operation_index_uq").on(
      table.operationId,
      table.chunkIndex,
    ),
    uniqueIndex("finance_stock_liquidation_chunks_trade_uq").on(table.tradeId),
    index("finance_stock_liquidation_chunks_class_created_idx").on(
      table.classId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.operationId, table.classId],
      foreignColumns: [
        financeStockLiquidationOperations.id,
        financeStockLiquidationOperations.classId,
      ],
      name: "finance_stock_liquidation_chunks_operation_class_fk",
    }),
    foreignKey({
      columns: [table.tradeId, table.classId],
      foreignColumns: [financeStockTrades.id, financeStockTrades.classId],
      name: "finance_stock_liquidation_chunks_trade_class_fk",
    }),
    check(
      "finance_stock_liquidation_chunks_amount_ck",
      sql`${table.chunkIndex} BETWEEN 0 AND 1
        AND ${table.quantity} BETWEEN 1 AND 1000000000
        AND ${table.grossAmount} BETWEEN 1 AND 1000000000
        AND ${table.feeAmount} BETWEEN 0 AND ${table.grossAmount}
        AND ${table.walletDelta} = ${table.grossAmount} - ${table.feeAmount}
        AND ${table.walletDelta} > 0
        AND ${table.costBasisRemoved} BETWEEN 0 AND 1000000000
        AND ${table.realizedGain} = ${table.walletDelta}
          - ${table.costBasisRemoved}`,
    ),
    check(
      "finance_stock_liquidation_chunks_holding_ck",
      sql`${table.holdingQuantityBefore} BETWEEN 1 AND 1000000000
        AND ${table.holdingQuantityAfter}
          = ${table.holdingQuantityBefore} - ${table.quantity}
        AND ${table.holdingQuantityAfter} BETWEEN 0 AND 1000000000
        AND ${table.holdingCostBasisBefore} BETWEEN 1 AND 1000000000
        AND ${table.holdingCostBasisAfter}
          = ${table.holdingCostBasisBefore} - ${table.costBasisRemoved}
        AND ${table.holdingCostBasisAfter} BETWEEN 0 AND 1000000000
        AND ((${table.holdingQuantityAfter} = 0
            AND ${table.holdingCostBasisAfter} = 0)
          OR (${table.holdingQuantityAfter} > 0
            AND ${table.holdingCostBasisAfter} > 0))`,
    ),
  ],
);

export const financeStockLiquidationEvents = sqliteTable(
  "finance_stock_liquidation_events",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull(),
    operationId: text("operation_id").notNull(),
    revision: integer("revision").notNull(),
    action: text("action").notNull(),
    stockId: text("stock_id").notNull(),
    studentId: text("student_id").notNull().references(() => students.id),
    actorTeacherId: text("actor_teacher_id").notNull().references(() => teachers.id),
    chunkId: text("chunk_id").references(() => financeStockLiquidationChunks.id),
    chunkIndex: integer("chunk_index"),
    tradeId: text("trade_id").references(() => financeStockTrades.id),
    requestIdempotencyKey: text("request_idempotency_key").notNull(),
    requestPayloadHash: text("request_payload_hash").notNull(),
    reason: text("reason").notNull(),
    initialQuantity: integer("initial_quantity").notNull(),
    remainingQuantity: integer("remaining_quantity").notNull(),
    soldQuantity: integer("sold_quantity").notNull(),
    completedChunkCount: integer("completed_chunk_count").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    walletDelta: integer("wallet_delta").notNull(),
    totalGrossAmount: integer("total_gross_amount").notNull(),
    totalFeeAmount: integer("total_fee_amount").notNull(),
    totalWalletDelta: integer("total_wallet_delta").notNull(),
    totalCostBasisRemoved: integer("total_cost_basis_removed").notNull(),
    totalRealizedGain: integer("total_realized_gain").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("finance_stock_liquidation_events_operation_revision_action_uq").on(
      table.operationId,
      table.revision,
      table.action,
    ),
    uniqueIndex("finance_stock_liquidation_events_class_action_request_uq").on(
      table.classId,
      table.action,
      table.requestIdempotencyKey,
    ),
    index("finance_stock_liquidation_events_class_created_idx").on(
      table.classId,
      table.createdAt,
      table.id,
    ),
    foreignKey({
      columns: [table.operationId, table.classId],
      foreignColumns: [
        financeStockLiquidationOperations.id,
        financeStockLiquidationOperations.classId,
      ],
      name: "finance_stock_liquidation_events_operation_class_fk",
    }),
    foreignKey({
      columns: [table.stockId, table.classId],
      foreignColumns: [financeStocks.id, financeStocks.classId],
      name: "finance_stock_liquidation_events_stock_class_fk",
    }),
    check(
      "finance_stock_liquidation_events_id_ck",
      sql`${table.id} = 'finance:stock-liquidation-event:'
        || ${table.operationId} || ':' || ${table.revision}
        || ':' || ${table.action}`,
    ),
    check(
      "finance_stock_liquidation_events_text_ck",
      sql`LENGTH(TRIM(${table.requestIdempotencyKey})) BETWEEN 8 AND 200
        AND LENGTH(TRIM(${table.requestPayloadHash})) BETWEEN 8 AND 500
        AND LENGTH(TRIM(${table.reason})) BETWEEN 2 AND 300`,
    ),
    check(
      "finance_stock_liquidation_events_action_ck",
      sql`${table.action} IN (
        'started', 'chunk_completed', 'completed', 'cancelled'
      )`,
    ),
    check(
      "finance_stock_liquidation_events_amount_ck",
      sql`${table.revision} BETWEEN 0 AND 3
        AND ${table.initialQuantity} BETWEEN 1 AND 1000000000
        AND ${table.remainingQuantity} BETWEEN 0 AND 1000000000
        AND ${table.soldQuantity} BETWEEN 0 AND 1000000000
        AND ${table.initialQuantity}
          = ${table.remainingQuantity} + ${table.soldQuantity}
        AND ${table.completedChunkCount} BETWEEN 0 AND 2
        AND ${table.quantityDelta} BETWEEN 0 AND 1000000000
        AND ${table.walletDelta} BETWEEN 0 AND 1000000000
        AND ${table.totalGrossAmount} BETWEEN 0 AND 1111111111
        AND ${table.totalFeeAmount} BETWEEN 0 AND ${table.totalGrossAmount}
        AND ${table.totalWalletDelta}
          = ${table.totalGrossAmount} - ${table.totalFeeAmount}
        AND ${table.totalWalletDelta} BETWEEN 0 AND 1000000000
        AND ${table.totalCostBasisRemoved} BETWEEN 0 AND 1000000000
        AND ${table.totalRealizedGain}
          = ${table.totalWalletDelta} - ${table.totalCostBasisRemoved}
        AND ${table.createdAt} >= 0`,
    ),
    check(
      "finance_stock_liquidation_events_state_ck",
      sql`(${table.action} = 'started'
          AND ${table.revision} = 0
          AND ${table.chunkId} IS NULL AND ${table.chunkIndex} IS NULL
          AND ${table.tradeId} IS NULL
          AND ${table.remainingQuantity} > 0 AND ${table.soldQuantity} = 0
          AND ${table.completedChunkCount} = 0
          AND ${table.quantityDelta} = 0 AND ${table.walletDelta} = 0
          AND ${table.totalGrossAmount} = 0
          AND ${table.totalFeeAmount} = 0
          AND ${table.totalWalletDelta} = 0
          AND ${table.totalCostBasisRemoved} = 0
          AND ${table.totalRealizedGain} = 0)
        OR (${table.action} = 'chunk_completed'
          AND ${table.chunkId} IS NOT NULL AND ${table.chunkIndex} IS NOT NULL
          AND ${table.tradeId} IS NOT NULL
          AND ${table.revision} = ${table.completedChunkCount}
          AND ${table.completedChunkCount} BETWEEN 1 AND 2
          AND ${table.soldQuantity} > 0
          AND ${table.chunkIndex} = ${table.completedChunkCount} - 1
          AND ${table.quantityDelta} > 0 AND ${table.walletDelta} > 0)
        OR (${table.action} = 'completed'
          AND ${table.chunkId} IS NOT NULL AND ${table.chunkIndex} IS NOT NULL
          AND ${table.tradeId} IS NOT NULL
          AND ${table.revision} = ${table.completedChunkCount}
          AND ${table.completedChunkCount} BETWEEN 1 AND 2
          AND ${table.chunkIndex} = ${table.completedChunkCount} - 1
          AND ${table.remainingQuantity} = 0 AND ${table.soldQuantity} > 0
          AND ${table.quantityDelta} = 0 AND ${table.walletDelta} = 0)
        OR (${table.action} = 'cancelled'
          AND ${table.chunkId} IS NULL AND ${table.chunkIndex} IS NULL
          AND ${table.tradeId} IS NULL
          AND ${table.revision} = ${table.completedChunkCount} + 1
          AND ${table.remainingQuantity} > 0
          AND ${table.quantityDelta} = 0 AND ${table.walletDelta} = 0)`,
    ),
  ],
);
