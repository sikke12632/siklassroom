import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const teachers = sqliteTable("teachers", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("teachers_email_uq").on(table.email)]);

export const classes = sqliteTable("classes", {
  id: text("id").primaryKey(),
  teacherId: text("teacher_id").notNull().references(() => teachers.id),
  schoolName: text("school_name").notNull(),
  schoolNormalized: text("school_normalized").notNull(),
  schoolYear: integer("school_year").notNull(),
  grade: integer("grade").notNull(),
  classNumber: integer("class_number").notNull(),
  displayName: text("display_name"),
  status: text("status").notNull().default("active"),
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
