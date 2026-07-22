// 웨딩 마진계산기 — 순수 계산 로직.
// 참조 HTML(PLENTY_웨딩_견적빌더_마진계산기.html)의 DEFAULT / calc() / tier() 를 그대로 포팅.
// 기준값(CFG)은 서버 settings(/api/settings/wedding-calc)에서 주입한다.

// ── 기준값 타입 ──────────────────────────────────────────────────────────────
export type FlowerGrade = 'basic' | 'lux' | 'grand';
export type CourseKey = 'A' | 'B' | 'C';

export interface WCPriceTier { label: string; from: string; A: number; B: number; C: number; fB: number; fL: number; fG: number; }
export interface WCRentItem { n: string; rmk: string; }
export interface WCOptItem { n: string; p: number; rmk: string; minG: number; }
export interface WCOtherItem { n: string; p: number; rmk: string; svc: boolean; qty?: number; qtyMode?: boolean; off?: boolean; }
export interface WCBevItem { n: string; p: number; rmk: string; }
export interface WCCtype { name: string; mealDisc: number; flowerUp: boolean; }
export interface WCCost {
  foodA: number; foodB: number; foodC: number; extPP: number; fixed: number;
  flowerCostR: number; intBurden: number; comBurden: number;
}

// 시즌(구간2): 성수기 워크인 / 성수기 임직원 / 비수기
export type WCSeason = '워크인' | '임직원' | '비수기';
export type WCDay = '토' | '일';
export type WCTimeSlot = '점심' | '저녁';

// 기본값(preset) 한 행 — 엑셀의 (구간1·구간2·요일·타임)별 표준 기준값.
export interface WCPreset {
  period: string;       // 구간1 라벨: '~26.8' 등
  season: WCSeason;     // 구간2
  day: WCDay;
  time: WCTimeSlot;
  discount: number;     // 할인%
  coursePrice: number;  // 정가 (A코스 기준 1인 단가)
  director: number;     // 연출비(마지노선) — 참고
  flower: number;       // 플라워 매출 — 참고
  wine: number;         // 와인병수 — 참고
  reception: boolean;   // 리셉션 Y/N — 참고
  fixed: number;        // 고정경비 — 참고
  marginRate: number;   // 표준 마진율(%) = '자율' 등급 기준
}

export interface WeddingCalcSettings {
  price: WCPriceTier[];
  courseDesc: { A: string; B: string; C: string };
  flowerDesc: { basic: string; lux: string; grand: string };
  rentList: number;
  rentSpecial: number;
  rentItems: WCRentItem[];
  optItems: WCOptItem[];
  otherItems: WCOtherItem[];
  bevItems: WCBevItem[];
  ctypes: WCCtype[];
  cost: WCCost;
  // 기본값 매트릭스 (예식일·시즌·요일·타임 → 표준 기준값)
  presets?: WCPreset[];
  // 등급 기준 — 자율=preset.marginRate, 팀장=요일·타임별, 대표=floor
  tierTeamlead?: { lunchSat: number; other: number }; // 팀장 기준 % (토점심 / 그외)
  tierExecFloor?: number;  // 대표 기준 % (이 미만은 거절)
}

