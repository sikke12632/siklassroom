import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((item) => {
  const [key, ...value] = item.replace(/^--/, "").split("=");
  return [key, value.join("=") || "true"];
}));
const outputPath = resolve(String(args.output || ".data/schools.sql"));
const sourceUpdatedAt = Date.now();

function normalize(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, "").toLowerCase();
}

function searchName(value) {
  let result = normalize(value).replace(/[()\-·.,]/g, "");
  for (const [full, short] of [["초등학교", "초"], ["중학교", "중"], ["고등학교", "고"]]) {
    if (result.endsWith(full)) result = `${result.slice(0, -full.length)}${short}`;
  }
  return result;
}

function quote(value) {
  if (value == null || value === "") return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stableId(prefix, value) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function aliasesFor(name) {
  const values = new Set([normalize(name), searchName(name)]);
  const canonical = normalize(name);
  for (const suffix of ["초등학교", "중학교", "고등학교"]) {
    if (canonical.endsWith(suffix)) values.add(canonical.slice(0, -suffix.length));
  }
  return [...values].filter((value) => value.length >= 2);
}

async function fetchSchools() {
  const key = process.env.NEIS_API_KEY;
  if (!key) throw new Error("NEIS_API_KEY 환경 변수가 필요합니다.");
  const rows = [];
  const pageSize = 1000;
  for (let page = 1; ; page += 1) {
    const url = new URL("https://open.neis.go.kr/hub/schoolInfo");
    url.search = new URLSearchParams({
      KEY: key,
      Type: "json",
      pIndex: String(page),
      pSize: String(pageSize),
    }).toString();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`나이스 API 요청 실패: ${response.status}`);
    const body = await response.json();
    const service = body.schoolInfo;
    if (!Array.isArray(service)) {
      const message = body.RESULT?.MESSAGE || "학교 데이터를 읽지 못했습니다.";
      throw new Error(message);
    }
    const pageRows = service.find((item) => Array.isArray(item.row))?.row ?? [];
    rows.push(...pageRows);
    const total = Number(service[0]?.head?.[0]?.list_total_count ?? rows.length);
    if (rows.length >= total || pageRows.length < pageSize) break;
  }
  return rows;
}

async function loadRows() {
  if (args.input) {
    const body = JSON.parse(await readFile(resolve(String(args.input)), "utf8"));
    return Array.isArray(body) ? body : body.schoolInfo?.find((item) => Array.isArray(item.row))?.row ?? [];
  }
  return fetchSchools();
}

const rawRows = await loadRows();
const unique = new Map();
for (const row of rawRows) {
  const officeCode = String(row.ATPT_OFCDC_SC_CODE ?? "").trim();
  const schoolCode = String(row.SD_SCHUL_CODE ?? "").trim();
  const officialName = String(row.SCHUL_NM ?? "").normalize("NFC").trim();
  if (!officeCode || !schoolCode || !officialName) {
    throw new Error("필수 학교 코드 또는 학교명이 빈 행이 있습니다.");
  }
  const key = `${officeCode}|${schoolCode}`;
  if (unique.has(key)) throw new Error(`중복 학교 코드: ${key}`);
  unique.set(key, {
    id: `neis:${officeCode}:${schoolCode}`,
    officeCode,
    schoolCode,
    officialName,
    normalizedName: normalize(officialName),
    searchName: searchName(officialName),
    schoolLevel: String(row.SCHUL_KND_SC_NM ?? "기타").trim(),
    provinceName: String(row.LCTN_SC_NM ?? row.ATPT_OFCDC_SC_NM ?? "미지정").trim(),
    districtName: String(row.JU_ORG_NM ?? "").trim() || null,
    roadAddress: String(row.ORG_RDNMA ?? "").trim() || null,
  });
}

const lines = [
  "BEGIN;",
  "CREATE TEMP TABLE IF NOT EXISTS imported_school_codes (office_code TEXT NOT NULL, school_code TEXT NOT NULL, PRIMARY KEY (office_code, school_code));",
  "DELETE FROM imported_school_codes;",
];
for (const school of unique.values()) {
  lines.push(
    `INSERT INTO imported_school_codes (office_code, school_code) VALUES (${quote(school.officeCode)}, ${quote(school.schoolCode)});`,
    `INSERT INTO schools (id, office_code, school_code, official_name, normalized_name, search_name, school_level, province_name, district_name, road_address, status, source, source_updated_at, created_at, updated_at)
     VALUES (${quote(school.id)}, ${quote(school.officeCode)}, ${quote(school.schoolCode)}, ${quote(school.officialName)}, ${quote(school.normalizedName)}, ${quote(school.searchName)}, ${quote(school.schoolLevel)}, ${quote(school.provinceName)}, ${quote(school.districtName)}, ${quote(school.roadAddress)}, 'active', 'neis', ${sourceUpdatedAt}, ${sourceUpdatedAt}, ${sourceUpdatedAt})
     ON CONFLICT(office_code, school_code) DO UPDATE SET official_name=excluded.official_name, normalized_name=excluded.normalized_name, search_name=excluded.search_name, school_level=excluded.school_level, province_name=excluded.province_name, district_name=excluded.district_name, road_address=excluded.road_address, status='active', source_updated_at=excluded.source_updated_at, updated_at=excluded.updated_at;`,
  );
  for (const alias of aliasesFor(school.officialName)) {
    const aliasId = stableId("alias", `${school.id}|${alias}`);
    lines.push(
      `INSERT INTO school_aliases (id, school_id, alias, normalized_alias, alias_type)
       VALUES (${quote(aliasId)}, ${quote(school.id)}, ${quote(alias)}, ${quote(alias)}, 'generated')
       ON CONFLICT(school_id, normalized_alias) DO UPDATE SET alias=excluded.alias, alias_type=excluded.alias_type;`,
    );
  }
}
lines.push(
  "UPDATE schools SET status='inactive', updated_at=" + sourceUpdatedAt + " WHERE source='neis' AND NOT EXISTS (SELECT 1 FROM imported_school_codes i WHERE i.office_code=schools.office_code AND i.school_code=schools.school_code);",
  "COMMIT;",
);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
process.stdout.write(JSON.stringify({
  output: outputPath,
  received: rawRows.length,
  unique: unique.size,
  duplicates: rawRows.length - unique.size,
}, null, 2) + "\n");
