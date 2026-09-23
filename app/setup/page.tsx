'use client';

/**
 * 설정 점검 — 키를 넣은 뒤 "정말 연결됐는지"를 눌러서 확인하는 화면.
 *
 * 키를 .env.local 에 넣어도 개발 서버를 다시 켜지 않으면 반영되지 않고,
 * 카카오맵은 키만으로는 안 뜨고 활성화·도메인 등록이 더 필요하다.
 * 그 두 가지 때문에 조원들이 "왜 안 되지"에 시간을 쓰게 되므로 진단 화면을 따로 둔다.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Panel, Tag } from '@/components/ui';
import { SEED_PLANTS, SEED_SITES } from '@/lib/store/seed';
import type { RouteResult } from '@/lib/services/route';
import type { Temperature } from '@/lib/services/weather';

interface KeyCheck {
  set: boolean;
  length: number;
  suspicious: boolean;
}

interface Health {
  kakaoRest: KeyCheck;
  kma: KeyCheck;
  supabaseUrl: KeyCheck;
  supabaseAnon: KeyCheck;
  supabaseService: KeyCheck;
}

type SdkState = 'checking' | 'nokey' | 'ok' | 'failed';

export default function SetupPage() {
  const jsKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;

  const [health, setHealth] = useState<Health | null>(null);
  const [sdk, setSdk] = useState<SdkState>(jsKey ? 'checking' : 'nokey');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [temp, setTemp] = useState<Temperature | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  // 카카오맵 SDK 가 실제로 뜨는지 — 키만으로는 부족하고 활성화·도메인 등록이 있어야 한다
  useEffect(() => {
    if (!jsKey) return;
    let done = false;

    const finish = (s: SdkState) => {
      if (!done) {
        done = true;
        setSdk(s);
      }
    };

    if (window.kakao?.maps) {
      window.kakao.maps.load(() => finish('ok'));
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${jsKey}&autoload=false`;
    script.onload = () => window.kakao?.maps.load(() => finish('ok'));
    script.onerror = () => finish('failed');
    document.head.appendChild(script);

    const timer = window.setTimeout(() => finish('failed'), 8000);
    return () => window.clearTimeout(timer);
  }, [jsKey]);

  const testRoute = useCallback(async () => {
    setBusy('route');
    setRoute(null);
    try {
      const res = await fetch('/api/route', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: { lat: SEED_PLANTS[0].lat, lng: SEED_PLANTS[0].lng },
          to: { lat: SEED_SITES[0].lat, lng: SEED_SITES[0].lng },
          departAt: Date.now(),
        }),
      });
      setRoute(await res.json());
    } finally {
      setBusy(null);
    }
  }, []);

  const testWeather = useCallback(async () => {
    setBusy('weather');
    setTemp(null);
    try {
      const p = new URLSearchParams({
        lat: String(SEED_SITES[0].lat),
        lng: String(SEED_SITES[0].lng),
        at: String(Date.now()),
      });
      const res = await fetch(`/api/weather?${p}`);
      setTemp(await res.json());
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <main className="wrap" style={{ paddingBlock: 28, maxWidth: 760 }}>
      <p className="eyebrow" style={{ marginBottom: 10 }}>SETUP CHECK</p>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 6 }}>설정 점검</h1>
      <p style={{ color: 'var(--color-concrete-wet)', fontSize: '0.9rem', marginTop: 0 }}>
        키를 <code style={{ fontFamily: 'var(--font-mono)' }}>.env.local</code> 에 넣은 뒤 이
        화면에서 정말 연결됐는지 확인합니다. 키를 고쳤으면{' '}
        <strong>개발 서버를 껐다 켜야</strong> 반영됩니다 (Ctrl+C 후 <code>npm run dev</code>).
      </p>

      {/* 1. 카카오맵 */}
      <Panel
        title="1. 카카오맵 (브라우저)"
        aside={
          sdk === 'ok' ? (
            <Tag tone="ok">연결됨</Tag>
          ) : sdk === 'checking' ? (
            <Tag tone="muted">확인 중…</Tag>
          ) : sdk === 'nokey' ? (
            <Tag tone="warn">키 없음</Tag>
          ) : (
            <Tag tone="bad">실패</Tag>
          )
        }
      >
        <KeyRow label="NEXT_PUBLIC_KAKAO_JS_KEY" check={{ set: !!jsKey, length: jsKey?.length ?? 0, suspicious: false }} />

        {sdk === 'ok' && (
          <p style={{ fontSize: '0.88rem', margin: '12px 0 0' }}>
            지도 SDK가 정상적으로 떴습니다. 앱의 모든 지도가 실제 카카오맵으로 나옵니다.
          </p>
        )}

        {sdk === 'nokey' && (
          <Guide title="할 일 — 지시서 0-10">
            <ol style={listStyle}>
              <li>
                <a href="https://developers.kakao.com" target="_blank" rel="noreferrer">
                  developers.kakao.com
                </a>{' '}
                로그인 → 내 애플리케이션 → 애플리케이션 추가하기 (앱은 <strong>한 개만</strong>{' '}
                만듭니다. 무료 제공량이 첫 앱에만 주어집니다)
              </li>
              <li>앱 설정 → 플랫폼 키 → <strong>JavaScript 키</strong> 복사</li>
              <li>
                <code>.env.local</code> 의 <code>NEXT_PUBLIC_KAKAO_JS_KEY=</code> 뒤에 붙여넣기
              </li>
              <li>개발 서버 재시작</li>
            </ol>
          </Guide>
        )}

        {sdk === 'failed' && (
          <Guide title="키는 있는데 지도가 안 뜹니다 — 두 가지를 확인하세요">
            <ol style={listStyle}>
              <li>
                <strong>제품 설정 → 카카오맵 → 활성화 설정 ON.</strong> 이걸 안 켜면 키가 맞아도
                지도가 뜨지 않습니다.
              </li>
              <li>
                <strong>앱 설정 → 플랫폼 키 → JavaScript SDK 도메인</strong>에{' '}
                <code>http://localhost:3000</code> 과 Vercel 주소를 둘 다 등록.
              </li>
            </ol>
            <p style={{ margin: '8px 0 0' }}>
              둘 다 했는데도 안 되면 브라우저 개발자도구 Console 의 오류 메시지를 그대로 붙여넣어
              물어보세요.
            </p>
          </Guide>
        )}
      </Panel>

      {/* 2. 카카오모빌리티 */}
      <Panel
        title="2. 카카오모빌리티 길찾기 (서버)"
        aside={
          !health ? (
            <Tag tone="muted">확인 중…</Tag>
          ) : health.kakaoRest.set ? (
            <Tag tone="ok">키 있음</Tag>
          ) : (
            <Tag tone="warn">키 없음</Tag>
          )
        }
      >
        {health && <KeyRow label="KAKAO_REST_API_KEY" check={health.kakaoRest} />}

        <p style={{ fontSize: '0.86rem', color: 'var(--color-concrete-wet)', margin: '10px 0' }}>
          REST 키는 브라우저에 노출되면 안 되므로 서버(<code>app/api/route</code>)에서만 씁니다.
          아래 버튼은 가온레미콘 동탄공장 → 서천동 현장 구간을 실제로 한 번 조회합니다.
        </p>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={testRoute}
          disabled={busy === 'route'}
        >
          {busy === 'route' ? '조회 중…' : '길찾기 한 번 호출해 보기'}
        </button>

        {route && (
          <div style={resultBox}>
            <strong style={{ fontFamily: 'var(--font-mono)' }}>
              {route.minutes}분 · {route.distanceKm}km
            </strong>{' '}
            {route.source === 'kakao' ? (
              <Tag tone="ok">카카오 실시간 교통</Tag>
            ) : (
              <Tag tone="warn">직선거리 근사 [가정]</Tag>
            )}
            {route.delayReason && (
              <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'var(--color-warn)' }}>
                {route.delayReason}
              </p>
            )}
            <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: 'var(--color-concrete-mid)' }}>
              경로 꼭짓점 {route.path.length}개
            </p>
          </div>
        )}

        {health && !health.kakaoRest.set && (
          <Guide title="할 일">
            같은 카카오 앱의 <strong>REST API 키</strong>를 <code>KAKAO_REST_API_KEY=</code> 에
            넣습니다. 길찾기는 카카오모빌리티라 별도 신청이 필요할 수 있습니다 — 하루 무료 제공량은
            자동차 길찾기 10,000건, 미래 운행 정보 5,000건입니다.
          </Guide>
        )}
      </Panel>

      {/* 3. 기상청 */}
      <Panel
        title="3. 기상청 단기예보 (서버)"
        aside={
          !health ? (
            <Tag tone="muted">확인 중…</Tag>
          ) : health.kma.set ? (
            <Tag tone="ok">키 있음</Tag>
          ) : (
            <Tag tone="warn">키 없음</Tag>
          )
        }
      >
        {health && <KeyRow label="KMA_SERVICE_KEY" check={health.kma} />}

        <p style={{ fontSize: '0.86rem', color: 'var(--color-concrete-wet)', margin: '10px 0' }}>
          외기온도로 비비기~타설 제한시간(25℃ 이상 90분 / 미만 120분)을 자동으로 고릅니다.
        </p>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={testWeather}
          disabled={busy === 'weather'}
        >
          {busy === 'weather' ? '조회 중…' : '외기온도 조회해 보기'}
        </button>

        {temp && (
          <div style={resultBox}>
            <strong style={{ fontFamily: 'var(--font-mono)' }}>{temp.tempC}℃</strong>{' '}
            {temp.source === 'kma' ? (
              <Tag tone="ok">기상청 단기예보</Tag>
            ) : (
              <Tag tone="warn">평년값 근사 [가정]</Tag>
            )}
            <p style={{ margin: '6px 0 0', fontSize: '0.84rem' }}>
              제한시간 {temp.tempC >= 25 ? '90분 (25℃ 이상)' : '120분 (25℃ 미만)'}
            </p>
          </div>
        )}

        {health && !health.kma.set && (
          <Guide title="할 일 — 지시서 0-11">
            <a href="https://www.data.go.kr" target="_blank" rel="noreferrer">
              공공데이터포털
            </a>{' '}
            → &ldquo;기상청 단기예보 조회서비스&rdquo; 검색 → 활용신청(자동승인) → 마이페이지에서{' '}
            <strong>일반 인증키(Decoding)</strong> 복사 → <code>KMA_SERVICE_KEY=</code> 에 넣기.
            발급 직후에는 호출이 실패할 수 있으니 몇 시간 뒤 다시 시도하세요.
          </Guide>
        )}
      </Panel>

      {/* 4. Supabase */}
      <Panel
        title="4. Supabase (4단계에서)"
        aside={
          health?.supabaseUrl.set ? <Tag tone="ok">키 있음</Tag> : <Tag tone="muted">아직 안 씀</Tag>
        }
      >
        {health && (
          <>
            <KeyRow label="NEXT_PUBLIC_SUPABASE_URL" check={health.supabaseUrl} />
            <KeyRow label="NEXT_PUBLIC_SUPABASE_ANON_KEY" check={health.supabaseAnon} />
            <KeyRow label="SUPABASE_SERVICE_ROLE_KEY" check={health.supabaseService} />
          </>
        )}
        <p style={{ fontSize: '0.86rem', color: 'var(--color-concrete-wet)', margin: '10px 0 0' }}>
          지금은 브라우저 저장소로 돕니다. 다른 휴대폰끼리 데이터를 공유하려면 Supabase 가
          필요합니다. 테이블 12개와 RLS 정책 SQL 은{' '}
          <code>supabase/migrations/0001_init.sql</code> 에 이미 있습니다.
        </p>
      </Panel>

      <p style={{ fontSize: '0.85rem', marginTop: 24 }}>
        <Link href="/" style={{ color: 'var(--color-rust)' }}>
          ← 첫 화면으로
        </Link>
      </p>
    </main>
  );
}

function KeyRow({ label, check }: { label: string; check: KeyCheck }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 0',
        borderBottom: '1px solid var(--color-line)',
        fontSize: '0.84rem',
      }}
    >
      <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', flex: 1 }}>{label}</code>
      {check.suspicious && <Tag tone="warn">따옴표·공백 확인</Tag>}
      {check.set ? (
        <Tag tone="ok">{check.length}자</Tag>
      ) : (
        <Tag tone="muted">비어 있음</Tag>
      )}
    </div>
  );
}

function Guide({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 12,
        paddingLeft: 12,
        borderLeft: '2px solid var(--color-rust)',
        fontSize: '0.86rem',
        color: 'var(--color-concrete-wet)',
        lineHeight: 1.6,
      }}
    >
      <strong style={{ display: 'block', color: 'var(--color-concrete-dark)', marginBottom: 4 }}>
        {title}
      </strong>
      {children}
    </div>
  );
}

const listStyle: React.CSSProperties = { margin: 0, paddingLeft: 18 };

const resultBox: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  background: 'var(--color-paper)',
  border: '1px solid var(--color-line)',
  borderRadius: 'var(--radius-sharp)',
};
