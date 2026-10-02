'use client';

/**
 * 현장 — 내 현장 관리.
 *
 * 이 서비스를 쓰려면 먼저 현장이 있어야 한다. 시연 데이터의 현장 3곳은
 * 발표용이고, 실제로 쓰는 회사는 자기 현장을 직접 넣어야 한다.
 *
 * 위치가 이 화면의 핵심이다. 이동시간·AI 배분·콜드조인트 판정이 전부 이 좌표
 * 하나에서 나온다. 몇백 미터만 틀려도 배분이 어긋나므로, 찍은 자리를 지도에서
 * 눈으로 확인하게 한다.
 */

import { useState, useRef } from 'react';
import LocationPicker, { type PickedLocation } from '@/components/LocationPicker';
import { SiteShell } from '@/components/RoleShells';
import { Alert, Empty, MockNotice, Panel, Row, Tag } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { failure } from '@/lib/format';
import { createSite } from '@/lib/store';
import { useDb, useMounted } from '@/lib/store/hooks';
import type { Site } from '@/lib/types';

export default function SitesPage() {
  return (
    <SiteShell
      title="내 현장"
      description="타설할 현장을 등록합니다. 위치로 이동시간과 배분을 계산합니다."
      showClock={false}
      // 현장이 하나도 없으면 여기서 첫 현장을 만든다
      empty={() => <NewSiteForm onDone={() => window.location.reload()} first />}
    >
      {(site) => <SitesBody current={site} />}
    </SiteShell>
  );
}

