/**
 * 시연 모드 개발 서버 — Supabase 키를 뺀 채로 `next dev` 를 띄운다.
 *
 * 쓰는 곳
 *  · 조원이 아직 키를 못 받았을 때. 로그인 없이 화면을 다 볼 수 있다.
 *  · 화면만 고쳤을 때. 로그인·RLS 를 거치지 않으니 확인이 빠르다.
 *
 * .env.local 은 건드리지 않는다. 이 프로세스의 환경변수에서만 지운다.
 * 키가 없으면 store/index.ts 가 local(브라우저 저장소) 백엔드를 고르고,
 * RoleShells 의 useGate() 가 demoMode 로 로그인 검사를 건너뛴다.
 */

import { spawn } from 'node:child_process';

const DROP = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

const env = { ...process.env };
for (const k of DROP) delete env[k];

// .env.local 을 다시 읽어 되살리지 않도록 빈 값으로 덮어 둔다
for (const k of DROP) env[k] = '';

const port = process.env.PORT ?? '3001';

console.log(`시연 모드 (Supabase 없이) — http://localhost:${port}`);

const child = spawn('npx', ['next', 'dev', '--port', port], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 0));
