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
import {
  ORDER_STATUS_LABEL,
  ORDER_TONE,
  cementShort,
  slumpLabel,
  specCode,
  strengthLabel,
} from '@/lib/rules';
import { photoUrl } from '@/lib/services/photos';
import { ordersOfSite, setOrderStatus } from '@/lib/store';
import { useDb, useMounted } from '@/lib/store/hooks';
import type { Site } from '@/lib/types';

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

  const days = useMemo(() => groupByDay(notesOfSite(db, site.id)), [db, site.id]);

  if (!mounted) return <Empty>불러오는 중…</Empty>;

  const total = days.reduce((s, d) => s + d.notes.length, 0);

  return (
    <>
      <MockNotice />

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
}: {
  day: NoteDay;
  siteName: string;
  openId: string | null;
  onToggle: (id: string) => void;
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
  open,
  onToggle,
}: {
  note: DeliveryNote;
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
          <span style={{ marginLeft: 'auto' }}>
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

/** 펼친 납품서 — 인쇄하면 이 모양 그대로 나간다 */
function NoteSheet({ note }: { note: DeliveryNote }) {
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--color-line)', paddingTop: 14 }}>
      <h3 style={{ fontSize: '1rem', margin: '0 0 2px' }}>레디믹스트 콘크리트 납품서</h3>
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          color: 'var(--color-concrete-mid)',
          margin: '0 0 14px',
        }}
      >
        {note.code} · {note.round}회차
      </p>

      <SheetGroup title="공급자">
        <Row label="공장">{note.plantName}</Row>
        <Row label="주소">{note.plantAddress}</Row>
        <Row label="전화">{note.plantPhone || '—'}</Row>
      </SheetGroup>

      <SheetGroup title="수요자">
        <Row label="현장">{note.siteName}</Row>
        <Row label="주소">{note.siteAddress}</Row>
      </SheetGroup>

      <SheetGroup title="운반 차량">
        <Row label="호차">{note.truckNo != null ? `${note.truckNo}호차` : '—'}</Row>
        <Row label="차량번호">{note.plateNo || '—'}</Row>
        <Row label="기사">{note.driverName || '—'}</Row>
      </SheetGroup>

      <SheetGroup title="규격">
        <Row label="종류">{note.spec.type}</Row>
        <Row label="호칭">{specCode(note.spec)}</Row>
        <Row label="강도">{strengthLabel(note.spec)}</Row>
        <Row label="슬럼프">{slumpLabel(note.spec)}</Row>
        <Row label="시멘트">{cementShort(note.spec.cement)}</Row>
        <Row label="수량">{m3(note.volumeM3)}</Row>
      </SheetGroup>

      <SheetGroup title="시각">
        <Row label="비비기 시작">{clock(note.mixStartAt)}</Row>
        <Row label="공장 출발">{clock(note.departAt)}</Row>
        <Row label="현장 도착">{clock(note.arriveAt)}</Row>
        <Row label="타설 완료">{clock(note.completedAt)}</Row>
      </SheetGroup>

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
