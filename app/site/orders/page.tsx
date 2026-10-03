'use client';

/**
 * 현장 — 전자 납품서.
 *
 * 차량 한 대가 한 장이다. 종이 납품서가 그렇게 나오기 때문이다 — 트럭 한 대가
 * 실은 배치마다 한 장씩 받아 서명한다. 전에는 주문 한 건이 한 장이고 차량은
 * 그 안의 표 한 줄이었는데, 그러면 한 장을 뽑아 현장에 주거나 차량별로 보관할
 * 수가 없었다.
 *
 * 날짜로 묶는다. 현장 사무는 "9월 29일 화요일에 몇 ㎥ 들어왔나" 로 센다.
 * 정산도 그렇게 한다.
 *
 * 저장은 두 가지다.
 *   인쇄       한 장을 그대로 — 브라우저에서 PDF 로 저장하면 된다
 *   CSV 내려받기  그날 전체를 표로 — 엑셀에서 열어 정산에 쓴다
 */

import { useEffect, useMemo, useState } from 'react';
import { SiteShell } from '@/components/RoleShells';
import { Empty, MockNotice, Panel, Row, Tag } from '@/components/ui';
import {
  groupByDay,
  notesOfSite,
  notesToCsv,
  type DeliveryNote,
  type NoteDay,
} from '@/lib/delivery-note';
import { clock, dateClock, m3 } from '@/lib/format';
import { ORDER_STATUS_LABEL, ORDER_TONE, cementShort } from '@/lib/rules';
import { photoUrl } from '@/lib/services/photos';
import { ordersOfSite, setOrderStatus } from '@/lib/store';
import { useDb, useMounted } from '@/lib/store/hooks';
import { useSeenNotes } from '@/lib/useSeenNotes';
import type { Site } from '@/lib/types';
import ns from './note-sheet.module.css';

export default function OrdersPage() {
  return (
    <SiteShell
      title="전자 납품서"
      description="차량 한 대가 한 장입니다. 날짜별로 묶어 보여 주고, 인쇄하거나 내려받을 수 있습니다."
      showClock={false}
    >
      {(site) => <NotesBody site={site} />}
    </SiteShell>
  );
}

function NotesBody({ site }: { site: Site }) {
  const db = useDb();
  const mounted = useMounted();
  const [openId, setOpenId] = useState<string | null>(null);

  const notes = useMemo(() => notesOfSite(db, site.id), [db, site.id]);
  const days = useMemo(() => groupByDay(notes), [notes]);
  const { freshCount, isFresh } = useSeenNotes(site.id, notes);

  if (!mounted) return <Empty>불러오는 중…</Empty>;

  const total = days.reduce((s, d) => s + d.notes.length, 0);

  return (
    <>
      <MockNotice />

      {/*
        기사가 하역 완료를 누르면 그 장이 확정돼 여기로 넘어온다.
        몇 장이 새로 왔는지 먼저 말해 주지 않으면 매번 전부 훑어야 한다.
      */}
      {freshCount > 0 && (
        <Panel style={{ borderWidth: 2, borderColor: 'var(--color-rust)' }}>
          <strong style={{ fontSize: '0.94rem' }}>새 납품서 {freshCount}장</strong>
          <p style={{ fontSize: '0.86rem', margin: '6px 0 0', lineHeight: 1.6 }}>
            기사가 하역을 마치고 보낸 납품서입니다. 아래에서{' '}
            <Tag tone="accent">새 납품서</Tag> 표시가 붙은 장을 확인하세요.
          </p>
        </Panel>
      )}

      {total === 0 ? (
        <Panel>
          <Empty>
            아직 납품서가 없습니다.
            <br />
            공장이 출하 지시를 내리면 차량마다 한 장씩 만들어집니다.
          </Empty>
        </Panel>
      ) : (
        days.map((day) => (
          <DaySection
            key={day.key}
            day={day}
            siteName={site.name}
            openId={openId}
            onToggle={(id) => setOpenId(openId === id ? null : id)}
            isFresh={isFresh}
          />
        ))
      )}

      <OrderHistory site={site} />
    </>
  );
}

/* ==========================================================================
 * 주문 내역
 *
 * 납품서는 차가 나간 뒤에야 생긴다. 아직 수락 전이거나 거절된 주문은 납품서가
 * 없어서 이 화면에서 아예 사라진다 — 취소할 방법도 같이 사라진다. 그래서 목록을
 * 따로 둔다.
 * ======================================================================== */

