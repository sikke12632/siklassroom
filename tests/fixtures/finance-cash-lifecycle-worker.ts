import { PATCH as patchClass } from "../../app/api/classes/[classId]/route";
import { POST as addStudents } from "../../app/api/classes/[classId]/students/route";
import { POST as createClass } from "../../app/api/classes/route";
import { PATCH as patchStudent } from "../../app/api/students/[studentId]/route";
import { runtimeEnv } from "../../lib/database";

type TestEnvironment = {
  DB: D1Database;
};

type InjectionScope = "class" | "student";

type InjectionHook = {
  scope: InjectionScope;
  matched: boolean;
};

const lifecycleFixtures = {
  class: {
    classId: "class-cash-archive",
    studentId: "student-cash-archive",
    requestId: "request-cash-archive-race",
  },
  student: {
    classId: "class-cash-exclude",
    studentId: "student-cash-exclude",
    requestId: "request-cash-exclude-race",
  },
} as const;

let rawDatabase: D1Database | null = null;
let databaseWrapped = false;
let injectionHook: InjectionHook | null = null;
let archiveAfterClassReadHook: { matched: boolean } | null = null;
let activateAfterClassReadHook: { matched: boolean } | null = null;
let excludeAfterStudentReadHook: { matched: boolean } | null = null;
let activateAfterStudentReadHook: { matched: boolean } | null = null;
let studentFieldAfterReadHook: {
  field: "number" | "name";
  matched: boolean;
} | null = null;

function isUnresolvedCashRequestCount(query: string) {
  return query.includes("finance_cash_requests") && query.includes("COUNT");
}

function isOwnedClassRead(query: string) {
  return query.includes("FROM classes WHERE id = ? AND teacher_id = ?");
}

function isOwnedStudentRead(query: string) {
  return query.includes("FROM students s JOIN classes c ON c.id = s.class_id")
    && query.includes("WHERE s.id = ? AND c.teacher_id = ?");
}

async function archiveClassAfterRead() {
  if (!rawDatabase) throw new Error("The lifecycle test database is unavailable.");
  const now = Date.now();
  await rawDatabase.batch([
    rawDatabase.prepare(
      `UPDATE classes SET status = 'archived', updated_at = ?
       WHERE id = 'class-cash-archive' AND status = 'active'`,
    ).bind(now),
    rawDatabase.prepare(
      `DELETE FROM sessions
       WHERE student_id IN (
         SELECT id FROM students WHERE class_id = 'class-cash-archive'
       )`,
    ),
  ]);
}

async function activateClassAfterRead() {
  if (!rawDatabase) throw new Error("The lifecycle test database is unavailable.");
  const now = Date.now();
  await rawDatabase.batch([
    rawDatabase.prepare(
      `UPDATE classes SET status = 'active', updated_at = ?
       WHERE id = 'class-cash-archive' AND status = 'archived'`,
    ).bind(now),
    rawDatabase.prepare(
      `INSERT INTO sessions (
         id, token_hash, actor_type, teacher_id, student_id,
         expires_at, created_at, last_seen_at
       ) VALUES (
         'session-cash-reactivated-race', 'hash:session:cash:reactivated-race',
         'student', NULL, 'student-cash-archive', 4102444800000, ?, ?
       )`,
    ).bind(now, now),
  ]);
}

async function excludeStudentAfterRead() {
  if (!rawDatabase) throw new Error("The lifecycle test database is unavailable.");
  const now = Date.now();
  await rawDatabase.batch([
    rawDatabase.prepare(
      `UPDATE students SET status = 'excluded', updated_at = ?
       WHERE id = 'student-cash-exclude' AND status = 'active'`,
    ).bind(now),
    rawDatabase.prepare(
      `DELETE FROM sessions WHERE student_id = 'student-cash-exclude'`,
    ),
  ]);
}

async function activateStudentAfterRead() {
  if (!rawDatabase) throw new Error("The lifecycle test database is unavailable.");
  const now = Date.now();
  await rawDatabase.batch([
    rawDatabase.prepare(
      `UPDATE students SET status = 'active', updated_at = ?
       WHERE id = 'student-cash-exclude' AND status = 'excluded'`,
    ).bind(now),
    rawDatabase.prepare(
      `INSERT INTO sessions (
         id, token_hash, actor_type, teacher_id, student_id,
         expires_at, created_at, last_seen_at
       ) VALUES (
         'session-student-reactivated-race',
         'hash:session:student:reactivated-race',
         'student', NULL, 'student-cash-exclude', 4102444800000, ?, ?
       )`,
    ).bind(now, now),
  ]);
}

async function updateStudentFieldAfterRead(field: "number" | "name") {
  if (!rawDatabase) throw new Error("The lifecycle test database is unavailable.");
  const now = Date.now();
  const statement = field === "number"
    ? rawDatabase.prepare(
        `UPDATE students SET student_number = 9, updated_at = ?
         WHERE id = 'student-cash-exclude'`,
      )
    : rawDatabase.prepare(
        `UPDATE students SET official_name = 'Concurrent student name', updated_at = ?
         WHERE id = 'student-cash-exclude'`,
      );
  await statement.bind(now).run();
}

