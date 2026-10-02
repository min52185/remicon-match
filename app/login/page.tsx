'use client';

/**
 * 로그인 · 회원가입 · 소속 고르기.
 *
 * 소속(회사)을 가입 폼에서 못 고르는 이유: 가입 시점에는 아직 로그인 전이라
 * companies 를 읽을 권한이 없다(RLS). 그래서 가입 직후 한 화면을 더 거친다.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth, type Company, type SiteOption } from '@/lib/auth';
import { HOME_BY_ROLE, ROLE_DESC, ROLE_LABEL } from '@/lib/routes';
import type { Role } from '@/lib/types';
import s from './login.module.css';

export default function LoginPage() {
  const { demoMode, loading, profile, needsCompany, needsSite, error, signIn, signUp } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('site');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 이미 로그인돼 있고 소속까지 정해졌으면 역할 홈으로 보낸다
  useEffect(() => {
    if (!loading && profile && !needsCompany && !needsSite) router.replace(HOME_BY_ROLE[profile.role]);
  }, [loading, profile, needsCompany, needsSite, router]);

  if (demoMode) return <DemoNotice />;
  if (loading) return <Shell><p className={s.muted}>불러오는 중…</p></Shell>;
  if (profile && needsCompany) return <ChooseCompany />;
  if (profile && needsSite) return <ChooseSite />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (mode === 'in') {
        await signIn(email, password);
      } else {
        await signUp({ email, password, name, role });
        setNotice('가입됐습니다. 이어서 소속을 골라 주세요.');
      }
    } catch {
      /* 오류 문구는 useAuth 의 error 가 보여 준다 */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className={s.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'in'}
          className={mode === 'in' ? s.tabOn : s.tab}
          onClick={() => setMode('in')}
        >
          로그인
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'up'}
          className={mode === 'up' ? s.tabOn : s.tab}
          onClick={() => setMode('up')}
        >
          회원가입
        </button>
      </div>

      <form onSubmit={submit}>
        {mode === 'up' && (
          <>
            <label className="field">
              <span className="label">이름</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 남경민"
                required
                autoComplete="name"
              />
            </label>

            <div className="field">
              <span className="label">역할</span>
              <div className={s.roles}>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={s.roleCard}
                    aria-pressed={role === r}
                    onClick={() => setRole(r)}
                  >
                    <strong>{ROLE_LABEL[r]}</strong>
                    <span>{ROLE_DESC[r]}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <label className="field">
          <span className="label">이메일</span>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="site@test.com"
            required
            autoComplete="email"
          />
        </label>

        <label className="field">
          <span className="label">비밀번호</span>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="6자 이상"
            required
            minLength={6}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          />
        </label>

        {error && <p className={s.error}>{error}</p>}
        {notice && <p className={s.notice}>{notice}</p>}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '처리 중…' : mode === 'in' ? '로그인' : '가입하고 시작하기'}
        </button>
      </form>

      <p className={s.hint}>
        시연용 계정은 <code>site@test.com</code> · <code>plant@test.com</code> ·{' '}
        <code>driver@test.com</code> 처럼 만들면 구분하기 쉽습니다. 실제로 받는 메일 주소가 아니어도
        됩니다.
      </p>
    </Shell>
  );
}

/* ==========================================================================
 * 소속 고르기 — 가입 직후 한 번
 * ======================================================================== */

