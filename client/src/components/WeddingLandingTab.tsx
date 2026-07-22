// 웨딩 고객 랜딩 탭 — 가예약(INQ) 고객에게 보내는 공개 링크 관리.
// 행사수정 모달(WEDDING) 안에서: 가블록 종료일·중시항목 설정, 견적 스냅샷 발행, 링크 복사/닫기.
// 견적은 발행 시점에 예식후보의 calc_payload → 고객용 HTML로 스냅샷 저장 (내부 마진 미포함).

import { useEffect, useMemo, useState } from 'react';
import { api, type ApiError } from '../lib/api';
import {
  DEFAULT_WEDDING_CALC,
  computeMargin,
  defaultInputs,
  flowerName,
  normalizeCalcSettings,
  won,
  type CalcInputs,
  type WeddingCalcSettings,
} from '../lib/weddingCalc';
import { buildQuoteHtml, QUOTE_CSS } from '../lib/weddingQuote';
import {
  WEDDING_PRIORITY_LABEL,
  WEDDING_PRIORITY_SENTENCE,
  type WeddingCustomer,
  type WeddingEventInquiry,
  type WeddingLanding,
  type WeddingLandingBenefit,
  type WeddingLandingState,
  type WeddingPriorityKey,
} from '../types';

interface Props {
  eventId: string | null;
  startDatetime: string; // form.start_datetime — 예식후보 자동 매칭용
  customerIds: string[]; // 연결된 웨딩 고객 id (CONTACT POINT 우선)
  canManage: boolean; // admin | sales_wedding
  // consult 모드 — 행사 없이 웨딩 고객에 직접 발행 (상담만 하고 간 고객용).
  // 지정 시 eventId는 무시되고 /api/customers/wedding/:id/landing 을 사용한다.
  consultCustomerId?: string | null;
}

const PRIORITY_KEYS = Object.keys(WEDDING_PRIORITY_LABEL) as WeddingPriorityKey[];

const STATE_BADGE: Record<WeddingLandingState, { label: string; cls: string }> = {
  active: { label: '열림 (고객 열람 가능)', cls: 'bg-green-100 text-green-800' },
  contracted: { label: '계약완료 화면 표시 중', cls: 'bg-blue-100 text-blue-800' },
  closed: { label: '닫힘', cls: 'bg-gray-200 text-gray-600' },
  expired: { label: '가블록 기간 만료', cls: 'bg-amber-100 text-amber-800' },
};

