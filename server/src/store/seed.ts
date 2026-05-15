// 첫 실행 시 super admin과 데모용 사용자/데이터 일부를 자동 생성한다.
// 실 서비스에서는 Firebase Auth 연동 시 제거한다.

import { nanoid } from 'nanoid';
import { store, persist } from './mockStore.js';
import type { User, MiceCustomer, WeddingCustomer } from '../types.js';

// 실제 super admin 이메일은 .env의 SUPER_ADMIN_EMAIL로 주입한다.
// 코드에 박힌 fallback은 generic placeholder — Public repo 노출 방지.
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'admin@example.com';

const now = () => new Date().toISOString();

function seedUsers() {
  if (store.users.length > 0) return;

  const seedList: Omit<User, 'id' | 'created_at' | 'updated_at'>[] = [
    { email: SUPER_ADMIN_EMAIL, name: '관리자', picture: null, role: 'admin', team: 'admin' },
    { email: 'mice.demo@plenty.test', name: '데모 MICE 세일즈', picture: null, role: 'sales_mice', team: 'sales_mice' },
    { email: 'wedding.demo@plenty.test', name: '데모 WEDDING 세일즈', picture: null, role: 'sales_wedding', team: 'sales_wedding' },
    { email: 'banquet.demo@plenty.test', name: '데모 연회팀', picture: null, role: 'banquet', team: 'banquet' },
    { email: 'kitchen.demo@plenty.test', name: '데모 주방팀', picture: null, role: 'kitchen', team: 'kitchen' },
    { email: 'pending.demo@plenty.test', name: '권한대기 사용자', picture: null, role: 'pending', team: null },
  ];

  for (const u of seedList) {
    store.users.push({ ...u, id: nanoid(10), created_at: now(), updated_at: now() });
  }
  persist('users');
  console.log(`[seed] users 초기화 완료 (${store.users.length}명)`);
}

function seedMiceCustomers() {
  if (store.mice_customers.length > 0) return;

  const samples: Omit<MiceCustomer, 'id' | 'created_at' | 'updated_at'>[] = [
    {
      customer_type: 'MICE',
      mice_category: '기업',
      organization_name: '오케이금융그룹',
      official_phone: '02-1234-5678',
      official_email: 'office@okfn.test',
      official_website: 'https://okfn.test',
      inquiries: [
        {
          id: nanoid(10),
          progress_status: 'TEN',
          contacts: [
            { id: nanoid(10), name: '김지윤', email: 'jiyoon.kim@okfn.test', phone: '010-1111-2222' },
          ],
          call_date: '2026-04-10',
          inquiry_event_date_text: '2026-06-20',
          event_memo: '',
          created_by_id: '',
          created_by_name: 'Sarah (관리자)',
          assigned_manager_id: '',
          assigned_manager_name: 'Sarah (관리자)',
          created_at: now(),
        },
      ],
      memo: '임원 워크숍 — 점심 포함 200석 규모',
    },
    {
      customer_type: 'MICE',
      mice_category: '학회',
      organization_name: '대한심혈관학회',
      official_phone: '02-555-7777',
      official_email: 'admin@kcvs.test',
      official_website: '',
      inquiries: [
        {
          id: nanoid(10),
          progress_status: 'INQ',
          contacts: [
            { id: nanoid(10), name: '이상훈', email: 'lee@kcvs.test', phone: '010-3344-5566' },
          ],
          call_date: '2026-04-15',
          inquiry_event_date_text: '2026-09-05 (예정)',
          event_memo: '',
          created_by_id: '',
          created_by_name: 'Sarah (관리자)',
          assigned_manager_id: '',
          assigned_manager_name: 'Sarah (관리자)',
          created_at: now(),
        },
      ],
      memo: '학술대회 1박 / 디너 별도 견적 필요',
    },
    {
      customer_type: 'MICE',
      mice_category: '대행사',
      organization_name: '아젠다컨설팅',
      official_phone: '',
      official_email: '',
      official_website: '',
      inquiries: [
        {
          id: nanoid(10),
          progress_status: '단순문의',
          contacts: [
            { id: nanoid(10), name: '최민호', email: 'minho@agenda.test', phone: '010-7777-8888' },
          ],
          call_date: '2026-04-05',
          inquiry_event_date_text: '미정',
          event_memo: '같은 날짜 다른 행사 확정',
          created_by_id: '',
          created_by_name: 'Sarah (관리자)',
          assigned_manager_id: '',
          assigned_manager_name: 'Sarah (관리자)',
          created_at: now(),
        },
      ],
      memo: '',
    },
  ];

  for (const c of samples) {
    store.mice_customers.push({ ...c, id: nanoid(10), created_at: now(), updated_at: now() });
  }
  persist('mice_customers');
  console.log(`[seed] MICE 고객 ${store.mice_customers.length}건 시드 완료`);
}

