'use client';

/**
 * 로그인 상태와 내 프로필.
 *
 * Supabase 키가 없으면 '시연 모드'로 떨어진다 — 로그인 없이 아무 역할이나 골라
 * 쓰던 기존 동작 그대로다. 조원이 키 없이 코드를 받아도 앱이 돌아야 하기 때문이다.
 * 키가 있으면 진짜 로그인을 요구하고, 프로필의 역할·소속으로 화면을 가른다.
 *
 * 프로필은 회원가입 때 DB 트리거(handle_new_user)가 자동으로 만든다.
 * 다만 소속 회사는 가입 시점에 못 고른다 — 그때는 아직 로그인 전이라
 * companies 를 읽을 권한이 없기 때문이다. 그래서 가입 직후 '소속 고르기'를 한 번 거친다.
 */

import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSupabase, isSupabaseConfigured } from './supabase/client';
import type { ProfileRow } from './supabase/mappers';
import type { Role } from './types';

export interface Profile {
  id: string;
  name: string;
  role: Role;
  companyId: string | null;
}

export interface Company {
  id: string;
  name: string;
  kind: '건설사' | '레미콘사';
}

interface AuthState {
  /** 키가 없어 로그인 없이 도는 상태 */
  demoMode: boolean;
  loading: boolean;
  user: User | null;
  profile: Profile | null;
  /** 소속 회사를 아직 안 고른 상태 */
  needsCompany: boolean;
  error: string | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: { email: string; password: string; name: string; role: Role }): Promise<void>;
  signOut(): Promise<void>;
  /** 가입 직후 소속 고르기 */
  setCompany(companyId: string): Promise<void>;
  listCompanies(): Promise<Company[]>;
}

const Ctx = createContext<AuthState | null>(null);

/** 시연 모드에서 쓰는 가짜 프로필 — 역할은 화면에서 자유롭게 바꾼다 */
const DEMO_PROFILE: Profile = {
  id: 'demo',
  name: '시연 사용자',
  role: 'site',
  companyId: 'demo',
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const demoMode = !isSupabaseConfigured;

  const [loading, setLoading] = useState(!demoMode);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(demoMode ? DEMO_PROFILE : null);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async (uid: string) => {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error: e } = await sb
      .from('profiles')
      .select('id, name, role, company_id')
      .eq('id', uid)
      .maybeSingle<ProfileRow>();
    if (e) {
      console.warn('[auth] 프로필을 읽지 못했습니다.', e.message);
      return null;
    }
    if (!data) return null;
    return { id: data.id, name: data.name, role: data.role as Role, companyId: data.company_id };
  }, []);

  const apply = useCallback(
    async (session: Session | null) => {
      setUser(session?.user ?? null);
      setProfile(session?.user ? await loadProfile(session.user.id) : null);
      setLoading(false);
    },
    [loadProfile],
  );

  useEffect(() => {
    if (demoMode) return;
    const sb = getSupabase();
    if (!sb) return;

    let alive = true;
    void sb.auth.getSession().then(({ data }) => {
      if (alive) void apply(data.session);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (alive) void apply(session);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [demoMode, apply]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    const sb = getSupabase();
    if (!sb) return;
    const { error: e } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (e) {
      setError(translate(e.message));
      throw e;
    }
  }, []);

  const signUp = useCallback(
    async ({ email, password, name, role }: { email: string; password: string; name: string; role: Role }) => {
      setError(null);
      const sb = getSupabase();
      if (!sb) return;
      // 이름·역할은 metadata 로 넘긴다. DB 트리거가 profiles 로 옮긴다.
      const { error: e } = await sb.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { name: name.trim(), role } },
      });
      if (e) {
        setError(translate(e.message));
        throw e;
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
    setProfile(null);
    setUser(null);
  }, []);

  const setCompany = useCallback(
    async (companyId: string) => {
      const sb = getSupabase();
      if (!sb || !user) return;
      const { error: e } = await sb.from('profiles').update({ company_id: companyId }).eq('id', user.id);
      if (e) {
        setError(translate(e.message));
        throw e;
      }
      setProfile(await loadProfile(user.id));
    },
    [user, loadProfile],
  );

  const listCompanies = useCallback(async (): Promise<Company[]> => {
    const sb = getSupabase();
    if (!sb) return [];
    const { data } = await sb.from('companies').select('id, name, kind').order('name');
    return (data as Company[]) ?? [];
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      demoMode,
      loading,
      user,
      profile,
      needsCompany: !demoMode && !!profile && !profile.companyId,
      error,
      signIn,
      signUp,
      signOut,
      setCompany,
      listCompanies,
    }),
    [demoMode, loading, user, profile, error, signIn, signUp, signOut, setCompany, listCompanies],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth 는 AuthProvider 안에서만 쓸 수 있습니다.');
  return v;
}

/** Supabase 오류 문구를 한국어로 — 조원이 원인을 바로 알 수 있게 */
function translate(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않습니다.';
  if (m.includes('email not confirmed'))
    return '이메일 인증이 필요합니다. Supabase → Authentication → Email 에서 "Confirm email" 을 끄면 바로 로그인됩니다.';
  if (m.includes('user already registered') || m.includes('already been registered'))
    return '이미 가입된 이메일입니다. 로그인으로 넘어가세요.';
  if (m.includes('password should be at least'))
    return '비밀번호가 너무 짧습니다. 6자 이상으로 해주세요.';
  if (m.includes('unable to validate email') || m.includes('invalid email'))
    return '이메일 형식이 올바르지 않습니다.';
  if (m.includes('signups not allowed'))
    return '회원가입이 막혀 있습니다. Supabase → Authentication → Sign In / Providers 에서 Email 가입을 켜세요.';
  return message;
}