function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function WeddingLandingTab({ eventId, startDatetime, customerIds, canManage, consultCustomerId }: Props) {
  const isConsult = !!consultCustomerId;
  const apiBase = isConsult
    ? `/api/customers/wedding/${consultCustomerId}/landing`
    : `/api/events/${eventId}/landing`;
  const [landing, setLanding] = useState<WeddingLanding | null>(null);
  const [state, setState] = useState<WeddingLandingState | null>(null);
  const [sibling, setSibling] = useState<{ mode: 'block' | 'consult'; state: WeddingLandingState } | null>(null); // 반대 경로 랜딩 존재 안내
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [customer, setCustomer] = useState<WeddingCustomer | null>(null);
  const [cfg, setCfg] = useState<WeddingCalcSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewQuote, setPreviewQuote] = useState(false);

  // 편집 필드
  const [blockUntil, setBlockUntil] = useState('');
  const [priorities, setPriorities] = useState<WeddingPriorityKey[]>([]);
  const [customNote, setCustomNote] = useState('');
  const [inquiryId, setInquiryId] = useState('');

  // ── 로드: 랜딩 + 연결 고객 + 견적 기준값 ──
  useEffect(() => {
    if (!eventId && !isConsult) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const [landingRes, cfgRes] = await Promise.all([
          api.get<{
            landing: WeddingLanding | null;
            state: WeddingLandingState | null;
            smtp_configured: boolean;
            sibling?: { mode: 'block' | 'consult'; state: WeddingLandingState } | null;
          }>(apiBase),
          api
            .get<{ setting: { value: WeddingCalcSettings } }>('/api/settings/wedding-calc')
            .catch(() => null),
        ]);
        if (!alive) return;
        setLanding(landingRes.landing);
        setState(landingRes.state);
        setSibling(landingRes.sibling ?? null);
        setSmtpConfigured(landingRes.smtp_configured);
        const loaded = cfgRes?.setting?.value ?? DEFAULT_WEDDING_CALC;
        setCfg(normalizeCalcSettings(loaded));
        if (landingRes.landing) {
          setBlockUntil(landingRes.landing.block_until || plusDays(7));
          setPriorities(landingRes.landing.priorities || []);
          setCustomNote(landingRes.landing.custom_note || '');
          setInquiryId(landingRes.landing.inquiry_id || '');
        } else {
          setBlockUntil(plusDays(7)); // 기본 가블록 7일
        }
      } catch (e) {
        console.error('[landing] load error', e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, consultCustomerId]);

  // 연결 고객 로드 — customerIds가 나중에 도착해도(모달 링크 로딩 레이스) 다시 불러온다.
  // 과거: 탭 mount 시 1회만 로드 → 링크 로딩보다 먼저 열면 고객 없이 발행되어 견적 누락됨.
  const customerId = consultCustomerId || customerIds[0] || '';
  useEffect(() => {
    if (!customerId) {
      setCustomer(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const c = await api.get<{ customer: WeddingCustomer }>(`/api/customers/wedding/${customerId}`);
        if (alive) setCustomer(c.customer);
      } catch (e) {
        console.error('[landing] 고객 로드 실패', e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [customerId]);

  // 예식후보 자동 매칭 — 지정된 것 > 행사 시작일과 같은 날짜 > 첫 후보
  const inquiries = customer?.event_inquiries || [];
  const matchedInquiry: WeddingEventInquiry | null = useMemo(() => {
    if (inquiryId) {
      const found = inquiries.find((q) => q.id === inquiryId);
      if (found) return found;
    }
    const evDate = (startDatetime || '').slice(0, 10);
    return (
      inquiries.find((q) => (q.wedding_datetime || '').slice(0, 10) === evDate) ||
      inquiries[0] ||
      null
    );
  }, [inquiries, inquiryId, startDatetime]);

  // 견적 스냅샷 (발행 시 저장할 데이터) — calc_payload 기반
  const quoteSnapshot = useMemo(() => {
    if (!cfg || !matchedInquiry?.calc_payload) return null;
    try {
      const saved = JSON.parse(matchedInquiry.calc_payload) as Partial<CalcInputs>;
      const inputs = defaultInputs(cfg, saved);
      inputs.opt = cfg.optItems.map((_, i) => saved.opt?.[i] ?? false);
      inputs.otherOn = cfg.otherItems.map((it, i) => saved.otherOn?.[i] ?? !it.off);
      inputs.otherSvc = cfg.otherItems.map((it, i) => saved.otherSvc?.[i] ?? !!it.svc);
      inputs.otherQty = cfg.otherItems.map((it, i) => saved.otherQty?.[i] ?? it.qty ?? 1);
      // 견적서 Date & Time — 예식후보의 실제 일시를 그대로 표기 (슬롯 라벨 '점심/저녁' 대신)
      if (matchedInquiry.wedding_datetime) {
        inputs.wdate = matchedInquiry.wedding_datetime.slice(0, 10);
        inputs.wtime = matchedInquiry.wedding_datetime.slice(11, 16);
      }
      const L = computeMargin(inputs, cfg);
      // 혜택 내역 — 랜딩 견적 카드에 노출 (금액 있는 것만)
      const benefits: WeddingLandingBenefit[] = [];
      if (L.mealBenefit > 0) benefits.push({ label: `식대 ${inputs.mealDiscount}% 할인`, amount: L.mealBenefit });
      if (L.flowerBenefit > 0)
        benefits.push({
          label: `플라워 ${flowerName(inputs.flowerBill)} → ${flowerName(inputs.flowerGive)} 무료 업그레이드`,
          amount: L.flowerBenefit,
        });
      if (L.rentBenefit > 0) benefits.push({ label: '대관 · 연출 패키지 할인', amount: L.rentBenefit });
      L.otherLines.forEach((o) => {
        if (o.svc && o.p > 0) benefits.push({ label: `${o.n} 무상 제공`, amount: o.p });
      });
      return {
        html: buildQuoteHtml(inputs, cfg, L),
        guests: L.guests,
        total: won(L.A),
        benefits,
      };
    } catch (e) {
      console.error('[landing] quote build error', e);
      return null;
    }
  }, [cfg, matchedInquiry]);

  function togglePriority(k: WeddingPriorityKey) {
    setPriorities((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  }

  async function save(patch?: Partial<WeddingLanding>) {
    if (!eventId && !isConsult) return;
    // 발행/저장인데 견적 스냅샷이 없으면 경고 (닫기/열기 토글(patch)은 제외)
    // — 고객 링크 로딩 전 발행 등으로 견적 섹션이 조용히 빠지는 사고 방지
    if (!patch && !quoteSnapshot) {
      const ok = confirm(
        '⚠ 맞춤 견적 스냅샷이 없습니다.\n' +
          '(연결 고객 미로딩이거나, 예식후보에 마진계산기 견적이 저장되지 않음)\n\n' +
          '이대로 발행하면 랜딩에 견적 섹션이 표시되지 않습니다. 계속할까요?'
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await api.put<{
        landing: WeddingLanding;
        state: WeddingLandingState;
        smtp_configured: boolean;
      }>(apiBase, {
        block_until: blockUntil,
        priorities,
        custom_note: customNote,
        inquiry_id: matchedInquiry?.id || '',
        guest_count: quoteSnapshot?.guests ?? matchedInquiry?.guaranteed_guest_count ?? null,
        total_amount: quoteSnapshot?.total ?? matchedInquiry?.estimate_amount ?? '',
        quote_html: quoteSnapshot?.html ?? '',
        benefits: quoteSnapshot?.benefits ?? [],
        ...patch,
      });
      setLanding(res.landing);
      setState(res.state);
      setSmtpConfigured(res.smtp_configured);
    } catch (e) {
      const err = e as ApiError;
      const payload = err.payload as { error?: string; other?: 'block' | 'consult' } | undefined;
      if (err.status === 409 && payload?.error === 'duplicate_landing') {
        // 반대 경로(행사 캘린더 ↔ 고객정보)에 이미 열린 랜딩이 있음 — 중복 생성 차단
        alert(
          payload.other === 'consult'
            ? '⚠ 이미 랜딩페이지가 생성되어 있어 중복 생성할 수 없습니다.\n\n' +
                '이 고객에게는 상담형 랜딩(고객정보에서 발행)이 열려 있습니다.\n' +
                '가블록 랜딩으로 전환하려면: 웨딩 상담 DB → 고객 상세 → 💌 고객 랜딩에서\n' +
                '기존 링크를 [수동 닫기]한 뒤 여기서 다시 발행해 주세요.'
            : '⚠ 이미 랜딩페이지가 생성되어 있어 중복 생성할 수 없습니다.\n\n' +
                '이 고객에게는 가블록 랜딩(행사 캘린더에서 발행)이 열려 있습니다.\n' +
                '상담형이 필요하면: 행사 수정 → 💌 고객 랜딩 탭에서\n' +
                '기존 링크를 [수동 닫기]한 뒤 여기서 다시 발행해 주세요.'
        );
      } else {
        alert('저장 실패');
      }
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  const landingUrl = landing ? `${window.location.origin}/l/${landing.token}` : '';

  async function copyLink() {
    if (!landingUrl) return;
    try {
      await navigator.clipboard.writeText(landingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('아래 링크를 복사하세요', landingUrl);
    }
  }

  if (!eventId && !isConsult) {
    return (
      <div className="border rounded-md p-6 text-center bg-gray-50/50 text-sm text-gray-600">
        행사를 먼저 저장한 뒤 고객 랜딩을 만들 수 있습니다.
      </div>
    );
  }
  if (loading) return <div className="text-sm text-gray-400 py-6 text-center">불러오는 중...</div>;

  return (
    <div className="space-y-4">
      {isConsult ? (
        <div className="text-sm text-gray-600">
          <b>상담만 하고 돌아간 고객</b>에게 보내는 모바일 랜딩 링크입니다 (가블록 없이 발행).
          가블록 안내 대신 <b>&ldquo;열람 기한까지 찬찬히 고민해 보세요&rdquo;</b> 문구가 노출되며,{' '}
          <b>열람 기한 경과 시 자동으로 닫힙니다.</b> 이후 이 고객의 가블록(행사) 랜딩을 발행하면
          이 링크는 자동으로 닫히고, 계약(DEF)되면 &lsquo;계약 완료 감사&rsquo; 화면으로 바뀝니다.
        </div>
      ) : (
        <div className="text-sm text-gray-600">
          가예약(INQ) 고객에게 보내는 <b>모바일 랜딩 링크</b>입니다. 가블록 안내·상담 중시항목·맞춤
          견적·홀 소개·FAQ가 포함되며, <b>LOS 전환·가블록 종료일 경과 시 자동으로 닫힙니다.</b>{' '}
          DEF(계약완료)가 되면 &lsquo;계약 완료 감사&rsquo; 화면으로 바뀝니다.
        </div>
      )}

      {/* 반대 경로(상담형 ↔ 가블록형)에 이미 링크가 있으면 안내 */}
      {sibling && (
        <div className="text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-2.5 leading-relaxed">
          ⚠{' '}
          <b>
            {sibling.mode === 'consult' ? '상담형(고객정보)' : '가블록형(행사 캘린더)'}에서 이미 링크
            생성을 완료하였습니다.
          </b>{' '}
          {sibling.state === 'active'
            ? '해당 링크가 열려 있는 동안에는 여기서 새로 발행할 수 없습니다. 전환하려면 기존 링크를 먼저 [수동 닫기] 해주세요. (닫힌 옛 링크는 새 랜딩으로 자동 연결됩니다)'
            : `현재 ${
                sibling.state === 'expired' ? '만료' : sibling.state === 'contracted' ? '계약 완료' : '닫힘'
              } 상태라 여기서 발행할 수 있고, 고객이 갖고 있는 옛 링크도 새 랜딩으로 자동 연결됩니다.`}
        </div>
      )}

      {/* 링크 + 상태 */}
      {landing ? (
        <div className="border rounded-md p-3 bg-blue-50/40 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`badge ${STATE_BADGE[state || 'active'].cls}`}>
              {state === 'expired' && isConsult ? '열람 기한 만료' : STATE_BADGE[state || 'active'].label}
            </span>
            {!smtpConfigured && (
              <span
                className="badge bg-amber-100 text-amber-800"
                title="SMTP 미설정 — CTA 클릭은 시스템에 기록되지만 메일 통지는 발송되지 않습니다 (.env SMTP 설정 필요)"
              >
                ⚠ 메일통지 미설정
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input readOnly value={landingUrl} className="input !py-1.5 !text-xs flex-1 min-w-[220px]" />
            <button onClick={copyLink} className="btn-secondary !py-1.5 !text-xs">
              {copied ? '복사됨 ✓' : '🔗 링크 복사'}
            </button>
            <a href={landingUrl} target="_blank" rel="noreferrer" className="btn-secondary !py-1.5 !text-xs">
              미리보기
            </a>
            {canManage && (
              <button
                onClick={() => save({ closed: !landing.closed })}
                disabled={saving}
                className="btn-secondary !py-1.5 !text-xs"
              >
                {landing.closed ? '다시 열기' : '수동 닫기'}
              </button>
            )}
          </div>
          {landing.cta_clicks.length > 0 && (
            <div className="text-xs text-gray-700 border-t pt-2">
              <b>고객 반응</b>:{' '}
              {landing.cta_clicks
                .map((c) => {
                  const d = new Date(c.at);
                  const p = (n: number) => String(n).padStart(2, '0');
                  const t = isNaN(d.getTime())
                    ? c.at
                    : `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
                  return `${c.action === 'contract' ? '💍 계약 의사' : '📞 전화 상담'} (${t})`;
                })
                .join(' · ')}
            </div>
          )}
        </div>
      ) : (
        <div className="border rounded-md p-3 bg-gray-50/60 text-sm text-gray-600">
          아직 링크가 없습니다. 아래 내용을 입력하고 <b>발행</b>하면 링크가 생성됩니다.
        </div>
      )}

      {/* 설정 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] uppercase tracking-wide text-gray-500">
            {isConsult ? '링크 열람 기한 (기본 상담 후 7일)' : '가블록 종료일 (이 날짜까지 열람 가능)'}
          </label>
          <input
            type="date"
            className="input"
            value={blockUntil}
            onChange={(e) => setBlockUntil(e.target.value)}
            disabled={!canManage}
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-gray-500">
            견적 출처 예식후보 {customer ? `(${customer.wedding_event_name || '연결 고객'})` : ''}
          </label>
          {inquiries.length === 0 ? (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              연결된 웨딩 고객의 예식후보가 없습니다. 업체정보 탭에서 고객을 연결하세요.
            </div>
          ) : (
            <select
              className="input"
              value={matchedInquiry?.id || ''}
              onChange={(e) => setInquiryId(e.target.value)}
              disabled={!canManage}
            >
              {inquiries.map((q, i) => (
                <option key={q.id} value={q.id}>
                  #{i + 1} {q.wedding_datetime ? q.wedding_datetime.replace('T', ' ') : '(일시 미정)'}
                  {q.estimate_amount ? ` · ${q.estimate_amount}원` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* 견적 스냅샷 상태 */}
      <div className="border rounded-md p-3 bg-gray-50/40">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm">
            <b>맞춤 견적</b>:{' '}
            {quoteSnapshot ? (
              <span className="text-green-700">
                예상 하객 {quoteSnapshot.guests}명 · 총 {quoteSnapshot.total}원 — 발행 시 최신
                스냅샷으로 저장됩니다 ✓
              </span>
            ) : (
              <span className="text-amber-700">
                예식후보에 저장된 마진계산기 견적이 없습니다. (🧮 마진계산기에서 저장하면 자동
                연동 — 견적 없이 발행하면 랜딩에서 견적 섹션이 숨겨집니다)
              </span>
            )}
          </div>
          {quoteSnapshot && (
            <button onClick={() => setPreviewQuote((v) => !v)} className="btn-secondary !py-1 !text-xs">
              {previewQuote ? '견적 미리보기 접기' : '견적 미리보기'}
            </button>
          )}
        </div>
        {previewQuote && quoteSnapshot && (
          <div className="mt-2 border rounded bg-white max-h-96 overflow-auto">
            <style>{QUOTE_CSS}</style>
            <div className="qbox" dangerouslySetInnerHTML={{ __html: quoteSnapshot.html }} />
          </div>
        )}
      </div>

      {/* 중시항목 */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
          상담에서 중요하게 나눈 항목 (체크한 항목이 랜딩에 문구로 노출)
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {PRIORITY_KEYS.map((k) => (
            <label
              key={k}
              className={
                'flex items-center gap-1.5 text-xs border rounded px-2 py-1.5 cursor-pointer select-none ' +
                (priorities.includes(k) ? 'border-blue-400 bg-blue-50 text-blue-900' : 'bg-white')
              }
            >
              <input
                type="checkbox"
                checked={priorities.includes(k)}
                onChange={() => togglePriority(k)}
                disabled={!canManage}
              />
              {WEDDING_PRIORITY_LABEL[k]}
            </label>
          ))}
        </div>
        {(priorities.length > 0 || customNote.trim()) && (
          <div className="mt-1.5 text-xs text-gray-600 bg-gray-50 border rounded p-2 space-y-0.5">
            {priorities.map((k, i) => (
              <div key={k}>
                {i + 1}. {WEDDING_PRIORITY_SENTENCE[k]}
              </div>
            ))}
            {customNote
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((note, i) => (
                <div key={`c${i}`}>
                  {priorities.length + i + 1}. {note}
                </div>
              ))}
          </div>
        )}
        <div className="mt-2">
          <label className="text-[11px] uppercase tracking-wide text-gray-500">
            자유 추가 문구 (선택 — 쉼표(,)로 구분하면 각각 별도 줄로 노출)
          </label>
          <input
            className="input"
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
            placeholder="예: 직접 제작한 미디어월 연출, 야외 포토타임 동선 준비"
            disabled={!canManage}
          />
        </div>
      </div>

      {canManage && (
        <div className="flex justify-end">
          <button onClick={() => save()} disabled={saving} className="btn-primary">
            {saving ? '저장 중...' : landing ? '💾 저장 (스냅샷 갱신)' : '🚀 발행 — 링크 생성'}
          </button>
        </div>
      )}
    </div>
  );
}
