import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
