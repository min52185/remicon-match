import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * 개발 서버와 빌드가 같은 폴더(.next)를 쓰면, 개발 서버를 켜 둔 채 `npm run build` 를 돌렸을 때
   * 캐시가 깨져 "Cannot find module './331.js'" 같은 오류가 난다. 폴더를 갈라 둔다.
   * `next start` 와 Vercel 도 이 설정을 읽으므로 배포에는 영향이 없다.
   */
  distDir: process.env.NODE_ENV === 'production' ? '.next-build' : '.next',
};

export default nextConfig;
