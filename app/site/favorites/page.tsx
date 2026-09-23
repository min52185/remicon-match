'use client';

/**
 * 현장 — 즐겨찾기 레미콘 (지시서 5장 ★).
 *
 * 현장마다 쓰는 배합은 정해져 있다. "2층 슬래브 25-24-150" 같은 조합을 저장해 두고
 * 다음 타설은 카드 한 번으로 주문서를 채운다. 많이 쓴 순으로 위에 온다.
 */

import Link from 'next/link';
import { useState } from 'react';
import { SiteShell } from '@/components/RoleShells';
import SpecPicker from '@/components/SpecPicker';
import { Empty, MockNotice, Panel, Tag } from '@/components/ui';
import { m3 } from '@/lib/format';
import { DEFAULT_SPEC, cementShort, isKsSpec, specText } from '@/lib/rules';
import { deleteFavorite, favoritesOfSite, saveFavorite } from '@/lib/store';
import { useDb } from '@/lib/store/hooks';
import type { Site, Spec } from '@/lib/types';

export default function FavoritesPage() {
  return (
    <SiteShell
      title="즐겨찾기 레미콘"
      description="자주 쓰는 배합을 저장해 두면 주문서를 한 번에 채울 수 있습니다."
      showClock={false}
    >
      {(site) => <FavoritesBody site={site} />}
    </SiteShell>
  );
}

function FavoritesBody({ site }: { site: Site }) {
  const db = useDb();
  const favorites = favoritesOfSite(db, site.id);

  const [adding, setAdding] = useState(false);
  const [alias, setAlias] = useState('');
  const [spec, setSpec] = useState<Spec>(DEFAULT_SPEC);
  const [volumeM3, setVolumeM3] = useState(60);
  const [pumpRate, setPumpRate] = useState(40);
  const [plantId, setPlantId] = useState('');
  const [note, setNote] = useState('');

  function add() {
    saveFavorite({
      siteId: site.id,
      alias: alias.trim() || specText(spec),
      spec,
      volumeM3,
      pumpRate,
      preferredPlantId: plantId || undefined,
      note: note.trim() || undefined,
    });
    setAdding(false);
    setAlias('');
    setNote('');
    setPlantId('');
  }

  return (
    <>
      <MockNotice />

      {favorites.length === 0 && !adding && (
        <Panel>
          <Empty>
            아직 저장한 배합이 없습니다.
            <br />
            주문을 한 번 넣으면 주문 직후에도 저장할 수 있습니다.
          </Empty>
        </Panel>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        {favorites.map((f) => {
          const plant = db.plants.find((p) => p.id === f.preferredPlantId);
          return (
            <article key={f.id} className="card card-pad">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <strong style={{ fontSize: '1rem' }}>{f.alias}</strong>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: '0.75rem',
                    color: 'var(--color-concrete-mid)',
                  }}
                >
                  {f.useCount}회 사용
                </span>
              </div>

              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.88rem',
                  margin: '0 0 6px',
                }}
              >
                {specText(f.spec)}
              </p>
              <p style={{ fontSize: '0.82rem', color: 'var(--color-concrete-wet)', margin: '0 0 10px' }}>
                {m3(f.volumeM3)} · 펌프 {f.pumpRate}m³/h · {cementShort(f.spec.cement)}
                {plant && ` · 자주 쓰는 공장 ${plant.name}`}
              </p>
              {f.note && (
                <p style={{ fontSize: '0.8rem', color: 'var(--color-concrete-mid)', margin: '0 0 10px' }}>
                  {f.note}
                </p>
              )}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {isKsSpec(f.spec) ? (
                  <Tag tone="ok">KS 표 안</Tag>
                ) : (
                  <Tag tone="warn">표 밖 조합</Tag>
                )}
                <Link
                  href="/site/order"
                  className="btn btn-outline btn-sm"
                  style={{ marginLeft: 'auto' }}
                >
                  이 배합으로 주문
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => deleteFavorite(f.id)}
                >
                  삭제
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {adding ? (
        <Panel title="새 즐겨찾기">
          <label className="field">
            <span className="label">별칭</span>
            <input
              className="input"
              placeholder="예: 2층 슬래브용"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
            />
          </label>

          <SpecPicker spec={spec} onChange={setSpec} />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
              marginTop: 12,
            }}
          >
            <label className="field">
              <span className="label">기본 물량 (m³)</span>
              <input
                type="number"
                className="input"
                min={1}
                value={volumeM3}
                onChange={(e) => setVolumeM3(Math.max(1, Number(e.target.value) || 0))}
              />
            </label>
            <label className="field">
              <span className="label">기본 펌프 속도 (m³/h)</span>
              <input
                type="number"
                className="input"
                min={5}
                step={5}
                value={pumpRate}
                onChange={(e) => setPumpRate(Math.max(5, Number(e.target.value) || 0))}
              />
            </label>
            <label className="field">
              <span className="label">자주 쓰는 공장</span>
              <select className="select" value={plantId} onChange={(e) => setPlantId(e.target.value)}>
                <option value="">지정 안 함</option>
                {db.plants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span className="label">메모</span>
            <input
              className="input"
              placeholder="예: 펌프카 북쪽 배치, 진입은 동측 게이트"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={add}>
              저장
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
              취소
            </button>
          </div>
        </Panel>
      ) : (
        <button type="button" className="btn btn-outline btn-block" onClick={() => setAdding(true)}>
          + 새 즐겨찾기 만들기
        </button>
      )}
    </>
  );
}
