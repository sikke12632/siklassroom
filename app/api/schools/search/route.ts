import { requireEmailVerified } from "@/lib/auth";
import { database } from "@/lib/database";
import { cleanDisplayText } from "@/lib/identity";
import { ApiError, apiFailure, json } from "@/lib/responses";
import { normalizeSchoolSearch, PROVINCES, SCHOOL_LEVELS } from "@/lib/schools";

export async function GET(request: Request) {
  try {
    await requireEmailVerified(request);
    const url = new URL(request.url);
    const query = normalizeSchoolSearch(url.searchParams.get("q"));
    if (query.length < 2) return json({ schools: [] });
    if (query.length > 60) throw new ApiError(400, "검색어가 너무 깁니다.", "INVALID_SCHOOL_QUERY");
    const province = cleanDisplayText(url.searchParams.get("province"), 30);
    const level = cleanDisplayText(url.searchParams.get("level"), 20);
    if (province && !(PROVINCES as readonly string[]).includes(province)) {
      throw new ApiError(400, "시도 필터를 다시 확인해 주세요.", "INVALID_PROVINCE");
    }
    if (level && !(SCHOOL_LEVELS as readonly string[]).includes(level)) {
      throw new ApiError(400, "학교급 필터를 다시 확인해 주세요.", "INVALID_SCHOOL_LEVEL");
    }
    const result = await database().prepare(
      `SELECT DISTINCT s.id, s.official_name, s.province_name, s.school_level,
              s.district_name, s.road_address
       FROM schools s
       LEFT JOIN school_aliases a ON a.school_id = s.id
       WHERE s.status = 'active'
         AND (s.search_name LIKE ? OR s.normalized_name LIKE ? OR a.normalized_alias LIKE ?)
         AND (? = '' OR s.province_name = ?)
         AND (? = '' OR s.school_level = ?)
       ORDER BY
         CASE WHEN s.search_name = ? THEN 0 WHEN s.search_name LIKE ? THEN 1 ELSE 2 END,
         s.official_name ASC
       LIMIT 20`,
    ).bind(
      `${query}%`, `%${query}%`, `${query}%`,
      province, province, level, level,
      query, `${query}%`,
    ).all();
    return json({ schools: result.results });
  } catch (error) {
    return apiFailure(error);
  }
}
