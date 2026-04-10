// ═══════════════════════════════════════
// 법령 검색 Worker — 법제처 OPEN API 프록시
// ═══════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// open.law.go.kr는 Cloudflare에서 접근 가능
const LAW_BASE = 'https://open.law.go.kr/LSO/DRF';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);

    try {
      const OC = env.LAW_API_KEY || 'hdh1231';

      // ── 법령 검색 ──
      // GET /search?query=도서관&target=law&page=1&display=20
      if (url.pathname === '/search' && request.method === 'GET') {
        const query = url.searchParams.get('query') || '';
        const target = url.searchParams.get('target') || 'law'; // law, admrul, ordin, prec
        const page = url.searchParams.get('page') || '1';
        const display = url.searchParams.get('display') || '20';
        const sort = url.searchParams.get('sort') || 'lasc'; // lasc(법령명순), prdt(공포일순)

        if (!query) return json({ error: '검색어를 입력해주세요' }, 400);

        const qs = new URLSearchParams({ OC, target, type: 'XML', query, page, display, sort });
        const r = await fetch(`${LAW_BASE}/lawSearch.do?${qs}`, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
        });
        const xml = await r.text();

        // XML이 아니라 HTML 에러 페이지 반환하면 처리
        if (xml.includes('<!DOCTYPE') || xml.includes('error500') || xml.includes('error') || !xml.includes('<?xml')) {
          // 에러 종류 감지
          if (xml.includes('error500') || xml.includes('OPEN API')) {
            return json({ error: 'API 미신청 상태입니다. open.law.go.kr → 로그인 → OPEN API → OPEN API 신청에서 법령종류를 체크해주세요.' }, 403);
          }
          return json({ error: 'API 응답 오류. 법제처 서버 상태를 확인해주세요.', raw: xml.slice(0, 500) }, 502);
        }

        const parsed = parseSearchXML(xml, target);
        return json(parsed);
      }

      // ── 법령 상세 조회 ──
      // GET /detail?id=법령ID&target=law
      if (url.pathname === '/detail' && request.method === 'GET') {
        const id = url.searchParams.get('id');
        const target = url.searchParams.get('target') || 'law';
        if (!id) return json({ error: 'id 필요' }, 400);

        const qs = new URLSearchParams({ OC, target, type: 'XML', ID: id });
        const r = await fetch(`${LAW_BASE}/lawService.do?${qs}`);
        const xml = await r.text();

        if (xml.includes('<!DOCTYPE') || xml.includes('error500') || !xml.includes('<?xml')) {
          return json({ error: 'API 미신청 또는 상세 조회 불가' }, 403);
        }

        const parsed = parseDetailXML(xml, target);
        return json(parsed);
      }

      // ── 조문 조회 ──
      // GET /jomun?id=법령ID
      if (url.pathname === '/jomun' && request.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id) return json({ error: 'id 필요' }, 400);

        const qs = new URLSearchParams({ OC, target: 'jo', type: 'XML', ID: id, JO: '0' });
        const r = await fetch(`${LAW_BASE}/lawService.do?${qs}`);
        const xml = await r.text();

        if (xml.includes('<!DOCTYPE') || xml.includes('error500') || !xml.includes('<?xml')) {
          return json({ error: 'API 미신청 또는 조문 조회 불가' }, 403);
        }

        return json({ xml: xml.slice(0, 50000) }); // 원본 XML 반환 (파싱은 프론트에서)
      }

      // ── 헬스 체크 ──
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ status: 'ok', service: 'law-worker', apiKey: OC ? 'set' : 'missing' });
      }

      return json({ error: 'Not Found' }, 404);

    } catch(e) {
      return json({ error: e.message }, 500);
    }
  }
};

// ── XML 파싱: 검색 결과 ──
function parseSearchXML(xml, target) {
  const totalCount = extractTag(xml, 'totalCnt') || extractTag(xml, 'totalcount') || '0';
  const page = extractTag(xml, 'page') || '1';

  // 법령 목록 추출
  const items = [];
  const tagName = target === 'prec' ? 'prec' : (target === 'admrul' ? 'admrul' : 'law');
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const chunk = match[1];
    const item = {
      id: extractTag(chunk, '법령일련번호') || extractTag(chunk, 'ID') || extractTag(chunk, '판례일련번호'),
      name: extractTag(chunk, '법령명약칭') || extractTag(chunk, '법령명') || extractTag(chunk, '행정규칙명') || extractTag(chunk, '사건명') || extractTag(chunk, '자치법규명'),
      fullName: extractTag(chunk, '법령명'),
      type: extractTag(chunk, '법령구분') || extractTag(chunk, '행정규칙종류') || target,
      promulgateDate: extractTag(chunk, '공포일자') || extractTag(chunk, '시행일자') || extractTag(chunk, '선고일자'),
      promulgateNo: extractTag(chunk, '공포번호') || extractTag(chunk, '사건번호'),
      enforceDate: extractTag(chunk, '시행일자'),
      ministry: extractTag(chunk, '소관부처') || extractTag(chunk, '소관부처명'),
      link: extractTag(chunk, '법령상세링크') || extractTag(chunk, '조문체계도링크'),
    };
    if (item.id || item.name) items.push(item);
  }

  return { totalCount: parseInt(totalCount), page: parseInt(page), items };
}

// ── XML 파싱: 상세 ──
function parseDetailXML(xml, target) {
  return {
    id: extractTag(xml, '법령일련번호') || extractTag(xml, 'ID'),
    name: extractTag(xml, '법령명약칭') || extractTag(xml, '법령명') || extractTag(xml, '행정규칙명'),
    fullName: extractTag(xml, '법령명'),
    type: extractTag(xml, '법령구분'),
    promulgateDate: extractTag(xml, '공포일자'),
    promulgateNo: extractTag(xml, '공포번호'),
    enforceDate: extractTag(xml, '시행일자'),
    ministry: extractTag(xml, '소관부처명') || extractTag(xml, '소관부처'),
    purpose: extractTag(xml, '제정이유') || extractTag(xml, '제개정이유'),
    xml: xml.slice(0, 100000), // 원본 포함 (조문 등 프론트 파싱용)
  };
}

// ── XML 헬퍼 ──
function extractTag(xml, tag) {
  // CDATA도 처리
  const regex = new RegExp(`<${tag}>(?:\\s*<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>\\s*)?<\\/${tag}>`, 'i');
  const m = xml.match(regex);
  return m ? m[1].trim() : null;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}
