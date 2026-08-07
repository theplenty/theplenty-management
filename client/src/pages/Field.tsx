// 현장 모드 (로드맵 A6) — 연회·주방이 폰으로 보는 화면.
//
// 사무실 화면을 그대로 줄이지 않고 따로 만든 이유:
//   현장에서 필요한 건 "오늘 몇 시에, 어느 홀에, 몇 명, 뭐가 나가는지" 뿐이다.
//   매출·고객·정산은 오히려 방해가 된다. 그래서 날짜 하나에 필요한 것만 크게 보여준다.
//
// 데이터도 하루치만 받는다(`/api/events/_day`). 전체 목록 API 는 977건 + 식음 전체를
// 내려주는데 현장 모바일 데이터로 그걸 받게 할 수 없다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { parseBeoDoc } from '../lib/beoDoc';
import type { BeoDoc } from '../lib/beoDoc';
import { WEEKDAYS_KO, todayKst, shiftDate } from '../lib/dateFmt';
import type { FoodItem } from '../types';

interface FieldEvent {
  id: string;
  event_name: string;
  event_type: 'MICE' | 'WEDDING';
  status: string;
  usage_type: string | null;
  halls: string[];
  seats: number | null;
  start_datetime: string;
  end_datetime: string;
  assigned_manager_name: string;
  memo: string;
  food_gtd: number | null;
  food_exp: number | null;
  food_items: FoodItem[];
  beo_payload: string | null;
  collaboration: { id: string; status: string } | null;
}

const todayStr = todayKst;

function dayLabel(d: string): string {
  const t = new Date(`${d}T00:00:00`);
  const rel = Math.round((t.getTime() - new Date(`${todayStr()}T00:00:00`).getTime()) / 86400000);
  const base = `${t.getMonth() + 1}월 ${t.getDate()}일 (${WEEKDAYS_KO[t.getDay()]})`;
  if (rel === 0) return `오늘 · ${base}`;
  if (rel === 1) return `내일 · ${base}`;
  if (rel === -1) return `어제 · ${base}`;
  return base;
}

const hhmm = (s: string) => (s || '').slice(11, 16);

/** 식음 한 줄을 현장에서 읽을 문구로 */
function foodLine(f: FoodItem): { time: string; name: string; qty: string; memo: string } {
  const gtd = f.gtd_final ?? f.gtd_contract;
  const exp = f.exp_final ?? f.exp_contract;
  const qty =
    f.quantity !== null && f.quantity !== undefined
      ? `${f.quantity}개`
      : gtd !== null || exp !== null
        ? `GTD ${gtd ?? '-'} / EXP ${exp ?? '-'}`
        : '';
  return {
    time: f.service_time || f.time_label || '',
    name: f.menu_name,
    qty,
    memo: f.memo || '',
  };
}

const STATUS_STYLE: Record<string, string> = {
  DEF: 'bg-emerald-100 text-emerald-800',
  INQ: 'bg-amber-100 text-amber-800',
  LOS: 'bg-gray-200 text-gray-600',
};

