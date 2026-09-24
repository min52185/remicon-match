import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * 빌드 결과물 폴더는 기본값 .next 를 그대로 쓴다.
   * Vercel 의 Next.js 빌더가 .next 를 찾으므로, distDir 을 바꾸면
   * "The Next.js output directory .next was not found" 로 배포가 실패한다.
   *
   * 대신 개발 서버를 켜 둔 채 `npm run build` 를 돌리지 않는다 —
   * 둘이 같은 폴더를 쓰기 때문에 캐시가 깨진다. 빌드 전에 Ctrl+C 로 개발 서버를 끈다.
   * 이미 깨졌다면 .next 폴더를 지우고 다시 켜면 된다.
   */
};

export default nextConfig;
