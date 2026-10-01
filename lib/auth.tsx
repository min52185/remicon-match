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
  phone: string | null;
  /** 현장 계정이 맡은 현장 하나. 공장·기사 계정은 null 이다 */
  siteId: string | null;
  /** 기사 얼굴 사진의 저장 경로. 사진 자체는 Storage 에 있다. */
  photoPath: string | null;
}

export interface Company {
  id: string;
  name: string;
  kind: '건설사' | '레미콘사';
}

/** 현장 고르기 화면에 뜨는 한 줄 */
export interface SiteOption {
  id: string;
  name: string;
  address: string;
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
  /**
   * 소속을 고른 뒤 아직 현장을 안 고른 현장 계정.
   * 현장 계정은 현장 하나에 묶인다 — 남의 현장 자료를 볼 이유가 없다.
   */
  needsSite: boolean;
  /** 내가 맡을 현장 정하기 (가입할 때, 그리고 나중에 옮길 때) */
  setSite(siteId: string): Promise<void>;
  /** 고를 수 있는 현장 — 내 건설사의 현장만 */
  listMySites(): Promise<SiteOption[]>;
  /**
   * 목록에 없는 회사를 직접 만든다 (가입할 때).
   * 만든 회사를 그대로 내 소속으로 잡고 id 를 돌려준다.
   */
  createCompany(name: string, kind: Company['kind']): Promise<string>;
  /** 내 프로필 고치기 — 기사 연락처·얼굴 사진 */
  updateProfile(patch: Partial<Pick<Profile, 'name' | 'phone' | 'photoPath'>>): Promise<void>;
  listCompanies(): Promise<Company[]>;
}

const Ctx = createContext<AuthState | null>(null);

/** 시연 모드에서 쓰는 가짜 프로필 — 역할은 화면에서 자유롭게 바꾼다 */
const DEMO_PROFILE: Profile = {
  id: 'demo',
  name: '시연 사용자',
  role: 'site',
  companyId: 'demo',
  siteId: null,
  phone: null,
  photoPath: null,
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
      .select('id, name, role, company_id, site_id, phone, photo_path')
      .eq('id', uid)
      .maybeSingle<ProfileRow>();
    if (e) {
      console.warn('[auth] 프로필을 읽지 못했습니다.', e.message);
      return null;
    }
    if (!data) return null;
    return {
      id: data.id,
      name: data.name,
      role: data.role as Role,
      companyId: data.company_id,
      siteId: data.site_id ?? null,
      phone: data.phone ?? null,
      photoPath: data.photo_path ?? null,
    };
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

  /**
   * 내가 맡을 현장을 정한다.
   *
   * 옮기면 이전 현장의 주문·배송·납품서는 그 즉시 안 보인다. 화면에서 숨기는 것이
   * 아니라 DB 권한(0010)이 profiles.site_id 로 판단하기 때문이다.
   */
  const setSite = useCallback(
    async (siteId: string) => {
      const sb = getSupabase();
      if (!sb || !user) return;
      const { error: e } = await sb.from('profiles').update({ site_id: siteId }).eq('id', user.id);
      if (e) {
        setError(translate(e.message));
        throw e;
      }
      setProfile(await loadProfile(user.id));
    },
    [user, loadProfile],
  );

  /**
   * 고를 수 있는 현장.
   * 정책(0010)이 "현장 역할이면 내 건설사의 현장"까지만 돌려주므로,
   * 여기서 회사를 따로 거르지 않아도 남의 회사 현장은 오지 않는다.
   */
  const listMySites = useCallback(async (): Promise<SiteOption[]> => {
    const sb = getSupabase();
    if (!sb) return [];
    const { data } = await sb.from('sites').select('id, name, address').order('name');
    return (data as SiteOption[]) ?? [];
  }, []);

  /**
   * 내 프로필 고치기.
   * 시연 모드에는 DB 가 없으므로 화면 상태만 바꾼다 — 사진은 브라우저에 남아 있다.
   */
  const updateProfile = useCallback(
    async (patch: Partial<Pick<Profile, 'name' | 'phone' | 'photoPath'>>) => {
      if (demoMode) {
        setProfile((p) => (p ? { ...p, ...patch } : p));
        return;
      }
      const sb = getSupabase();
      if (!sb || !user) return;

      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.phone !== undefined) row.phone = patch.phone || null;
      if (patch.photoPath !== undefined) row.photo_path = patch.photoPath;

      const { error: e } = await sb.from('profiles').update(row).eq('id', user.id);
      if (e) {
        setError(translate(e.message));
        throw e;
      }
      setProfile(await loadProfile(user.id));
    },
    [demoMode, user, loadProfile],
  );

  /**
   * 목록에 없는 회사를 만든다.
   *
   * 만들고 바로 내 소속으로 잡는다 — 만들어 놓고 다시 고르게 하면 그 사이에
   * 다른 회사를 고를 수 있고, 주인 없는 회사 줄만 남는다.
   * 이름이 겹치면 DB 가 막는다(0011 의 유일 인덱스). 그때는 이미 있는 회사이니
   * 목록에서 고르라고 안내한다.
   */
  const createCompany = useCallback(
    async (name: string, kind: Company['kind']): Promise<string> => {
      const sb = getSupabase();
      if (!sb || !user) throw new Error('로그인이 필요합니다.');

      const { data, error: e } = await sb
        .from('companies')
        .insert({ name: name.trim(), kind })
        .select('id')
        .single<{ id: string }>();

      if (e) {
        const msg = e.code === '23505' ? '같은 이름의 회사가 이미 있습니다. 목록에서 고르세요.' : translate(e.message);
        setError(msg);
        throw new Error(msg);
      }

      await setCompany(data.id);
      return data.id;
    },
    [user, setCompany],
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
      // 소속을 고른 다음 단계다. 공장·기사는 현장에 묶이지 않는다
      needsSite:
        !demoMode && !!profile && profile.role === 'site' && !!profile.companyId && !profile.siteId,
      error,
      signIn,
      signUp,
      signOut,
      setCompany,
      setSite,
      listMySites,
      createCompany,
      updateProfile,
      listCompanies,
    }),
    [
      demoMode,
      loading,
      user,
      profile,
      error,
      signIn,
      signUp,
      signOut,
      setCompany,
      setSite,
      listMySites,
      createCompany,
      updateProfile,
      listCompanies,
    ],
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
