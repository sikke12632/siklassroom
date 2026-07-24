import { database, ensureSchema } from "@/lib/database";
import { cleanDisplayText, normalizeSchool } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { normalizeSchoolSearch } from "@/lib/schools";
import { requireAdmin } from "@/lib/teacher-verification";

type ImportSchool = {
  officeCode?: string;
  schoolCode?: string;
  officialName?: string;
  schoolLevel?: string;
  provinceName?: string;
  districtName?: string;
  roadAddress?: string;
};

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    await ensureSchema();
    const body = await readJson<{ schools?: ImportSchool[] }>(request);
    if (!Array.isArray(body.schools) || !body.schools.length || body.schools.length > 25) {
      throw new ApiError(400, "한 번에 1~25개 학교를 가져올 수 있습니다.", "INVALID_IMPORT_SIZE");
    }
    const now = Date.now();
    const rows = body.schools.map((item, index) => {
      const officeCode = cleanDisplayText(item.officeCode, 20);
      const schoolCode = cleanDisplayText(item.schoolCode, 20);
      const officialName = cleanDisplayText(item.officialName, 80);
      const schoolLevel = cleanDisplayText(item.schoolLevel, 30);
      const provinceName = cleanDisplayText(item.provinceName, 30);
      if (!officeCode || !schoolCode || !officialName || !schoolLevel || !provinceName) {
        throw new ApiError(400, `${index + 1}번째 학교의 필수 정보가 비어 있습니다.`, "INVALID_SCHOOL_IMPORT");
      }
      return {
        id: `neis:${officeCode}:${schoolCode}`,
        officeCode,
        schoolCode,
        officialName,
        normalizedName: normalizeSchool(officialName),
        searchName: normalizeSchoolSearch(officialName),
        schoolLevel,
        provinceName,
        districtName: cleanDisplayText(item.districtName, 80) || null,
        roadAddress: cleanDisplayText(item.roadAddress, 160) || null,
      };
    });
    const keys = new Set(rows.map((row) => `${row.officeCode}|${row.schoolCode}`));
    if (keys.size !== rows.length) throw new ApiError(409, "가져오기 목록에 중복 학교 코드가 있습니다.", "DUPLICATE_SCHOOL_CODE");
    const statements = rows.map((row) => database().prepare(
      `INSERT INTO schools
       (id, office_code, school_code, official_name, normalized_name, search_name, school_level,
        province_name, district_name, road_address, status, source, source_updated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'neis', ?, ?, ?)
       ON CONFLICT(office_code, school_code) DO UPDATE SET
         official_name=excluded.official_name, normalized_name=excluded.normalized_name,
         search_name=excluded.search_name, school_level=excluded.school_level,
         province_name=excluded.province_name, district_name=excluded.district_name,
         road_address=excluded.road_address, status='active',
         source_updated_at=excluded.source_updated_at, updated_at=excluded.updated_at`,
    ).bind(
      row.id, row.officeCode, row.schoolCode, row.officialName, row.normalizedName,
      row.searchName, row.schoolLevel, row.provinceName, row.districtName, row.roadAddress,
      now, now, now,
    ));
    await database().batch(statements);
    return json({ imported: rows.length, schools: rows.map(({ id, officialName }) => ({ id, officialName })) });
  } catch (error) {
    return apiFailure(error);
  }
}
