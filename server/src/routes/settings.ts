// 앱 설정 (key-value). 마진계산기 기준값 등 전 직원 공유 설정.
//   GET  /api/settings/:key  — 활성 사용자 읽기 (없으면 기본값 시드 후 반환)
//   PUT  /api/settings/:key  — admin 전용 쓰기
//
// 기준값(가격·할인·원가)은 서버에 저장되어 전 직원이 동일하게 사용한다.

import { Router } from 'express';
import { store, persistDoc } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import type { AppSetting, WeddingCalcSettings, WCPreset, WCSeason } from '../types.js';

const router = Router();
router.use(requireActiveRole);

// 엑셀 기준값 매트릭스 (구간1·구간2·요일·타임) — 보증 250 기준.
function P(period: string, season: WCSeason, day: '토' | '일', time: '점심' | '저녁',
  p: number, c: number, dir: number, fl: number, w: number, r: boolean, fx: number, m: number): WCPreset {
  return { period, season, day, time, discount: p, coursePrice: c, director: dir, flower: fl, wine: w, reception: r, fixed: fx, marginRate: m };
}
function DEFAULT_PRESETS(): WCPreset[] {
  const out: WCPreset[] = [];
  for (const s of ['워크인', '임직원'] as WCSeason[]) {
    out.push(P('~26.8', s, '토', '점심', 7, 92000, 5000000, 8000000, 20, true, 4590000, 42));
    out.push(P('~26.8', s, '토', '저녁', 12, 92000, 4500000, 8800000, 20, true, 4440000, 39));
    out.push(P('~26.8', s, '일', '점심', 10, 92000, 4500000, 8800000, 20, true, 4440000, 40));
  }
  out.push(P('~26.8', '비수기', '토', '점심', 7, 92000, 5000000, 8000000, 20, true, 4590000, 45));
  out.push(P('~26.8', '비수기', '토', '저녁', 12, 92000, 4500000, 8800000, 20, true, 4440000, 42));
  out.push(P('~26.8', '비수기', '일', '점심', 10, 92000, 4500000, 8800000, 20, true, 4440000, 43));
  out.push(P('~26.12', '워크인', '토', '점심', 5, 100000, 8000000, 8000000, 10, true, 4590000, 50));
  out.push(P('~26.12', '워크인', '토', '저녁', 10, 100000, 6000000, 8000000, 20, true, 4440000, 46));
  out.push(P('~26.12', '워크인', '일', '점심', 8, 100000, 7000000, 8000000, 15, true, 4440000, 48));
  out.push(P('~26.12', '임직원', '토', '점심', 5, 100000, 6500000, 8000000, 20, true, 4590000, 48));
  out.push(P('~26.12', '임직원', '토', '저녁', 10, 100000, 5000000, 8000000, 20, true, 4440000, 44));
  out.push(P('~26.12', '임직원', '일', '점심', 8, 100000, 5500000, 8000000, 20, true, 4440000, 46));
  out.push(P('~27.2', '비수기', '토', '점심', 8, 100000, 6000000, 8000000, 10, true, 4590000, 46));
  out.push(P('~27.2', '비수기', '토', '저녁', 10, 100000, 5000000, 8000000, 20, true, 4440000, 44));
  out.push(P('~27.2', '비수기', '일', '점심', 8, 100000, 5500000, 8000000, 15, true, 4440000, 46));
  out.push(P('~27.8', '워크인', '토', '점심', 5, 100000, 8300000, 8800000, 10, true, 4590000, 50));
  out.push(P('~27.8', '워크인', '토', '저녁', 10, 100000, 7000000, 8800000, 20, true, 4440000, 47));
  out.push(P('~27.8', '워크인', '일', '점심', 8, 100000, 8000000, 8800000, 15, true, 4440000, 49));
  out.push(P('~27.8', '임직원', '토', '점심', 5, 100000, 7000000, 8800000, 20, true, 4590000, 48));
  out.push(P('~27.8', '임직원', '토', '저녁', 10, 100000, 5000000, 8800000, 20, true, 4440000, 44));
  out.push(P('~27.8', '임직원', '일', '점심', 8, 100000, 6000000, 8800000, 20, true, 4440000, 46));
  out.push(P('~27.8', '비수기', '토', '점심', 8, 100000, 6000000, 8800000, 20, true, 4590000, 46));
  out.push(P('~27.8', '비수기', '토', '저녁', 10, 100000, 5000000, 8800000, 20, true, 4440000, 44));
  out.push(P('~27.8', '비수기', '일', '점심', 8, 100000, 5500000, 8800000, 20, true, 4440000, 45));
  out.push(P('~28.8', '워크인', '토', '점심', 14, 120000, 8300000, 8800000, 10, false, 4440000, 53));
  out.push(P('~28.8', '워크인', '토', '저녁', 19, 120000, 7300000, 8800000, 20, false, 4440000, 50));
  out.push(P('~28.8', '워크인', '일', '점심', 17, 120000, 8300000, 8800000, 15, false, 4440000, 52));
  out.push(P('~28.8', '임직원', '토', '점심', 14, 120000, 7300000, 8800000, 20, true, 4440000, 51));
  out.push(P('~28.8', '임직원', '토', '저녁', 19, 120000, 6300000, 8800000, 20, true, 4440000, 48));
  out.push(P('~28.8', '임직원', '일', '점심', 17, 120000, 7300000, 8800000, 20, true, 4440000, 50));
  out.push(P('~28.8', '비수기', '토', '점심', 17, 120000, 6800000, 8800000, 20, true, 4440000, 50));
  out.push(P('~28.8', '비수기', '토', '저녁', 21, 120000, 6300000, 8800000, 20, true, 4440000, 47));
  out.push(P('~28.8', '비수기', '일', '점심', 21, 120000, 6800000, 8800000, 20, true, 4440000, 48));
  return out;
}