async function injectPendingCashRequest(scope: InjectionScope) {
  if (!rawDatabase) throw new Error("The lifecycle test database is unavailable.");
  const fixture = lifecycleFixtures[scope];
  const context = await rawDatabase.prepare(
    `SELECT student.student_number, student.official_name,
            account.id AS wallet_account_id, account.balance,
            account.revision
     FROM students student
     JOIN finance_accounts account
       ON account.class_id = student.class_id
      AND account.student_id = student.id
      AND account.account_type = 'student_wallet'
     WHERE student.id = ? AND student.class_id = ? LIMIT 1`,
  ).bind(fixture.studentId, fixture.classId).first<{
    student_number: number;
    official_name: string;
    wallet_account_id: string;
    balance: number;
    revision: number;
  }>();
  if (!context) throw new Error(`Missing lifecycle fixture context: ${scope}`);
  await rawDatabase.prepare(
    `INSERT INTO finance_cash_requests (
       id, class_id, requester_student_id, wallet_account_id,
       request_type, amount, memo, idempotency_key, payload_hash,
       student_number_snapshot, student_name_snapshot,
       wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
     ) VALUES (?, ?, ?, ?, 'deposit', 100, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).bind(
    fixture.requestId,
    fixture.classId,
    fixture.studentId,
    context.wallet_account_id,
    `Injected ${scope} lifecycle race`,
    `cash-lifecycle:${scope}:request`,
    `hash:cash-lifecycle:${scope}:request`,
    context.student_number,
    context.official_name,
    context.balance,
    context.revision,
    Date.now(),
  ).run();
}

function wrapPreparedStatement(
  statement: D1PreparedStatement,
  query: string,
): D1PreparedStatement {
  return new Proxy(statement, {
    get(target, property) {
      if (property === "bind") {
        return (...values: unknown[]) => wrapPreparedStatement(
          target.bind(...values),
          query,
        );
      }
      if (property === "first") {
        return async (...args: unknown[]) => {
          const first = Reflect.get(target, property, target) as (
            ...firstArgs: unknown[]
          ) => Promise<unknown>;
          const result = await first.apply(target, args);
          const archiveHook = archiveAfterClassReadHook;
          if (
            archiveHook
            && !archiveHook.matched
            && isOwnedClassRead(query)
          ) {
            archiveHook.matched = true;
            await archiveClassAfterRead();
          }
          const activateHook = activateAfterClassReadHook;
          if (
            activateHook
            && !activateHook.matched
            && isOwnedClassRead(query)
          ) {
            activateHook.matched = true;
            await activateClassAfterRead();
          }
          const excludeStudentHook = excludeAfterStudentReadHook;
          if (
            excludeStudentHook
            && !excludeStudentHook.matched
            && isOwnedStudentRead(query)
          ) {
            excludeStudentHook.matched = true;
            await excludeStudentAfterRead();
          }
          const activateStudentHook = activateAfterStudentReadHook;
          if (
            activateStudentHook
            && !activateStudentHook.matched
            && isOwnedStudentRead(query)
          ) {
            activateStudentHook.matched = true;
            await activateStudentAfterRead();
          }
          const studentFieldHook = studentFieldAfterReadHook;
          if (
            studentFieldHook
            && !studentFieldHook.matched
            && isOwnedStudentRead(query)
          ) {
            studentFieldHook.matched = true;
            await updateStudentFieldAfterRead(studentFieldHook.field);
          }
          const hook = injectionHook;
          if (
            hook
            && !hook.matched
            && isUnresolvedCashRequestCount(query)
          ) {
            hook.matched = true;
            await injectPendingCashRequest(hook.scope);
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1PreparedStatement;
}

function installDatabaseProxy(database: D1Database) {
  if (databaseWrapped) return;
  rawDatabase = database;
  runtimeEnv().DB = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => wrapPreparedStatement(target.prepare(query), query);
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;
  databaseWrapped = true;
}

async function resolvePendingRequest(scope: InjectionScope) {
  if (!rawDatabase) throw new Error("The lifecycle test database is unavailable.");
  const fixture = lifecycleFixtures[scope];
  const now = Date.now();
  await rawDatabase.prepare(
    `INSERT INTO finance_request_resolutions (
       id, request_id, class_id, decision, idempotency_key, payload_hash,
       expected_request_revision, actor_type, actor_teacher_id,
       actor_student_id, actor_job_period_id, actor_label,
       reason_code, reason_note, intervention_reason, is_emergency,
       posted_transaction_id, transaction_payload_hash, resolved_at, created_at
     ) VALUES (?, ?, ?, 'rejected', ?, ?, 0, 'teacher', 'teacher-cash-lifecycle',
               NULL, NULL, 'Lifecycle Teacher', 'class_change', NULL,
               'Resolve the request before changing roster state', 1,
               NULL, NULL, ?, ?)`,
  ).bind(
    `resolution-cash-${scope}`,
    fixture.requestId,
    fixture.classId,
    `cash-lifecycle:${scope}:resolution`,
    `hash:cash-lifecycle:${scope}:resolution`,
    now,
    now,
  ).run();
}

function responseWithInjectionStatus(response: Response, matched: boolean) {
  const headers = new Headers(response.headers);
  headers.set("x-test-injection-matched", matched ? "1" : "0");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const financeCashLifecycleWorker = {
  async fetch(request: Request, environment: TestEnvironment) {
    installDatabaseProxy(environment.DB);
    const url = new URL(request.url);
    if (url.pathname === "/test/resolve") {
      const scope = url.searchParams.get("scope");
      if (scope !== "class" && scope !== "student") {
        return Response.json({ error: "Unknown lifecycle scope." }, { status: 400 });
      }
      await resolvePendingRequest(scope);
      return Response.json({ resolved: true });
    }

    const requestedScope = request.headers.get(
      "x-test-inject-pending-after-lifecycle-preflight",
    );
    const archiveAfterClassRead = request.headers.get(
      "x-test-archive-after-class-read",
    );
    const activateAfterClassRead = request.headers.get(
      "x-test-activate-after-class-read",
    );
    const excludeAfterStudentRead = request.headers.get(
      "x-test-exclude-after-student-read",
    );
    const activateAfterStudentRead = request.headers.get(
      "x-test-activate-after-student-read",
    );
    const studentFieldAfterRead = request.headers.get(
      "x-test-student-field-after-read",
    );
    if (
      requestedScope !== null
      && requestedScope !== "class"
      && requestedScope !== "student"
    ) {
      return Response.json({ error: "Unknown lifecycle scope." }, { status: 400 });
    }
    if (archiveAfterClassRead !== null && archiveAfterClassRead !== "1") {
      return Response.json({ error: "Unknown archive race hook." }, { status: 400 });
    }
    if (activateAfterClassRead !== null && activateAfterClassRead !== "1") {
      return Response.json({ error: "Unknown activate race hook." }, { status: 400 });
    }
    if (excludeAfterStudentRead !== null && excludeAfterStudentRead !== "1") {
      return Response.json({ error: "Unknown student exclude race hook." }, { status: 400 });
    }
    if (activateAfterStudentRead !== null && activateAfterStudentRead !== "1") {
      return Response.json({ error: "Unknown student activate race hook." }, { status: 400 });
    }
    if (
      studentFieldAfterRead !== null
      && studentFieldAfterRead !== "number"
      && studentFieldAfterRead !== "name"
    ) {
      return Response.json({ error: "Unknown student field race hook." }, { status: 400 });
    }
    if (
      injectionHook
      || archiveAfterClassReadHook
      || activateAfterClassReadHook
      || excludeAfterStudentReadHook
      || activateAfterStudentReadHook
      || studentFieldAfterReadHook
    ) {
      return Response.json(
        { error: "A lifecycle injection hook is already active." },
        { status: 409 },
      );
    }
    if (requestedScope) {
      injectionHook = { scope: requestedScope, matched: false };
    }
    if (archiveAfterClassRead === "1") {
      archiveAfterClassReadHook = { matched: false };
    }
    if (activateAfterClassRead === "1") {
      activateAfterClassReadHook = { matched: false };
    }
    if (excludeAfterStudentRead === "1") {
      excludeAfterStudentReadHook = { matched: false };
    }
    if (activateAfterStudentRead === "1") {
      activateAfterStudentReadHook = { matched: false };
    }
    if (studentFieldAfterRead === "number" || studentFieldAfterRead === "name") {
      studentFieldAfterReadHook = { field: studentFieldAfterRead, matched: false };
    }

    try {
      let response: Response;
      if (url.pathname === "/classes" && request.method === "POST") {
        response = await createClass(request);
      } else if (
        url.pathname === "/classes/class-cash-archive/students"
        && request.method === "POST"
      ) {
        response = await addStudents(request, {
          params: Promise.resolve({ classId: "class-cash-archive" }),
        });
      } else if (url.pathname === "/classes/class-cash-archive") {
        response = await patchClass(request, {
          params: Promise.resolve({ classId: "class-cash-archive" }),
        });
      } else if (url.pathname === "/students/student-cash-exclude") {
        response = await patchStudent(request, {
          params: Promise.resolve({ studentId: "student-cash-exclude" }),
        });
      } else {
        response = Response.json({ error: "Unknown lifecycle route." }, { status: 404 });
      }
      return responseWithInjectionStatus(
        response,
        (injectionHook?.matched ?? false)
          || (archiveAfterClassReadHook?.matched ?? false)
          || (activateAfterClassReadHook?.matched ?? false)
          || (excludeAfterStudentReadHook?.matched ?? false)
          || (activateAfterStudentReadHook?.matched ?? false)
          || (studentFieldAfterReadHook?.matched ?? false),
      );
    } finally {
      injectionHook = null;
      archiveAfterClassReadHook = null;
      activateAfterClassReadHook = null;
      excludeAfterStudentReadHook = null;
      activateAfterStudentReadHook = null;
      studentFieldAfterReadHook = null;
    }
  },
};

export default financeCashLifecycleWorker;
