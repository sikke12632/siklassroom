import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  STUDENT_PERMISSION_KEYS,
  automaticPermissionForTemplate,
  parseStudentPermissionKey,
  permissionSource,
} from "../lib/student-permission-rules";

test("운영 권한 키는 현재 실제 서비스 역할 다섯 종류만 허용한다", () => {
  assert.deepEqual(STUDENT_PERMISSION_KEYS, [
    "finance_banker",
    "mart_operator",
    "life_check_tooth",
    "life_check_milk",
    "life_check_lunch",
  ]);
  for (const key of STUDENT_PERMISSION_KEYS) assert.equal(parseStudentPermissionKey(key), key);
  assert.equal(parseStudentPermissionKey("teacher"), null);
  assert.equal(parseStudentPermissionKey(""), null);
});

test("직업 자동 권한과 교사 직접 권한은 서로 덮어쓰지 않고 합쳐진다", () => {
  assert.equal(automaticPermissionForTemplate("banker"), "finance_banker");
  assert.equal(automaticPermissionForTemplate("market-clerk"), "mart_operator");
  assert.equal(automaticPermissionForTemplate("routine-checker"), "life_check_tooth");
  assert.equal(automaticPermissionForTemplate("milk-manager"), "life_check_milk");
  assert.equal(automaticPermissionForTemplate("meal-checker"), "life_check_lunch");
  assert.equal(automaticPermissionForTemplate("classroom-cleaner"), null);
  assert.equal(permissionSource({ automatic: true, manual: false }), "automatic");
  assert.equal(permissionSource({ automatic: false, manual: true }), "manual");
  assert.equal(permissionSource({ automatic: true, manual: true }), "both");
  assert.equal(permissionSource({ automatic: false, manual: false }), null);
});

test("직접 권한 API는 소유권·활성 학급·revision·감사를 한 원자 작업으로 지킨다", async () => {
  const source = await readFile(
    new URL("../app/api/students/[studentId]/permissions/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /requireClassManagement\(request\)/);
  assert.match(source, /ownedActiveStudent\(teacherId, studentId\)/);
  assert.match(source, /expectedRevision/);
  assert.match(source, /registration_operation_guards/);
  assert.match(source, /student_manual_permission_update/);
  assert.match(source, /student-permission-period:/);
  assert.match(source, /database\(\)\.batch\(\[/);
  assert.match(source, /student_manual_permission_granted/);
  assert.match(source, /student_manual_permission_revoked/);
  assert.match(source, /INSERT INTO audit_logs/);
  assert.doesNotMatch(source, /ON CONFLICT/);
  assert.doesNotMatch(source, /DELETE FROM sessions/);
});

test("교사 화면은 직업 자동 권한과 교사 직접 권한을 분리해 보여 준다", async () => {
  const [portal, studentsRoute] = await Promise.all([
    readFile(new URL("../app/teacher/TeacherPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/students/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(portal, /운영 권한/);
  assert.match(portal, /직업 자동 권한 있음/);
  assert.match(portal, /직업 자동 \+ 교사 직접 권한/);
  assert.match(portal, /교사 직접 권한/);
  assert.match(portal, /직업에서 받은 자동 권한은 그대로 유지됩니다/);
  assert.match(studentsRoute, /automatic_permissions/);
  assert.match(studentsRoute, /manual_permissions/);
  assert.match(studentsRoute, /permission_source = 'automatic'/);
});

test("모든 권한 소비자는 통합된 유효 권한을 서버와 D1에서 다시 확인한다", async () => {
  const [financeAccess, financeSchema, martAccess, martSchema, lifeAccess, lifeSchema] = await Promise.all([
    readFile(new URL("../lib/finance-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/mart-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/mart-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/life-check-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/life-check-schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(financeAccess, /manualPermissions\.has\("finance_banker"\)/);
  assert.match(financeSchema, /student_effective_permissions/);
  assert.match(martAccess, /manualPermissionKeys\.includes\("mart_operator"\)/);
  assert.match(martSchema, /permission\.permission_key = 'mart_operator'/);
  assert.match(lifeAccess, /manualPermissions\.has\(manualKeyForType\[type\]\)/);
  for (const key of ["life_check_tooth", "life_check_milk", "life_check_lunch"]) {
    assert.match(lifeSchema, new RegExp(key));
  }
});