// 웨딩 마진계산기 기본 기준값 (참조 HTML의 DEFAULT 이식).
const DEFAULT_WEDDING_CALC: WeddingCalcSettings = {
  price: [
    { label: '~26.08', from: '0000-00-00', A: 92000, B: 99000, C: 119000, fB: 8000000, fL: 10500000, fG: 14000000 },
    { label: '26.09~', from: '2026-09-01', A: 100000, B: 110000, C: 130000, fB: 8800000, fL: 11500000, fG: 15500000 },
    { label: '27.03~', from: '2027-03-01', A: 100000, B: 110000, C: 130000, fB: 8800000, fL: 11500000, fG: 15500000 },
  ],
  courseDesc: {
    A: '안심 스테이크 포함 5가지 프리미엄 양식 코스',
    B: '5가지 프리미엄 양식 콤비 코스',
    C: '6가지 프리미엄 양식 코스',
  },
  flowerDesc: {
    basic: '커스터마이징 / 생화 전체 랩핑 포장 · 버진로드 입구·단상·테이블 센터피스·신부대기실·포토테이블',
    lux: 'BASIC + 버진로드 입구 볼륨 3배 추가 + 신부대기실 볼륨 UP',
    grand: 'LUXURY + 신부대기실 최대 볼륨 + 버진로드 꽃길 + 무대 + 포토월 풀패키지',
  },
  rentList: 19000000,
  rentSpecial: 8500000,
  noodleP: 5000,
  rentItems: [
    { n: '홀 대관료', rmk: '예식 2시간 (예식 간격 6시간)' },
    { n: '예식연출(미디어월)', rmk: '대형 400인치 LED 미디어월 1-2부 예식 연출' },
    { n: '웨딩조명', rmk: '웨딩 조명연출' },
    { n: '웨딩무대', rmk: '웨딩 무대 + 버진로드 세팅' },
    { n: '홀 장식', rmk: '홀 천장 장식 세팅 (휘장)' },
    { n: '포토테이블', rmk: '포토테이블 세팅 (액자 최대 8개 / 인화 사진 별도)' },
    { n: '포토백월(로비)', rmk: '플렌티 화이트 포토월 기본 세팅(로비)' },
    { n: '웨딩용품', rmk: '방명록·성혼선언문·봉투·펜·장갑·웨딩 메뉴카드' },
  ],
  optItems: [
    { n: '웨딩중계', p: 1000000, rmk: '홀 중계(빔프로젝터+스크린 2대), 신부대기실 TV 중계', minG: 0 },
    { n: '서브홀 대관료', p: 1300000, rmk: '보증 273명 이상 必 · 서브홀 세팅 및 중계(TV 1대 포함)', minG: 273 },
    { n: '중계TV 추가', p: 200000, rmk: '보증 320명 이상 必 · 중계 TV 1대 추가', minG: 320 },
  ],
  otherItems: [
    { n: '신부대기실 핑거푸드', p: 550000, rmk: '쿠키·초콜릿·마카롱 등 제공', svc: true },
    { n: '2부 케익 + 샴페인', p: 550000, rmk: '2부 케익(실물 1단+클레이 4단) + 샴페인 1병', svc: true },
    { n: '레드와인(SVC)', p: 60000, qty: 20, qtyMode: true, rmk: '당일 와인 소모량 중 SVC 제공 (일자·보증인원·가톨릭 여부별 수량 상이)', svc: true },
    { n: '웰컴 리셉션', p: 1000000, rmk: '1시간 전 로비 리셉션(샴페인/주스 택1) · 후기·만족도 설문 작성', svc: true },
    { n: '웨딩 스냅 현수막', p: 880000, rmk: '로비 배너(스냅) 현수막 주문제작 세팅&철수', svc: false, off: true },
    { n: '포토백월 현수막', p: 880000, rmk: '포토백월 현수막 주문제작 세팅&철수', svc: false, off: true },
  ],
  bevItems: [
    { n: '레드와인', p: 60000, rmk: '테이블 세팅 / 테이블당 1 BTL 게런티' },
    { n: '소주(병)', p: 11000, rmk: '테이블 세팅 / 당일 실수량 정산' },
    { n: '맥주(병)', p: 10000, rmk: '테이블 세팅 / 당일 실수량 정산' },
    { n: '소프트드링크(캔)', p: 6000, rmk: '테이블 세팅 / 당일 실수량 정산' },
  ],
  ctypes: [
    { name: '가톨릭 동문', mealDisc: 5, flowerUp: true },
    { name: '성모병원 임직원', mealDisc: 5, flowerUp: true },
    { name: '워크인·컨설팅', mealDisc: 5, flowerUp: false },
    { name: '일반', mealDisc: 0, flowerUp: false },
  ],
  cost: { foodA: 21975, foodB: 25800, foodC: 32000, extPP: 11012, fixed: 4440000, flowerCostR: 85, intBurden: 12.1, comBurden: 11.8 },
  presets: DEFAULT_PRESETS(),
  tierTeamlead: { lunchSat: 50, other: 44 },
  tierExecFloor: 38,
};