// ── 기본 기준값 (서버 미응답 시 폴백) ────────────────────────────────────────
export const DEFAULT_WEDDING_CALC: WeddingCalcSettings = {
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

// 엑셀 기준값 매트릭스 (구간1·구간2·요일·타임). 보증 250 기준 표준값.
// p=할인%, c=정가, dir=연출비, fl=플라워, w=와인병수, r=리셉션, fx=고정경비, m=마진율%
function P(period: string, season: WCSeason, day: WCDay, time: WCTimeSlot,
  p: number, c: number, dir: number, fl: number, w: number, r: boolean, fx: number, m: number): WCPreset {
  return { period, season, day, time, discount: p, coursePrice: c, director: dir, flower: fl, wine: w, reception: r, fixed: fx, marginRate: m };
}
export function DEFAULT_PRESETS(): WCPreset[] {
  const out: WCPreset[] = [];
  // ── ~26.8 — 성수기(워크인=임직원 동일) / 비수기 ──
  for (const s of ['워크인', '임직원'] as WCSeason[]) {
    out.push(P('~26.8', s, '토', '점심', 7, 92000, 5000000, 8000000, 20, true, 4590000, 42));
    out.push(P('~26.8', s, '토', '저녁', 12, 92000, 4500000, 8800000, 20, true, 4440000, 39));
    out.push(P('~26.8', s, '일', '점심', 10, 92000, 4500000, 8800000, 20, true, 4440000, 40));
  }
  out.push(P('~26.8', '비수기', '토', '점심', 7, 92000, 5000000, 8000000, 20, true, 4590000, 45));
  out.push(P('~26.8', '비수기', '토', '저녁', 12, 92000, 4500000, 8800000, 20, true, 4440000, 42));
  out.push(P('~26.8', '비수기', '일', '점심', 10, 92000, 4500000, 8800000, 20, true, 4440000, 43));
  // ── ~26.12 — 성수기 워크인 / 임직원 ──
  out.push(P('~26.12', '워크인', '토', '점심', 5, 100000, 8000000, 8000000, 10, true, 4590000, 50));
  out.push(P('~26.12', '워크인', '토', '저녁', 10, 100000, 6000000, 8000000, 20, true, 4440000, 46));
  out.push(P('~26.12', '워크인', '일', '점심', 8, 100000, 7000000, 8000000, 15, true, 4440000, 48));
  out.push(P('~26.12', '임직원', '토', '점심', 5, 100000, 6500000, 8000000, 20, true, 4590000, 48));
  out.push(P('~26.12', '임직원', '토', '저녁', 10, 100000, 5000000, 8000000, 20, true, 4440000, 44));
  out.push(P('~26.12', '임직원', '일', '점심', 8, 100000, 5500000, 8000000, 20, true, 4440000, 46));
  // ── ~27.2 — 비수기(1·2월) ──
  out.push(P('~27.2', '비수기', '토', '점심', 8, 100000, 6000000, 8000000, 10, true, 4590000, 46));
  out.push(P('~27.2', '비수기', '토', '저녁', 10, 100000, 5000000, 8000000, 20, true, 4440000, 44));
  out.push(P('~27.2', '비수기', '일', '점심', 8, 100000, 5500000, 8000000, 15, true, 4440000, 46));
  // ── ~27.8 — 성수기 워크인 / 임직원 / 비수기(7·8월) ──
  out.push(P('~27.8', '워크인', '토', '점심', 5, 100000, 8300000, 8800000, 10, true, 4590000, 50));
  out.push(P('~27.8', '워크인', '토', '저녁', 10, 100000, 7000000, 8800000, 20, true, 4440000, 47));
  out.push(P('~27.8', '워크인', '일', '점심', 8, 100000, 8000000, 8800000, 15, true, 4440000, 49));
  out.push(P('~27.8', '임직원', '토', '점심', 5, 100000, 7000000, 8800000, 20, true, 4590000, 48));
  out.push(P('~27.8', '임직원', '토', '저녁', 10, 100000, 5000000, 8800000, 20, true, 4440000, 44));
  out.push(P('~27.8', '임직원', '일', '점심', 8, 100000, 6000000, 8800000, 20, true, 4440000, 46));
  out.push(P('~27.8', '비수기', '토', '점심', 8, 100000, 6000000, 8800000, 20, true, 4590000, 46));
  out.push(P('~27.8', '비수기', '토', '저녁', 10, 100000, 5000000, 8800000, 20, true, 4440000, 44));
  out.push(P('~27.8', '비수기', '일', '점심', 8, 100000, 5500000, 8800000, 20, true, 4440000, 45));
  // ── ~28.8 — 성수기 워크인 / 임직원 / 비수기(1·2·7·8월) ──
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

// 서버에 저장된 설정 → 현재 버전으로 보강.
//   구버전 설정에 없는 필드(presets·등급기준)와, 이후 추가된 기타옵션 항목(이름 기준)을
//   기본값에서 끝에 이어붙인다. opt/otherOn 등 저장 배열은 index 기반이므로 반드시 append-only.
export function normalizeCalcSettings(loaded: WeddingCalcSettings): WeddingCalcSettings {
  const otherNames = new Set((loaded.otherItems || []).map((it) => it.n));
  const missingOthers = DEFAULT_WEDDING_CALC.otherItems.filter((it) => !otherNames.has(it.n));
  // 명칭 변경 마이그레이션 — 저장된 설정의 옛 이름을 현재 이름으로 치환
  const rentItems = (loaded.rentItems || []).map((it) =>
    it.n === '포토월(로비)' ? { ...it, n: '포토백월(로비)', rmk: '플렌티 화이트 포토월 기본 세팅(로비)' } : it);
  return {
    ...loaded,
    rentItems,
    otherItems: missingOthers.length ? [...loaded.otherItems, ...missingOthers] : loaded.otherItems,
    presets: loaded.presets && loaded.presets.length ? loaded.presets : DEFAULT_WEDDING_CALC.presets,
    tierTeamlead: loaded.tierTeamlead ?? DEFAULT_WEDDING_CALC.tierTeamlead,
    tierExecFloor: loaded.tierExecFloor ?? DEFAULT_WEDDING_CALC.tierExecFloor,
  };
}

// 예식일 → 구간1(period) 라벨
export function periodFor(date: string): string {
  if (!date) return '~26.8';
  if (date <= '2026-08-31') return '~26.8';
  if (date <= '2026-12-31') return '~26.12';
  if (date <= '2027-02-28') return '~27.2';
  if (date <= '2027-08-31') return '~27.8';
  return '~28.8';
}

// 예식일(월) + 고객유형 → 시즌(구간2)
//   1·2·7·8월 = 비수기, 그 외 = 성수기(고객유형으로 워크인/임직원 분기)
//   임직원 = 가톨릭동문/성모병원임직원, 워크인 = 그 외
export function seasonFor(date: string, ctypeName: string): WCSeason {
  const mm = date ? Number(date.slice(5, 7)) : 0;
  if (mm === 1 || mm === 2 || mm === 7 || mm === 8) return '비수기';
  const isStaff = /가톨릭|성모|임직원/.test(ctypeName);
  return isStaff ? '임직원' : '워크인';
}

// time 라벨('토 점심' 등) → 요일·타임
export function dayTimeOf(time: string): { day: WCDay; slot: WCTimeSlot } {
  const day: WCDay = time.includes('일') ? '일' : '토';
  const slot: WCTimeSlot = time.includes('저녁') ? '저녁' : '점심';
  return { day, slot };
}

// 입력값 → 해당 슬롯의 기본값(preset) 찾기
export function findPreset(inp: CalcInputs, cfg: WeddingCalcSettings): WCPreset | null {
  const presets = cfg.presets || [];
  if (!presets.length) return null;
  const period = periodFor(inp.wdate);
  const season = seasonFor(inp.wdate, cfg.ctypes[inp.ctype]?.name || '');
  const { day, slot } = dayTimeOf(inp.time);
  return presets.find((p) => p.period === period && p.season === season && p.day === day && p.time === slot) || null;
}

// ── 계산기 입력값 ────────────────────────────────────────────────────────────
export interface CalcInputs {
  groom: string;
  bride: string;
  wdate: string;         // YYYY-MM-DD
  wtime?: string;        // 예식 시간 HH:mm — 견적서 표기용 (마진 계산은 time 슬롯 사용)
  time: string;          // '토 점심' 등 (계산 기준 슬롯)
  guests: number;
  ctype: number;         // ctypes 인덱스
  course: CourseKey;
  mealDiscount: number;  // %
  flowerBill: FlowerGrade;
  flowerGive: FlowerGrade;
  flowerUp: boolean;
  opt: boolean[];        // optItems 길이
  otherOn: boolean[];    // otherItems 길이
  otherSvc: boolean[];   // otherItems 길이
  otherQty: number[];    // otherItems 길이 (qtyMode 항목용)
  laborInf: number;      // %
  foodInf: number;       // %
  rentSpecial?: number | null; // 건별 대관(패키지) 특별가 — null이면 기준값(cfg.rentSpecial) 사용
}

// 식대 할인율 선택지 — 예식일 기준. ~2027-08-31: 5/8/10%, 2027-09-01~: 14/17/19/21%
export function mealDiscountOptions(wdate: string): number[] {
  return wdate && wdate >= '2027-09-01' ? [14, 17, 19, 21] : [5, 8, 10];
}

export const TIME_OPTIONS = ['토 점심', '토 저녁', '일 점심'];

// 고객유형 선택 시 식대할인%/플라워 업그레이드 자동 적용 (HTML applyCustomerType)
export function defaultInputs(cfg: WeddingCalcSettings, prefill?: Partial<CalcInputs>): CalcInputs {
  const ctypeIdx = prefill?.ctype ?? 0;
  const ct = cfg.ctypes[ctypeIdx] ?? cfg.ctypes[0];
  return {
    groom: prefill?.groom ?? '',
    bride: prefill?.bride ?? '',
    wdate: prefill?.wdate ?? '',
    wtime: prefill?.wtime ?? '',
    time: prefill?.time ?? TIME_OPTIONS[0],
    guests: prefill?.guests ?? 250,
    ctype: ctypeIdx,
    course: prefill?.course ?? 'A',
    mealDiscount: prefill?.mealDiscount ?? (ct?.mealDisc ?? 0),
    flowerBill: prefill?.flowerBill ?? 'basic',
    flowerGive: prefill?.flowerGive ?? (ct?.flowerUp ? 'lux' : 'basic'),
    flowerUp: prefill?.flowerUp ?? (ct?.flowerUp ?? false),
    opt: prefill?.opt ?? cfg.optItems.map(() => false),
    otherOn: prefill?.otherOn ?? cfg.otherItems.map((it) => !it.off),
    otherSvc: prefill?.otherSvc ?? cfg.otherItems.map((it) => !!it.svc),
    otherQty: prefill?.otherQty ?? cfg.otherItems.map((it) => it.qty ?? 1),
    laborInf: prefill?.laborInf ?? 5,
    foodInf: prefill?.foodInf ?? 5,
    rentSpecial: prefill?.rentSpecial ?? null,
  };
}

// ── 헬퍼 (HTML과 동일) ───────────────────────────────────────────────────────
export function priceFor(cfg: WeddingCalcSettings, date: string): WCPriceTier {
  let p = cfg.price[0];
  for (const t of cfg.price) { if (date >= t.from) p = t; }
  return p;
}
function coursePriceVal(pr: WCPriceTier, course: CourseKey): number {
  return course === 'A' ? pr.A : course === 'B' ? pr.B : pr.C;
}
function courseFoodCost(cfg: WeddingCalcSettings, course: CourseKey): number {
  return course === 'A' ? cfg.cost.foodA : course === 'B' ? cfg.cost.foodB : cfg.cost.foodC;
}
export function flowerPrice(pr: WCPriceTier, g: FlowerGrade): number {
  return g === 'basic' ? pr.fB : g === 'lux' ? pr.fL : pr.fG;
}
export function flowerName(g: FlowerGrade): string {
  return g === 'basic' ? 'Basic' : g === 'lux' ? 'Luxury' : 'Grand';
}

// ── 등급 판정 (HTML tier) ────────────────────────────────────────────────────
export type TierColor = 'green' | 'yellow' | 'orange' | 'red';
export interface TierInfo { t: string; color: TierColor; }
export function tier(r: number): TierInfo {
  if (r >= 0.16) return { t: '자율 (직원 재량)', color: 'green' };
  if (r >= 0.10) return { t: '팀장 승인', color: 'yellow' };
  if (r >= 0.04) return { t: '대표/CFO 승인 (빈슬롯 한정)', color: 'orange' };
  return { t: '원칙 거절 — floor 미달', color: 'red' };
}

// 색상 팔레트 (HTML CSS 변수와 동일)
export const TIER_HEX: Record<TierColor, { fg: string; bg: string }> = {
  green: { fg: '#1f9d5b', bg: '#e7f6ee' },
  yellow: { fg: '#b8860b', bg: '#fcf3da' },
  orange: { fg: '#d2691e', bg: '#fdeede' },
  red: { fg: '#c0392b', bg: '#fbe9e7' },
};

// ── 견적 라인 (견적서용) ─────────────────────────────────────────────────────
export interface QuoteLine { n: string; p: number; rmk: string; svc?: boolean; }

export interface CostScenario {
  B: number; C: number; food: number; ext: number; flowerCost: number;
  sheet: number; intB: number; comB: number; realWon: number; real: number;
}

export interface MarginResult {
  pr: WCPriceTier;
  guests: number;
  listMeal: number; effMeal: number; mealRev: number; mealList: number; mealBenefit: number;
  flowerGiveP: number; flowerRev: number; flowerBenefit: number;
  rentRev: number; rentBenefit: number;
  optLines: WCOptItem[];
  otherLines: QuoteLine[];
  A: number; totalBenefit: number; listTotal: number;
  now: CostScenario; fut: CostScenario;
  tierInfo: TierInfo;
  headroom: number;     // 자율(표준 마진율)까지 추가 할인여력
  preset: WCPreset | null;  // 해당 슬롯 기본값
  autoMargin: number;       // 자율 기준 마진율(%) — preset.marginRate 또는 폴백
}

// ── 핵심 계산 (HTML calc) ────────────────────────────────────────────────────
export function computeMargin(inp: CalcInputs, cfg: WeddingCalcSettings): MarginResult {
  const pr = priceFor(cfg, inp.wdate);
  const guests = inp.guests || 0;
  const ratio = cfg.cost.flowerCostR / 100;

  const listMeal = coursePriceVal(pr, inp.course);
  const effMeal = listMeal * (1 - inp.mealDiscount / 100);
  const mealRev = effMeal * guests;
  const mealList = listMeal * guests;
  const mealBenefit = mealList - mealRev;

  const flowerGiveP = flowerPrice(pr, inp.flowerGive);
  const flowerRev = flowerPrice(pr, inp.flowerBill);
  const flowerBenefit = Math.max(0, flowerGiveP - flowerRev);

  const rentRev = inp.rentSpecial ?? cfg.rentSpecial;
  const rentBenefit = cfg.rentList - rentRev;

  let optRev = 0;
  const optLines: WCOptItem[] = [];
  cfg.optItems.forEach((it, i) => { if (inp.opt[i]) { optRev += it.p; optLines.push(it); } });

  let otherRev = 0, otherBenefit = 0, otherListSum = 0;
  const otherLines: QuoteLine[] = [];
  cfg.otherItems.forEach((it, i) => {
    if (!inp.otherOn[i]) return;
    const q = it.qtyMode ? (inp.otherQty[i] || 0) : 1;
    const value = it.p * q;
    const isSvc = inp.otherSvc[i];
    otherRev += isSvc ? 0 : value;
    if (isSvc) otherBenefit += value;
    otherListSum += value;
    otherLines.push({ n: it.n + (it.qtyMode ? ` (${q}병/개)` : ''), p: value, rmk: it.rmk, svc: isSvc });
  });

  const A = mealRev + flowerRev + rentRev + optRev + otherRev;
  const totalBenefit = mealBenefit + flowerBenefit + rentBenefit + otherBenefit;
  const listTotal = mealList + flowerGiveP + cfg.rentList + optRev + otherListSum;

  function costAt(fF: number, lF: number): CostScenario {
    const food = courseFoodCost(cfg, inp.course) * (1 + fF) * guests;
    const ext = cfg.cost.extPP * (1 + lF) * guests;
    const flowerCost = flowerGiveP * ratio;
    const B = cfg.cost.fixed + food + ext + flowerCost;
    const C = A - B;
    const intB = (cfg.cost.intBurden / 100) * (1 + lF);
    const comB = (cfg.cost.comBurden / 100) * (1 + lF * 0.5);
    const realWon = C - (intB + comB) * A;
    return { B, C, food, ext, flowerCost, sheet: A ? C / A : 0, intB, comB, realWon, real: A ? realWon / A : 0 };
  }
  const now = costAt(0, 0);
  const fut = costAt(inp.foodInf / 100, inp.laborInf / 100);

  // 등급: 행사시점 '시트마진'(C/A)을 슬롯 표준(엑셀 마진율)과 비교.
  //   자율 ≥ preset.marginRate / 팀장 ≥ (토점심 lunchSat·그외 other) / 대표 ≥ execFloor / 미만 거절
  const preset = findPreset(inp, cfg);
  const autoMargin = preset ? preset.marginRate : (cfg.tierTeamlead?.lunchSat ?? 44);
  const tierInfo = gradeFor(fut.sheet, autoMargin, inp.time, cfg);

  // 추가 할인여력 — 시트마진이 '자율' 기준까지 떨어지기 전 더 깎을 수 있는 금액.
  //   (C-ΔA)/(A-ΔA)=m → ΔA = (C - m·A)/(1-m)
  const m = autoMargin / 100;
  const headroom = (fut.C - m * A) / (1 - m);

  return {
    pr, guests, listMeal, effMeal, mealRev, mealList, mealBenefit,
    flowerGiveP, flowerRev, flowerBenefit, rentRev, rentBenefit,
    optLines, otherLines, A, totalBenefit, listTotal, now, fut, tierInfo, headroom,
    preset, autoMargin,
  };
}

// 시트마진 기준 등급 판정 (위에서부터)
export function gradeFor(sheet: number, marginRate: number, time: string, cfg: WeddingCalcSettings): TierInfo {
  const { day, slot } = dayTimeOf(time);
  const tl = cfg.tierTeamlead || { lunchSat: 50, other: 44 };
  const teamFloor = (day === '토' && slot === '점심') ? tl.lunchSat : tl.other;
  const execFloor = cfg.tierExecFloor ?? 38;
  const pct = sheet * 100;
  if (pct >= marginRate) return { t: '자율 (직원 재량)', color: 'green' };
  if (pct >= teamFloor) return { t: '팀장 승인', color: 'yellow' };
  if (pct >= execFloor) return { t: '대표/CFO 승인', color: 'orange' };
  return { t: '원칙 거절 — floor 미달', color: 'red' };
}

// 숫자 → 천단위 쉼표
export const won = (v: number) => Math.round(v).toLocaleString('ko-KR');
export const pctText = (v: number) => (v * 100).toFixed(0) + '%';

// 요약 텍스트 (inquiry.estimate_detail 저장용)
export function summaryText(inp: CalcInputs, r: MarginResult): string {
  return [
    `코스 ${inp.course} · 식대할인 ${inp.mealDiscount}%`,
    `플라워 ${flowerName(inp.flowerBill)}청구/${flowerName(inp.flowerGive)}제공`,
    `총혜택 ${won(r.totalBenefit)}원`,
    `시트마진 ${pctText(r.fut.sheet)} · 실제(행사시점) ${pctText(r.fut.real)}`,
    `등급: ${r.tierInfo.t}`,
  ].join(' / ');
}