function SitesBody({ current }: { current: Site }) {
  const db = useDb();
  const mounted = useMounted();
  const { demoMode, profile } = useAuth();
  const [adding, setAdding] = useState(false);

  const mine = demoMode
    ? db.sites
    : db.sites.filter((s) => !s.companyId || s.companyId === profile?.companyId);

  if (!mounted) return <Empty>불러오는 중…</Empty>;

  return (
    <>
      <MockNotice />

      <Panel title={`등록된 현장 ${mine.length}곳`}>
        {mine.length === 0 ? (
          <Empty>아직 등록한 현장이 없습니다. 아래에서 추가하세요.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {mine.map((s) => (
              <article
                key={s.id}
                className="card card-pad"
                style={{
                  padding: 12,
                  borderColor: s.id === current.id ? 'var(--color-rust)' : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: '0.94rem' }}>{s.name}</strong>
                  {s.id === current.id && (
                    <span style={{ marginLeft: 'auto' }}>
                      <Tag tone="accent">지금 보는 현장</Tag>
                    </span>
                  )}
                </div>
                <Row label="주소">{s.address || '주소 없음 (지도에서 지정)'}</Row>
                <Row label="좌표">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                    {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                  </span>
                </Row>
                {s.accessNote && <Row label="진입 메모">{s.accessNote}</Row>}
                {!demoMode && s.id !== current.id && <MoveHere site={s} />}
              </article>
            ))}
          </div>
        )}

        {!adding && (
          <button
            type="button"
            className="btn btn-primary btn-block"
            style={{ marginTop: 14 }}
            onClick={() => setAdding(true)}
          >
            현장 추가
          </button>
        )}
      </Panel>

      {adding && <NewSiteForm onDone={() => setAdding(false)} />}
    </>
  );
}

/* ==========================================================================
 * 현장 옮기기
 *
 * 한 번 더 묻는다. 옮기면 이전 현장의 주문·배송·납품서가 그 자리에서 사라진다.
 * 화면에서 숨기는 것이 아니라 DB 권한(0010)이 내 현장만 돌려주기 때문이다.
 * ======================================================================== */

function MoveHere({ site }: { site: Site }) {
  const { setSite } = useAuth();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  if (!asking) {
    return (
      <button
        type="button"
        className="btn btn-outline btn-sm btn-block"
        style={{ marginTop: 10 }}
        onClick={() => setAsking(true)}
      >
        이 현장으로 옮기기
      </button>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <Alert tone="warn" title={`${site.name} 으로 옮길까요?`}>
        옮기면 지금 현장의 주문·배송·납품서는 더 이상 보이지 않습니다. 자료가 지워지는 것은
        아니고, 그 현장을 맡은 계정에게만 보입니다.
      </Alert>
      {error && (
        <p style={{ color: 'var(--color-bad)', fontSize: '0.84rem', margin: '8px 0 0' }}>{error}</p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ flex: 1 }}
          disabled={busy}
          onClick={async () => {
            if (busyRef.current) return;
            busyRef.current = true;
            setBusy(true);
            setError(null);
            try {
              await setSite(site.id);
              window.location.reload();
            } catch (e) {
              setError(failure(e, '현장을 옮기지 못했습니다.'));
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          }}
        >
          {busy ? '옮기는 중…' : '옮기기'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)}>
          그대로 두기
        </button>
      </div>
    </div>
  );
}

/* ==========================================================================
 * 현장 등록
 * ======================================================================== */

function NewSiteForm({ onDone, first }: { onDone: () => void; first?: boolean }) {
  const { demoMode, profile, setSite } = useAuth();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [where, setWhere] = useState<PickedLocation | null>(null);
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  // 같은 프레임의 두 번째 클릭을 막는다 — setState 는 다음 렌더에야 버튼을 잠근다
  const busyRef = useRef(false);

  const [error, setError] = useState<string | null>(null);

  // 검색으로 고르면 주소가 따라오고, 지도에서 찍었으면 직접 적는다
  const effectiveAddress = address || where?.address || '';

  const problem =
    name.trim().length < 2
      ? '현장 이름을 두 글자 이상 적어 주세요'
      : !where
        ? '지도에서 위치를 골라 주세요'
        : effectiveAddress.trim().length < 2
          ? '주소를 적어 주세요 — 기사에게 그대로 보입니다'
          : null;

  async function save() {
    if (busyRef.current || problem || !where) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const id = await createSite({
        name: name.trim(),
        address: effectiveAddress.trim(),
        lat: where.lat,
        lng: where.lng,
        accessNote: note.trim() || undefined,
      });
      // 맡은 현장이 아직 없으면 방금 만든 곳을 맡는다. 이미 있으면 건드리지 않는다 —
      // 현장을 옮기는 것은 자료가 통째로 바뀌는 일이라 사람이 눌러야 한다.
      if (!demoMode && !profile?.siteId) await setSite(id);
      onDone();
    } catch (e) {
      setError(failure(e, '현장을 등록하지 못했습니다.'));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Panel
      title={first ? '첫 현장 등록' : '현장 추가'}
      style={{ borderWidth: 2, borderColor: 'var(--color-rust)' }}
    >
      {first && (
        <p style={{ fontSize: '0.88rem', margin: '0 0 14px', lineHeight: 1.65 }}>
          아직 등록된 현장이 없습니다. 먼저 현장을 만들어야 주문·배분·추적을 쓸 수 있습니다.
        </p>
      )}
      {!demoMode && !profile?.companyId && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="bad" title="소속 회사가 없습니다">
            현장은 회사에 속합니다. 로그아웃 후 다시 로그인하면서 회사를 골라 주세요.
          </Alert>
        </div>
      )}

      <label className="field">
        <span className="label">현장 이름</span>
        <input
          className="input"
          value={name}
          maxLength={60}
          placeholder="예) 서천동 근린생활시설 신축현장"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <LocationPicker
        label="현장 위치"
        value={where}
        onChange={(at) => {
          setWhere(at);
          // 검색으로 고른 경우에만 주소를 덮어쓴다 (지도 클릭은 주소가 빈 값이다)
          if (at.address) setAddress(at.address);
        }}
      />

      <label className="field">
        <span className="label">주소</span>
        <input
          className="input"
          value={effectiveAddress}
          maxLength={120}
          placeholder="지도에서 찍었으면 직접 적어 주세요"
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="label">진입 메모 (선택)</span>
        <textarea
          className="input"
          rows={2}
          value={note}
          maxLength={200}
          placeholder="예) 동측 가설게이트로 진입. 펌프카 북쪽 배치."
          style={{ resize: 'vertical' }}
          onChange={(e) => setNote(e.target.value)}
        />
        <span style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)' }}>
          기사 화면에 그대로 뜹니다. 게이트 위치·진입로 경사처럼 처음 오는 기사가 헤매는 것을
          적어 두세요.
        </span>
      </label>

      {error && (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-bad)', margin: '0 0 8px' }}>{error}</p>
      )}
      {problem && !error && (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-concrete-mid)', margin: '0 0 8px' }}>
          {problem}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-outline"
          style={{ flex: 'none' }}
          onClick={onDone}
          disabled={saving}
        >
          취소
        </button>
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={!!problem || saving}
          onClick={() => void save()}
        >
          {saving ? '등록 중…' : '현장 등록'}
        </button>
      </div>
    </Panel>
  );
}