const DEFAULTS: Record<string, unknown> = {
  'wedding-calc': DEFAULT_WEDDING_CALC,
  // 월별 주류(베버리지) 매출 — 매출관리 파일 기준 수기 입력/연동.
  //   revenue: { 'YYYY-MM': 금액 }, alertThreshold: 주류행사 조기경보 임계치(건)
  'beverage': { revenue: {}, alertThreshold: 2 },
  // 웨딩 고객 랜딩 미디어 (Storage 공개 URL 모음) — 공개 랜딩이 서버에서 직접 읽어 포함.
  'wedding-landing-media': {
    hall_video_url: '',
    full_video_url: '',
    flower_photos: { basic: [], luxury: [], grand: [] },
    menu_photos: { a: [], b: [], c: [] },
    directions_image: '',
    kakao_url: 'https://pf.kakao.com/_xfGwxob',
  },
};

function findSetting(key: string): AppSetting | undefined {
  return store.settings.find((s) => s.id === key);
}

// GET /api/settings/:key
router.get('/:key', (req, res) => {
  const key = req.params.key;
  let setting = findSetting(key);
  if (!setting) {
    const def = DEFAULTS[key];
    if (def === undefined) return res.status(404).json({ error: 'unknown_setting' });
    // 최초 조회 시 기본값 시드
    setting = { id: key, key, value: def, updated_at: new Date().toISOString() };
    store.settings.push(setting);
    persistDoc('settings', key);
  }
  res.json({ setting });
});

// PUT /api/settings/:key  (admin 전용)
router.put('/:key', (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const key = req.params.key;
  if (DEFAULTS[key] === undefined) return res.status(404).json({ error: 'unknown_setting' });

  const value = (req.body as { value?: unknown }).value;
  if (value === undefined) return res.status(400).json({ error: 'value_required' });

  let setting = findSetting(key);
  const now = new Date().toISOString();
  if (setting) {
    setting.value = value;
    setting.updated_at = now;
    setting.updated_by = req.user!.id;
  } else {
    setting = { id: key, key, value, updated_at: now, updated_by: req.user!.id };
    store.settings.push(setting);
  }
  persistDoc('settings', key);
  res.json({ setting });
});

export default router;
