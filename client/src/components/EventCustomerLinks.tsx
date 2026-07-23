import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { matchesAnyField } from '../lib/koreanSearch';
import { nanoid } from '../lib/clientId';
import {
  CUSTOMER_ROLE_OPTIONS,
  type CustomerRole,
  type CustomerType,
  type EventCustomerLink,
  type MiceCustomer,
  type WeddingCustomer,
} from '../types';

// 업체정보(B 섹션) — 행사 구분에 따라 MICE / WEDDING DB만 검색.
// CONTACT POINT는 고객의 여러 담당자 중 사용자가 직접 선택.

type Draft = Omit<EventCustomerLink, 'event_id'>;

interface Props {
  eventType: CustomerType;
  links: Draft[];
  onChange: (next: Draft[]) => void;
}

type AnyCustomer = MiceCustomer | WeddingCustomer;

interface ContactOption {
  id: string;
  label: string; // 드롭다운 표기 (예: "문의#1 · 홍길동")
  name: string;
  phone: string;
  email: string;
}

// MICE: 모든 inquiry의 contacts를 펼쳐 후보군 생성
// WEDDING: 신랑/신부 두 후보 생성 (고정 id 'groom' / 'bride')
function getContactOptions(c: AnyCustomer): ContactOption[] {
  if (c.customer_type === 'MICE') {
    const opts: ContactOption[] = [];
    c.inquiries.forEach((inq, iIdx) => {
      inq.contacts.forEach((ct) => {
        opts.push({
          id: ct.id,
          label: `문의#${iIdx + 1} · ${ct.name || '(이름 없음)'}`,
          name: ct.name,
          phone: ct.phone,
          email: ct.email,
        });
      });
    });
    return opts;
  }
  // WEDDING
  const list: ContactOption[] = [];
  if (c.groom_name || c.groom_phone || c.groom_email) {
    list.push({
      id: 'groom',
      label: `신랑 · ${c.groom_name || ''}`,
      name: c.groom_name,
      phone: c.groom_phone,
      email: c.groom_email,
    });
  }
  if (c.bride_name || c.bride_phone || c.bride_email) {
    list.push({
      id: 'bride',
      label: `신부 · ${c.bride_name || ''}`,
      name: c.bride_name,
      phone: c.bride_phone,
      email: c.bride_email,
    });
  }
  return list;
}

function customerKeywords(c: AnyCustomer): Record<string, unknown> {
  if (c.customer_type === 'MICE') {
    return {
      organization_name: c.organization_name,
      mice_category: c.mice_category,
      official_phone: c.official_phone,
      official_email: c.official_email,
      _contacts: c.inquiries
        .flatMap((i) => i.contacts.map((ct) => `${ct.name} ${ct.email} ${ct.phone}`))
        .join(' '),
    };
  }
  return {
    wedding_event_name: c.wedding_event_name,
    groom_name: c.groom_name,
    bride_name: c.bride_name,
    groom_phone: c.groom_phone,
    bride_phone: c.bride_phone,
    groom_email: c.groom_email,
    bride_email: c.bride_email,
  };
}

function describeCustomer(c: AnyCustomer): string {
  if (c.customer_type === 'MICE') {
    return `${c.organization_name} (${c.mice_category})`;
  }
  return c.wedding_event_name;
}

function describeSub(c: AnyCustomer): string {
  if (c.customer_type === 'MICE') {
    const opts = getContactOptions(c);
    if (opts.length === 0) return `공식: ${c.official_phone || '-'}`;
    return opts
      .slice(0, 2)
      .map((o) => `${o.name || '(이름없음)'}`)
      .join(', ') + (opts.length > 2 ? ` 외 ${opts.length - 2}명` : '');
  }
  return `${c.groom_name || '?'} ♥ ${c.bride_name || '?'}`;
}

