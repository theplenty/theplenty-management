// 연회팀 음료 BOM 데이터 — 2026년 기준
// 원본 데이터: VAT 포함 금액 → ÷1.1 하여 VAT 제외 금액으로 저장
// dept: '연회' (연회팀 관리 음료 코스트)
//
// MICE 전용: Coffee, Bottle Water, Juice(1pot/25인분)
// MICE + WEDDING 공통 (단, 참이슬/Terra 판매가 상이): 몽그라스, 앙시앙땅, 미션서드, 스파클링, 참이슬 360ml, Terra 330ml, 펩시콜라 245ml, 칠성 사이다 245ml

import type { CourseBom } from './menuBomData.js';

// ── MICE 음료 ─────────────────────────────────────────────────────────
export const MICE_BEV_BOM: CourseBom[] = [
  {
    name_ko: 'Coffee',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 2727,
    ingredients: [['Coffee', 1, '잔', 59, 59]],
  },
  {
    name_ko: 'Bottle Water',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 909,
    ingredients: [['Bottle Water', 1, '병', 130, 130]],
  },
  {
    name_ko: 'Juice(1pot/25인분)',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 100000,
    notes: '1.5L x 2병',
    ingredients: [['Juice(1pot/25인분)', 1, '포트', 4891, 4891]],
  },
  {
    name_ko: '몽그라스',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 54545,
    ingredients: [['몽그라스', 1, '병', 6200, 6200]],
  },
  {
    name_ko: '앙시앙땅',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 63636,
    ingredients: [['앙시앙땅', 1, '병', 9000, 9000]],
  },
  {
    name_ko: '미션서드',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 72727,
    ingredients: [['미션서드', 1, '병', 10100, 10100]],
  },
  {
    name_ko: '스파클링',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 54545,
    ingredients: [['스파클링', 1, '병', 5700, 5700]],
  },
  {
    name_ko: '참이슬 360ml',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 9091,
    ingredients: [['참이슬 360ml', 1, '병', 1140, 1140]],
  },
  {
    name_ko: 'Terra 330ml',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 8182,
    ingredients: [['Terra 330ml', 1, '캔', 938, 938]],
  },
  {
    name_ko: '펩시콜라 245ml',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 5455,
    ingredients: [['펩시콜라 245ml', 1, '캔', 427, 427]],
  },
  {
    name_ko: '칠성 사이다 245ml',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 5455,
    ingredients: [['칠성 사이다 245ml', 1, '캔', 606, 606]],
  },
];

// ── WEDDING 음료 ──────────────────────────────────────────────────────
// 참이슬 360ml, Terra 330ml 판매가가 MICE와 다름 (WEDDING이 더 높음)
export const WEDDING_BEV_BOM: CourseBom[] = [
  {
    name_ko: '몽그라스',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 54545,
    ingredients: [['몽그라스', 1, '병', 6200, 6200]],
  },
  {
    name_ko: '앙시앙땅',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 63636,
    ingredients: [['앙시앙땅', 1, '병', 9000, 9000]],
  },
  {
    name_ko: '미션서드',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 72727,
    ingredients: [['미션서드', 1, '병', 10100, 10100]],
  },
  {
    name_ko: '스파클링',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 54545,
    ingredients: [['스파클링', 1, '병', 5700, 5700]],
  },
  {
    name_ko: '참이슬 360ml',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 10000,   // WEDDING: 11,000원 VAT포함 → 10,000원 VAT제외
    ingredients: [['참이슬 360ml', 1, '병', 1140, 1140]],
  },
  {
    name_ko: 'Terra 330ml',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 9091,    // WEDDING: 10,000원 VAT포함 → 9,091원 VAT제외
    ingredients: [['Terra 330ml', 1, '캔', 938, 938]],
  },
  {
    name_ko: '펩시콜라 245ml',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 5455,
    ingredients: [['펩시콜라 245ml', 1, '캔', 427, 427]],
  },
  {
    name_ko: '칠성 사이다 245ml',
    category: '음료',
    mode: 'qty',
    dept: '연회',
    list_price: 5455,
    ingredients: [['칠성 사이다 245ml', 1, '캔', 606, 606]],
  },
];