function seedWeddingCustomers() {
  if (store.wedding_customers.length > 0) return;

  const samples: Omit<WeddingCustomer, 'id' | 'created_at' | 'updated_at'>[] = [
    {
      customer_type: 'WEDDING',
      wedding_event_name: '김민수 ♥ 박지영 결혼식',
      progress_status: 'TEN',
      inquiry_date: '2026-03-05',
      desired_consultation_date: '2026-03-12',
      first_inform_comment: '하객 250~300명 예상, 본식+식사 풀패키지 문의',
      groom_name: '김민수',
      groom_phone: '010-2233-4455',
      groom_email: 'minsu@example.test',
      bride_name: '박지영',
      bride_phone: '010-5566-7788',
      bride_email: 'jiyoung@example.test',
      competing_venues: '아펠가모 / 그랜드인터컨',
      desired_budget: '약 8,000만원',
      source: '컨설팅',
      source_detail: '컨설팅',
      event_inquiries: [
        {
          id: nanoid(10),
          wedding_datetime: '2026-09-21T11:30',
          guaranteed_guest_count: 280,
          estimate_amount: '7,800만원',
          estimate_detail: '식사 280명 + 답례 떡 50개 + 플라워 업그레이드',
          visit_consultation_comment: '식사 메뉴 업그레이드 옵션 추가 검토',
          assigned_manager_id: '',
          assigned_manager_name: '',
          created_at: now(),
        },
      ],
      memo: '예식 후 가족식사 3시간 추가 요청',
    },
    {
      customer_type: 'WEDDING',
      wedding_event_name: '이재훈 ♥ 한소희 결혼식',
      progress_status: '신규문의',
      inquiry_date: '2026-04-02',
      desired_consultation_date: '2026-04-10',
      first_inform_comment: '오후 예식, 하객 200명 가량',
      groom_name: '이재훈',
      groom_phone: '010-1122-3344',
      groom_email: 'jaehoon@example.test',
      bride_name: '한소희',
      bride_phone: '010-4455-6677',
      bride_email: 'sohee@example.test',
      competing_venues: '르네상스 / 더채플',
      desired_budget: '6,000만원 이하',
      source: '가톨릭동문(교직원, 관계자)',
      source_detail: '지인추천',
      event_inquiries: [
        {
          id: nanoid(10),
          wedding_datetime: '2026-11-08T13:00',
          guaranteed_guest_count: 200,
          estimate_amount: '',
          estimate_detail: '',
          visit_consultation_comment: '',
          assigned_manager_id: '',
          assigned_manager_name: '',
          created_at: now(),
        },
      ],
      memo: '신부 측 채식 메뉴 옵션 확인 필요',
    },
  ];

  for (const c of samples) {
    store.wedding_customers.push({ ...c, id: nanoid(10), created_at: now(), updated_at: now() });
  }
  persist('wedding_customers');
  console.log(`[seed] WEDDING 고객 ${store.wedding_customers.length}건 시드 완료`);
}

export function runSeed() {
  seedUsers();
  // 고객정보 / 행사정보는 사용자가 직접 입력하기로 함 — 자동 시드 비활성화.
  // 필요 시 호출 복구.
  void seedMiceCustomers;
  void seedWeddingCustomers;
}