export default function Field() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || todayStr();
  const [events, setEvents] = useState<FieldEvent[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setDate = useCallback(
    (d: string) => {
      setParams(d === todayStr() ? {} : { date: d }, { replace: true });
      setOpenId(null);
    },
    [setParams]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get<{ date: string; events: FieldEvent[] }>(`/api/events/_day?date=${date}`)
      .then((r) => {
        if (alive) setEvents(r.events);
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [date]);

  const open = useMemo(() => events.find((e) => e.id === openId) || null, [events, openId]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 상단 날짜 바 — 엄지로 누르기 쉽게 크게 */}
      <header className="sticky top-0 z-20 bg-white border-b shadow-sm">
        <div className="flex items-center gap-1 px-2 py-2">
          <button
            onClick={() => setDate(shiftDate(date, -1))}
            aria-label="이전 날"
            className="w-12 h-12 rounded-lg text-2xl text-gray-600 active:bg-gray-100"
          >
            ‹
          </button>
          <div className="flex-1 text-center">
            <div className="text-base font-bold">{dayLabel(date)}</div>
            <div className="text-xs text-gray-500">
              {loading ? '불러오는 중…' : `행사 ${events.length}건`}
            </div>
          </div>
          <button
            onClick={() => setDate(shiftDate(date, 1))}
            aria-label="다음 날"
            className="w-12 h-12 rounded-lg text-2xl text-gray-600 active:bg-gray-100"
          >
            ›
          </button>
        </div>
        <div className="flex items-center gap-2 px-3 pb-2">
          <button
            onClick={() => setDate(todayStr())}
            className="text-sm px-3 py-1.5 rounded-full border bg-white active:bg-gray-100"
          >
            오늘로
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="flex-1 border rounded-lg px-2 py-1.5 text-sm bg-white"
          />
        </div>
      </header>

      {error && <div className="m-3 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      {/* 행사 카드 */}
      <main className="p-3 space-y-3 pb-24">
        {!loading && !events.length && (
          <p className="text-center text-gray-400 py-16">이 날짜에 등록된 행사가 없습니다.</p>
        )}

        {events.map((e) => (
          <button
            key={e.id}
            onClick={() => setOpenId(e.id)}
            className="w-full text-left bg-white rounded-xl border shadow-sm p-4 active:bg-gray-50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xl font-bold tabular-nums">
                  {hhmm(e.start_datetime)}
                  {hhmm(e.end_datetime) && <span className="text-gray-400"> ~ {hhmm(e.end_datetime)}</span>}
                </div>
                <div className="text-base font-semibold truncate mt-0.5">{e.event_name}</div>
              </div>
              <span className={`shrink-0 text-xs px-2 py-1 rounded-full ${STATUS_STYLE[e.status] || 'bg-gray-100 text-gray-600'}`}>
                {e.status}
              </span>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-700">
              <span>🏛 {e.halls?.length ? e.halls.join(', ') : '홀 미지정'}</span>
              {e.seats !== null && <span>🪑 {e.seats}석</span>}
              {(e.food_gtd !== null || e.food_exp !== null) && (
                <span className="font-semibold text-blue-700">
                  🍽 GTD {e.food_gtd ?? '-'} / EXP {e.food_exp ?? '-'}
                </span>
              )}
            </div>

            {!!e.food_items.length && (
              <div className="mt-2 text-xs text-gray-500 truncate">
                {e.food_items.map((f) => f.menu_name).join(' · ')}
              </div>
            )}
          </button>
        ))}
      </main>

      {open && <DetailSheet event={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// 상세 — 폰에서 아래에서 올라오는 시트
function DetailSheet({ event: e, onClose }: { event: FieldEvent; onClose: () => void }) {
  const beo: BeoDoc | null = useMemo(() => parseBeoDoc(e.beo_payload), [e.beo_payload]);
  const foods = e.food_items.map(foodLine);

  return (
    <div className="fixed inset-0 z-30 flex flex-col">
      <button className="flex-1 bg-black/40" onClick={onClose} aria-label="닫기" />
      <div className="bg-white rounded-t-2xl max-h-[88vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold truncate">{e.event_name}</div>
            <div className="text-sm text-gray-500">
              {hhmm(e.start_datetime)} ~ {hhmm(e.end_datetime)} · {e.halls?.join(', ') || '홀 미지정'}
            </div>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-lg text-2xl text-gray-500 active:bg-gray-100">
            ×
          </button>
        </div>

        <div className="p-4 space-y-5 pb-10">
          <Grid
            items={[
              ['구분', e.event_type === 'WEDDING' ? '웨딩' : 'MICE'],
              ['상태', e.status],
              ['좌석', e.seats !== null ? `${e.seats}석` : '-'],
              ['이용형태', e.usage_type || '-'],
              ['GTD / EXP', `${e.food_gtd ?? '-'} / ${e.food_exp ?? '-'}`],
              ['담당자', e.assigned_manager_name || '-'],
            ]}
          />

          {!!foods.length && (
            <Section title="식음">
              <ul className="divide-y">
                {foods.map((f, i) => (
                  <li key={i} className="py-2.5">
                    <div className="flex items-baseline gap-2">
                      {f.time && <span className="text-sm font-bold tabular-nums text-blue-700 shrink-0">{f.time}</span>}
                      <span className="font-medium">{f.name}</span>
                    </div>
                    {f.qty && <div className="text-sm text-gray-600 mt-0.5">{f.qty}</div>}
                    {f.memo && <div className="text-sm text-amber-700 mt-0.5">※ {f.memo}</div>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {e.memo && (
            <Section title="행사 메모">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{e.memo}</p>
            </Section>
          )}

          {beo && (
            <>
              {!!beo.schedule.length && (
                <Section title="BEO 진행 순서">
                  <ul className="divide-y">
                    {beo.schedule.map((r) => (
                      <li key={r.id} className="py-2.5">
                        <div className="flex items-baseline gap-2">
                          {r.time && <span className="text-sm font-bold tabular-nums text-blue-700 shrink-0">{r.time}</span>}
                          <span className="font-medium">{r.func || '-'}</span>
                        </div>
                        <div className="text-sm text-gray-600 mt-0.5">
                          {[r.room, r.setup, r.gtd && `GTD ${r.gtd}`, r.exp && `EXP ${r.exp}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {beo.sections
                .filter((s) => s.body.trim())
                .map((s) => (
                  <Section key={s.id} title={`BEO · ${s.title}`}>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{s.body}</p>
                  </Section>
                ))}
              {beo.signboard && (
                <Section title="간판 문구">
                  <p className="text-sm">{beo.signboard}</p>
                </Section>
              )}
            </>
          )}

          {!beo && (
            <p className="text-sm text-gray-400 text-center py-4">아직 작성된 BEO 가 없습니다.</p>
          )}

          <a
            href={`/events/${e.id}`}
            className="block text-center text-sm text-blue-600 underline py-2"
          >
            전체 화면에서 열기 (수정)
          </a>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-bold text-gray-500 mb-1.5">{title}</h3>
      <div className="bg-gray-50 rounded-lg px-3 py-1">{children}</div>
    </section>
  );
}

function Grid({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-gray-500">{k}</dt>
          <dd className="text-base font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