function OrderHistory({ site }: { site: Site }) {
  const db = useDb();
  const orders = ordersOfSite(db, site.id);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (orders.length === 0) return null;

  async function cancel(orderId: string) {
    setBusyId(orderId);
    try {
      await setOrderStatus(orderId, 'cancelled');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel title={`주문 내역 ${orders.length}건`}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>주문번호</th>
              <th>공장</th>
              <th className="num">물량</th>
              <th>타설</th>
              <th>상태</th>
              <th className="no-print" />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const plant = db.plants.find((p) => p.id === o.plantId);
              return (
                <tr key={o.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{o.code}</td>
                  <td style={{ fontSize: '0.8rem' }}>{plant?.name ?? '—'}</td>
                  <td className="num">{o.volumeM3}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {dateClock(o.pourStartAt)}
                  </td>
                  <td>
                    <Tag tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Tag>
                    {o.urgent && <Tag tone="bad">긴급</Tag>}
                  </td>
                  <td className="no-print">
                    {o.status === 'requested' && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--color-bad)', padding: '2px 6px' }}
                        disabled={busyId === o.id}
                        onClick={() => void cancel(o.id)}
                      >
                        취소
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)', margin: '8px 0 0' }}>
        수락 대기 중인 주문만 취소할 수 있습니다. 공장이 이미 배차했으면 전화로 알려 주세요.
      </p>
    </Panel>
  );
}

/* ==========================================================================
 * 하루치
 * ======================================================================== */

function DaySection({
  day,
  siteName,
  openId,
  onToggle,
  isFresh,
}: {
  day: NoteDay;
  siteName: string;
  openId: string | null;
  onToggle: (id: string) => void;
  isFresh: (code: string) => boolean;
}) {
  function download() {
    const csv = notesToCsv(day.notes);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 파일 이름만 보고도 어느 현장 어느 날인지 알 수 있게
    a.download = `납품서_${siteName}_${day.key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel
      title={day.label}
      aside={
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {day.overCount > 0 && <Tag tone="bad">제한 초과 {day.overCount}장</Tag>}
          <Tag tone="muted">
            {day.notes.length}장 · {m3(day.totalM3)}
          </Tag>
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {day.notes.map((n) => (
          <NoteCard
            key={n.deliveryId}
            note={n}
            fresh={isFresh(n.code)}
            open={openId === n.deliveryId}
            onToggle={() => onToggle(n.deliveryId)}
          />
        ))}
      </div>

      <button
        type="button"
        className="btn btn-outline btn-sm btn-block no-print"
        style={{ marginTop: 12 }}
        onClick={download}
      >
        이 날짜 {day.notes.length}장 내려받기 (CSV)
      </button>
      <p style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)', margin: '8px 0 0' }}>
        엑셀에서 바로 열립니다. 정산·품질 기록으로 쓰세요.
      </p>
    </Panel>
  );
}

/* ==========================================================================
 * 납품서 한 장
 * ======================================================================== */

function NoteCard({
  note,
  fresh,
  open,
  onToggle,
}: {
  note: DeliveryNote;
  /** 이번에 처음 보는 확정 납품서인가 */
  fresh: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    // 인쇄할 때는 펼쳐 놓은 한 장만 나가게 한다
    <article
      className={`card card-pad ${open ? 'print-only-this' : 'no-print'}`}
      style={{ padding: 12 }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}
        aria-expanded={open}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem' }}>
            {note.code}
          </strong>
          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
            {note.truckNo != null ? `${note.truckNo}호차` : '호차 미상'}
          </span>
          <span style={{ fontSize: '0.82rem', color: 'var(--color-concrete-wet)' }}>
            {m3(note.volumeM3)} · {clock(note.mixStartAt)} 출하
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            {/* 아직 안 본 장 — 기사가 하역 완료를 누른 뒤 넘어온 것 */}
            {fresh && <Tag tone="accent">새 납품서</Tag>}
            {note.within == null ? (
              <Tag tone="info">진행 중</Tag>
            ) : note.within ? (
              <Tag tone="ok">제한 내 {note.elapsedMin}분</Tag>
            ) : (
              <Tag tone="bad">초과 {note.elapsedMin}분</Tag>
            )}
          </span>
        </div>
      </button>

      {open && <NoteSheet note={note} />}
    </article>
  );
}

/** 2026년 07월 28일 — 종이 납품서 머리의 날짜 */
function paperDate(at: number) {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}년 ${p(d.getMonth() + 1)}월 ${p(d.getDate())}일`;
}

/** 08시 01분 — 아직 없는 시각이면 빈 칸으로 둔다 (종이에 손으로 채우는 칸처럼) */
function paperTime(at: number | undefined) {
  if (at == null) return '　　시　　분';
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}시 ${p(d.getMinutes())}분`;
}

/** 6.00 */
const paperM3 = (v: number) => v.toFixed(2);

/** 종이 납품서 시방 배합표의 칸 */
const MIX_COLUMNS = [
  '시멘트',
  '혼화재',
  '굵은골재',
  '잔골재',
  '물',
  '혼화제',
  '물-결합재비 (%)',
  '잔골재율 (%)',
];

/**
 * 펼친 납품서 — 인쇄하면 이 모양 그대로 나간다.
 * 칸 배치는 현장에서 받는 종이 레디믹스트 콘크리트 납품서(KS F 4009)를 따른다.
 * 현장 사무는 종이 양식에 눈이 익어 있어서, 같은 칸이 같은 자리에 있어야 바로 읽는다.
 */
function NoteSheet({ note }: { note: DeliveryNote }) {
  return (
    <div>
      <div className={ns.sheet}>
        <div className={ns.head}>
          <div className={ns.ks}>
            <strong>KS</strong>
            <br />
            KS F 4009
            <br />
            레디믹스트 콘크리트
          </div>
          <h3 className={ns.title}>레디믹스트 콘크리트 납품서</h3>
        </div>

        <div className={ns.addressee}>
          <strong>{note.siteName} 귀하</strong>
          <span>{paperDate(note.mixStartAt)}</span>
        </div>

        <SheetRow label="NO.">
          <span className={ns.num}>{note.code}</span>{' '}
          <span className={ns.muted}>({note.round}회차)</span>
        </SheetRow>
        <SheetRow label="납품 장소">
          {note.siteName}
          {note.siteAddress && <span className={ns.muted}> · {note.siteAddress}</span>}
        </SheetRow>
        <SheetRow label="운반차 번호">
          <span className={ns.split}>
            <span className={ns.num}>{note.truckNo != null ? `${note.truckNo}호차` : '—'}</span>
            <span>{note.plateNo || '—'}</span>
            <span>{note.driverName || '—'}</span>
          </span>
        </SheetRow>
        <SheetRow label="납품 시간">
          <span className={ns.split}>
            <span>
              출발 <span className={ns.num}>{paperTime(note.departAt)}</span>
            </span>
            <span>
              도착 <span className={ns.num}>{paperTime(note.arriveAt)}</span>
            </span>
          </span>
        </SheetRow>
        <SheetRow label="납품 용적">
          <span className={ns.split}>
            <span>
              <span className={ns.num}>{paperM3(note.volumeM3)}</span> m³
            </span>
            <span>
              누계 <span className={ns.num}>{paperM3(note.cumulativeM3)}</span> m³
            </span>
          </span>
        </SheetRow>

        <SheetBlock title="호칭 방법">
          <SheetCell head="콘크리트의 종류에 따른 구분">{note.spec.type} 콘크리트</SheetCell>
          <SheetCell head="굵은골재 최대치수 (mm)" num>
            {note.spec.aggMm}
          </SheetCell>
          <SheetCell head="호칭강도 (MPa)" num>
            {note.spec.strength}
          </SheetCell>
          <SheetCell head={`${note.spec.slumpKind === 'flow' ? '슬럼프플로' : '슬럼프'} (mm)`} num>
            {note.spec.slumpMm}
          </SheetCell>
          <SheetCell head="시멘트 종류에 따른 구분">{cementShort(note.spec.cement)}</SheetCell>
        </SheetBlock>

        {/*
          배합표는 공장이 정하는 값이라 앱에 아직 없다. 지어내지 않고 칸만 둔다 —
          공장 배합 자료가 연동되면 이 자리에 들어간다.
        */}
        <SheetBlock
          title="시방 배합표 (kg/m³)"
          caption="배합표는 공장 배합 자료가 연동되면 채워집니다."
        >
          {MIX_COLUMNS.map((h) => (
            <SheetCell key={h} head={h}>
              <span className={ns.muted}>—</span>
            </SheetCell>
          ))}
        </SheetBlock>

        <SheetRow label="지정 사항">
          {note.orderNote || <span className={ns.muted}>—</span>}
        </SheetRow>
        <SheetRow label="비고">
          {note.siteAccessNote && <div>{note.siteAccessNote}</div>}
          <div>
            타설 종료 <span className={ns.num}>{paperTime(note.completedAt)}</span>
          </div>
        </SheetRow>

        {/*
          인수자 확인 = 하역 완료를 누른 시각이자 이 장이 현장으로 넘어온 시각이다.
          사람이 손으로 적는 칸을 두지 않는다 — 틀리거나 비어 있기 마련이다.
        */}
        <div className={`${ns.row} ${ns.confirm}`}>
          <div>
            <div className={ns.label}>인수자 확인</div>
            <div className={ns.value}>
              {note.issued ? (
                <>
                  <span className={ns.num}>{clock(note.issuedAt)}</span>{' '}
                  <Tag tone="ok">현장 수신</Tag>
                </>
              ) : (
                <Tag tone="info">하역 완료 전</Tag>
              )}
            </div>
          </div>
          <div>
            <div className={ns.label}>출하자 확인</div>
            <div className={ns.value}>
              {note.plantName}
              <div className={ns.muted}>비비기 {clock(note.mixStartAt)}</div>
            </div>
          </div>
        </div>

        <div className={ns.foot}>
          <strong>{note.plantName}</strong>
          {note.plantAddress && <> · {note.plantAddress}</>}
          {note.plantPhone && <> · (출하실) {note.plantPhone}</>}
        </div>
      </div>

      <div style={{ height: 14 }} />
      <SheetGroup title="판정">
        <Row label="외기온도">{note.tempC}℃</Row>
        <Row label="제한시간">비비기~타설 완료 {note.limitMinutes}분</Row>
        <Row label="경과">
          {note.elapsedMin != null ? `${note.elapsedMin}분` : '—'}{' '}
          {note.within == null ? (
            <Tag tone="info">진행 중</Tag>
          ) : note.within ? (
            <Tag tone="ok">제한 내</Tag>
          ) : (
            <Tag tone="bad">제한 초과</Tag>
          )}
        </Row>
      </SheetGroup>

      {note.notePhotoPath && <PaperPhoto path={note.notePhotoPath} />}

      <p style={{ fontSize: '0.74rem', color: 'var(--color-concrete-mid)', margin: '14px 0 0' }}>
        제한시간은 비비기 시작부터 타설 완료까지 {note.limitMinutes}분입니다 (외기 {note.tempC}℃
        기준). 책임기술자 승인이나 응결지연제 사용 시 달라질 수 있습니다.
      </p>

      <button
        type="button"
        className="btn btn-outline btn-sm no-print"
        style={{ marginTop: 12 }}
        onClick={() => window.print()}
      >
        이 납품서 인쇄 · PDF 저장
      </button>
    </div>
  );
}

/** 납품서 한 줄 — 왼쪽 칸 이름, 오른쪽 내용 */
function SheetRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={ns.row}>
      <div className={ns.label}>{label}</div>
      <div className={ns.value}>{children}</div>
    </div>
  );
}

/** 칸이 여럿인 표 한 덩어리 — 호칭 방법, 시방 배합표 */
function SheetBlock({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={ns.block}>
      <div className={ns.blockTitle}>{title}</div>
      <div className={ns.cellsWrap}>
        <div className={ns.cells}>{children}</div>
      </div>
      {caption && <div className={ns.caption}>{caption}</div>}
    </div>
  );
}

/** 표 안의 칸 하나 — 위에 항목 이름, 아래에 값 */
function SheetCell({
  head,
  num,
  children,
}: {
  head: string;
  num?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={ns.cell}>
      <span className={ns.cellHead}>{head}</span>
      <span className={num ? ns.num : undefined}>{children}</span>
    </div>
  );
}

function SheetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 12 }}>
      <h4
        style={{
          fontSize: '0.78rem',
          fontWeight: 700,
          color: 'var(--color-rust)',
          margin: '0 0 4px',
        }}
      >
        {title}
      </h4>
      {children}
    </section>
  );
}

/** 기사가 찍어 올린 종이 납품서 */
function PaperPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);

  // 비공개 저장소라 볼 때마다 짧게 사는 서명 주소를 새로 받는다
  useEffect(() => {
    let alive = true;
    photoUrl('note', path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);

  if (!url) return null;
  return (
    <SheetGroup title="종이 납품서">
      {/* 기사가 올린 사진이라 크기를 알 수 없다 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="기사가 찍어 올린 종이 납품서"
        style={{
          width: '100%',
          border: '1px solid var(--color-line-strong)',
          borderRadius: 'var(--radius-sharp)',
        }}
      />
    </SheetGroup>
  );
}
