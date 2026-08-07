// 사용자 정의 피벗 통계 API (로드맵 A8).
//
// 집계는 서버에서 한다. 클라이언트가 행사 977건 + 고객 2,900건을 매번 받아 계산하면
// 축을 바꿀 때마다 전량 재요청이 되고(프론트 캐시 계층 B1 미도입), 화면마다 계산이
// 갈라져 숫자가 어긋난다. 여기서 집계해 결과만 내려보내면 페이로드도 작고,
// 나중에 경영진 에이전트가 같은 숫자를 물어볼 때도 이 API 를 그대로 쓸 수 있다.
import { Router } from 'express';
import { requireActiveRole } from '../middleware/auth.js';
import { datasetMeta, runPivot, runFunnel } from '../lib/pivot.js';
import type { DatasetId, PivotRequest } from '../lib/pivot.js';

const router = Router();
router.use(requireActiveRole);

/** 어떤 축·측정값을 고를 수 있는지 — 화면의 드롭다운을 이걸로 그린다. */
router.get('/meta', (_req, res) => {
  res.json({ datasets: datasetMeta() });
});

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

router.post('/pivot', (req, res) => {
  const b = req.body as Record<string, unknown>;
  const dataset = str(b.dataset) as DatasetId | null;
  const row_field = str(b.row_field);
  const measure = str(b.measure);
  if (!dataset || !row_field || !measure) {
    return res.status(400).json({ error: 'dataset, row_field, measure 는 필수입니다.' });
  }

  const filters: Record<string, string[]> = {};
  if (b.filters && typeof b.filters === 'object') {
    for (const [k, v] of Object.entries(b.filters as Record<string, unknown>)) {
      if (Array.isArray(v)) filters[k] = v.filter((x): x is string => typeof x === 'string');
    }
  }

  const request: PivotRequest = {
    dataset,
    row_field,
    col_field: str(b.col_field),
    measure,
    date_from: str(b.date_from),
    date_to: str(b.date_to),
    filters,
    // 검색 키워드처럼 값이 수백 개인 축을 그대로 그리면 표가 못 쓰게 된다.
    top_rows: typeof b.top_rows === 'number' && b.top_rows > 0 ? Math.min(b.top_rows, 200) : 50,
  };

  try {
    res.json(runPivot(request));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.get('/funnel', (req, res) => {
  const type = req.query.type === 'WEDDING' ? 'WEDDING' : 'MICE';
  const channel = str(req.query.channel);
  res.json(
    runFunnel({
      type,
      from: str(req.query.from),
      to: str(req.query.to),
      // 유입 채널 구분은 MICE 문의에만 있는 필드다.
      channel: type === 'MICE' ? channel : null,
    })
  );
});

export default router;