function ChooseCompany() {
  const { profile, setCompany, createCompany, listCompanies, signOut, error } = useAuth();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  /** 목록에 없는 회사를 직접 적는 중 */
  const [making, setMaking] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    listCompanies().then(setCompanies);
  }, [listCompanies]);

  // 현장은 건설사, 공장·기사는 레미콘사에 속한다
  const wanted = profile?.role === 'site' ? '건설사' : '레미콘사';
  const options = (companies ?? []).filter((c) => c.kind === wanted);

  return (
    <Shell>
      <h1 className={s.title}>소속을 골라 주세요</h1>
      <p className={s.muted}>
        {profile?.name}님은 <strong>{ROLE_LABEL[profile?.role ?? 'site']}</strong> 계정입니다. 어느{' '}
        {wanted}에 속하는지 고르면 그 회사의 자료만 보이게 됩니다.
      </p>

      {companies === null ? (
        <p className={s.muted}>회사 목록을 불러오는 중…</p>
      ) : making || options.length === 0 ? (
        <>
          {options.length === 0 && (
            <p className={s.muted}>
              등록된 {wanted}가 없습니다. 아래에 회사 이름을 적으면 새로 만듭니다.
            </p>
          )}

          <label className="field">
            <span className="label">{wanted} 이름</span>
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={wanted === '건설사' ? '예: 대진종합건설' : '예: 가온레미콘'}
              autoComplete="organization"
            />
          </label>

          {error && <p className={s.error}>{error}</p>}

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={newName.trim().length < 2 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await createCompany(newName.trim(), wanted);
              } catch {
                /* 메시지는 error 에 담겨 위에 뜬다 */
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '만드는 중…' : `${wanted} 만들고 시작하기`}
          </button>

          {options.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={() => setMaking(false)}
            >
              목록에서 고르기
            </button>
          )}
        </>
      ) : (
        <>
          <label className="field">
            <span className="label">{wanted}</span>
            <select className="select" value={picked} onChange={(e) => setPicked(e.target.value)}>
              <option value="">고르세요</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {error && <p className={s.error}>{error}</p>}

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!picked || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await setCompany(picked);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '저장 중…' : '이 회사로 시작하기'}
          </button>

          <button
            type="button"
            className="btn btn-outline btn-block"
            onClick={() => setMaking(true)}
          >
            목록에 없습니다 — 회사 새로 만들기
          </button>
        </>
      )}

      <button type="button" className="btn btn-ghost btn-block" onClick={() => void signOut()}>
        다른 계정으로 로그인
      </button>
    </Shell>
  );
}

/* ==========================================================================
 * 현장 고르기 — 현장 계정만, 소속을 고른 다음
 *
 * 현장 계정은 현장 하나에 묶인다. 다른 현장의 주문·배송·납품서는 화면에서
 * 숨기는 것이 아니라, DB 권한(0010)이 아예 돌려주지 않는다.
 * ======================================================================== */

function ChooseSite() {
  const { profile, setSite, listMySites, signOut, error } = useAuth();
  const [sites, setSites] = useState<SiteOption[] | null>(null);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listMySites().then(setSites);
  }, [listMySites]);

  return (
    <Shell>
      <h1 className={s.title}>맡으신 현장을 골라 주세요</h1>
      <p className={s.muted}>
        {profile?.name}님은 고른 <strong>현장 하나</strong>만 보게 됩니다. 다른 현장의 주문·배송·
        납품서는 보이지 않습니다. 나중에 <strong>현장</strong> 화면에서 옮길 수 있습니다.
      </p>

      {sites === null ? (
        <p className={s.muted}>현장 목록을 불러오는 중…</p>
      ) : sites.length === 0 ? (
        <p className={s.muted}>
          우리 회사에 등록된 현장이 아직 없습니다. 먼저 현장을 하나 만들어야 시작할 수 있습니다.
        </p>
      ) : (
        <>
          <label className="field">
            <span className="label">현장</span>
            <select className="select" value={picked} onChange={(e) => setPicked(e.target.value)}>
              <option value="">고르세요</option>
              {sites.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {x.address}
                </option>
              ))}
            </select>
          </label>

          {error && <p className={s.error}>{error}</p>}

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!picked || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await setSite(picked);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '저장 중…' : '이 현장으로 시작하기'}
          </button>
        </>
      )}

      <Link href="/site/sites" className="btn btn-outline btn-block">
        현장 새로 등록하기
      </Link>

      <button type="button" className="btn btn-ghost btn-block" onClick={() => void signOut()}>
        다른 계정으로 로그인
      </button>
    </Shell>
  );
}

/* ==========================================================================
 * 키가 없을 때
 * ======================================================================== */

function DemoNotice() {
  return (
    <Shell>
      <h1 className={s.title}>로그인이 필요 없습니다</h1>
      <p className={s.muted}>
        Supabase 키가 설정돼 있지 않아 <strong>시연 모드</strong>로 동작합니다. 데이터는 이
        브라우저에만 저장되고, 상단에서 역할을 자유롭게 바꿀 수 있습니다.
      </p>
      <p className={s.muted}>
        여러 기기에서 같은 자료를 보려면 <code>.env.local</code> 에 Supabase 키를 넣으세요. 자세한
        점검은 <Link href="/setup">설정 점검</Link> 에 있습니다.
      </p>
      <Link href="/site/order" className="btn btn-primary btn-block">
        현장 화면으로 가기
      </Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className={s.page}>
      <div className={s.card}>
        <Link href="/" className={s.logo}>
          레미<span className={s.logoDot}>go</span>
        </Link>
        {children}
      </div>
    </main>
  );
}