export default function EventCustomerLinks({ eventType, links, onChange }: Props) {
  const [customers, setCustomers] = useState<AnyCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);

  // 연결된 업체 클릭 → 고객정보 페이지의 원래 수정 팝업을 새 탭으로 (?focus= 딥링크).
  // 새 탭이라 행사수정 모달의 미저장 내용은 그대로 유지된다.
  function openCustomerPopup(c: AnyCustomer) {
    const base = c.customer_type === 'MICE' ? '/customers/mice' : '/customers/wedding';
    window.open(`${base}?focus=${c.id}`, '_blank');
  }

  useEffect(() => {
    let aborted = false;
    setLoading(true);
    setError(null);
    const url = eventType === 'MICE' ? '/api/customers/mice' : '/api/customers/wedding';
    api
      .get<{ customers: AnyCustomer[] }>(url)
      .then((res) => {
        if (!aborted) setCustomers(res.customers);
      })
      .catch((e) => {
        if (!aborted) setError('고객 목록을 불러오지 못했습니다 (권한 또는 네트워크 확인).');
        console.error(e);
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [eventType]);

  const linkedIds = useMemo(() => new Set(links.map((l) => l.customer_id)), [links]);

  const candidates = useMemo(() => {
    const pool = customers.filter((c) => !linkedIds.has(c.id));
    if (!query.trim()) return pool.slice(0, 8);
    const SEARCH_FIELDS =
      eventType === 'MICE'
        ? ['organization_name', 'mice_category', 'official_phone', 'official_email', '_contacts']
        : [
            'wedding_event_name',
            'groom_name',
            'bride_name',
            'groom_phone',
            'bride_phone',
            'groom_email',
            'bride_email',
          ];
    return pool
      .filter((c) => matchesAnyField(customerKeywords(c), SEARCH_FIELDS, query))
      .slice(0, 8);
  }, [customers, linkedIds, query, eventType]);

  const customerById = useMemo(() => {
    const m = new Map<string, AnyCustomer>();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  function addLink(c: AnyCustomer) {
    const opts = getContactOptions(c);
    const next: Draft = {
      id: nanoid(),
      customer_id: c.id,
      customer_role: '주최사',
      is_contact_point: links.length === 0,
      contact_point_contact_id: opts[0]?.id || '',
    };
    onChange([...links, next]);
    setQuery('');
    setShowSuggest(false);
  }

  function removeLink(id: string) {
    onChange(links.filter((l) => l.id !== id));
  }

  function updateLink(id: string, patch: Partial<Draft>) {
    onChange(links.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  const isMice = eventType === 'MICE';

  return (
    <div>
      <div className="text-sm text-gray-600 mb-3">
        {isMice
          ? 'MICE 행사에는 여러 업체를 연결하고 역할(주최사 / 대행사 / 협력사 / 회계 담당 / 기타)을 지정할 수 있습니다.'
          : '웨딩 행사는 신랑/신부 정보가 등록된 WEDDING 고객 레코드를 연결합니다.'}{' '}
        CONTACT POINT 담당자는 직접 선택할 수 있고, 강조 표시됩니다.
      </div>

      <div className="relative mb-4">
        <input
          type="text"
          className="input"
          placeholder={
            isMice
              ? '검색: 업체명 / 카테고리 / 담당자 / 연락처 / 이메일'
              : '검색: 행사명 / 신랑·신부 이름 / 전화번호'
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggest(true);
          }}
          onFocus={() => setShowSuggest(true)}
          onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
          disabled={loading}
        />
        {showSuggest && (
          <div className="absolute left-0 right-0 mt-1 bg-white border rounded-md shadow-lg z-20 max-h-72 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-2 text-xs text-gray-400">불러오는 중...</div>
            ) : error ? (
              <div className="px-3 py-2 text-xs text-red-500">{error}</div>
            ) : candidates.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">
                {customers.length === 0
                  ? `${eventType} 고객 DB에 등록된 고객이 없습니다.`
                  : query
                    ? '검색 결과가 없습니다.'
                    : '연결할 수 있는 고객이 더 없습니다.'}
              </div>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addLink(c);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0"
                >
                  <div className="text-sm font-medium text-gray-900">
                    {describeCustomer(c)}
                  </div>
                  <div className="text-xs text-gray-500">{describeSub(c)}</div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* 연결된 고객 리스트 */}
      {links.length === 0 ? (
        <div className="text-xs text-gray-400 italic py-3 border rounded-md text-center">
          연결된 업체가 없습니다. 위 검색창에서 추가하세요.
        </div>
      ) : (
        <div className="space-y-2">
          {links.map((l) => {
            const c = customerById.get(l.customer_id);
            const opts: ContactOption[] = c ? getContactOptions(c) : [];
            // CONTACT POINT 담당자가 미지정 또는 더 이상 존재하지 않으면 첫 후보로 fallback
            const cpContact =
              opts.find((o) => o.id === l.contact_point_contact_id) || opts[0] || null;
            const cp = l.is_contact_point;
            return (
              <div
                key={l.id}
                className={
                  'border rounded-md p-3 ' +
                  (cp ? 'border-blue-400 bg-blue-50/50' : 'bg-white')
                }
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className={'font-medium ' + (cp ? 'text-blue-900' : 'text-gray-900')}>
                      {c ? (
                        <button
                          type="button"
                          onClick={() => openCustomerPopup(c)}
                          className="text-left hover:underline focus:outline-none focus:underline"
                          title="클릭하여 고객정보에서 열기 (새 탭)"
                        >
                          {describeCustomer(c)}
                          <span className="ml-1 text-[10px] text-gray-400">🔍</span>
                        </button>
                      ) : (
                        '(삭제된 고객)'
                      )}
                      {cp && (
                        <span className="ml-2 badge bg-blue-600 text-white">CONTACT POINT</span>
                      )}
                    </div>
                    <div
                      className={
                        'text-xs ' + (cp ? 'text-blue-800 font-medium' : 'text-gray-500')
                      }
                    >
                      {cpContact
                        ? `${cpContact.name || '(이름 없음)'} · ${cpContact.phone || '-'} · ${cpContact.email || '-'}`
                        : c
                          ? describeSub(c)
                          : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {isMice && (
                      <select
                        className="input !py-1 !text-xs !w-32"
                        value={l.customer_role}
                        onChange={(e) =>
                          updateLink(l.id, { customer_role: e.target.value as CustomerRole })
                        }
                      >
                        {CUSTOMER_ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={l.is_contact_point}
                        onChange={(e) =>
                          updateLink(l.id, { is_contact_point: e.target.checked })
                        }
                      />
                      CONTACT POINT
                    </label>
                    <button
                      type="button"
                      onClick={() => removeLink(l.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      연결 해제
                    </button>
                  </div>
                </div>

                {/* CONTACT POINT 담당자 선택 — is_contact_point일 때만 노출 */}
                {cp && opts.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-blue-200 flex items-center gap-2">
                    <label className="text-xs text-blue-800 font-medium">
                      CONTACT POINT 담당자:
                    </label>
                    <select
                      className="input !py-1 !text-xs !w-auto"
                      value={l.contact_point_contact_id || (opts[0]?.id ?? '')}
                      onChange={(e) =>
                        updateLink(l.id, { contact_point_contact_id: e.target.value })
                      }
                    >
                      {opts.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {opts.length > 1 && (
                      <span className="text-[11px] text-gray-500">
                        ({opts.length}명 중 선택)
                      </span>
                    )}
                  </div>
                )}
                {cp && opts.length === 0 && (
                  <div className="mt-2 pt-2 border-t border-blue-200 text-xs text-blue-700">
                    이 고객에 등록된 담당자가 없습니다. 고객정보 DB에서 담당자를 먼저 추가해주세요.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
