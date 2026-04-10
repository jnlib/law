// ═══════════════════════════════════════
// 법령 검색 Worker — 법제처 지능형 검색 API (aiSearch)
// ═══════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const LAW_API = 'https://www.law.go.kr/DRF/lawSearch.do';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);

    try {
      const OC = env.LAW_API_KEY || 'hdh1231';

      // ── 지능형 법령 검색 ──
      // GET /search?query=도서관&search=0&display=20&page=1
      // search: 0=법령조문, 1=법령별표서식, 2=행정규칙조문, 3=행정규칙별표서식
      if (url.pathname === '/search') {
        const query = url.searchParams.get('query') || '';
        const search = url.searchParams.get('search') || '0';
        const display = url.searchParams.get('display') || '20';
        const page = url.searchParams.get('page') || '1';

        if (!query) return json({ error: '검색어를 입력해주세요' }, 400);

        const qs = new URLSearchParams({
          OC, target: 'aiSearch', type: 'JSON',
          query, search, display, page
        });

        const r = await fetch(`${LAW_API}?${qs}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const text = await r.text();

        // HTML 에러 페이지 체크
        if (text.includes('<!DOCTYPE') || text.includes('error500')) {
          return json({ error: 'API 오류. 법제처 서버 상태를 확인해주세요.' }, 502);
        }

        // JSON 파싱
        try {
          const data = JSON.parse(text);
          return json(data);
        } catch(e) {
          return json({ error: 'JSON 파싱 실패', raw: text.slice(0, 500) }, 502);
        }
      }

      // ── 법령 본문 상세 (일련번호로 조회) ──
      // GET /detail?lawId=279665
      if (url.pathname === '/detail') {
        const lawId = url.searchParams.get('lawId');
        if (!lawId) return json({ error: 'lawId 필요' }, 400);

        const qs = new URLSearchParams({
          OC, target: 'law', type: 'JSON', ID: lawId
        });
        const r = await fetch(`https://www.law.go.kr/DRF/lawService.do?${qs}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const text = await r.text();
        if (text.includes('<!DOCTYPE')) {
          return json({ error: '본문 API 미신청 또는 조회 불가' }, 403);
        }
        try {
          return json(JSON.parse(text));
        } catch(e) {
          return json({ raw: text.slice(0, 50000) });
        }
      }

      // ── 헬스 ──
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ status: 'ok', service: 'law-worker' });
      }

      return json({ error: 'Not Found' }, 404);
    } catch(e) {
      return json({ error: e.message }, 500);
    }
  }
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}
