# 레미콘 매칭 플랫폼 — 프로젝트 규칙

## 목적

현장이 모바일로 레미콘을 주문하고, 차량 위치·ETA·지연을 실시간으로 보며,
AI가 여러 공장 배분을 추천해 콜드조인트 없이 연속 타설하게 한다.

## 기술

Next.js(App Router) + TypeScript + Tailwind CSS v4 / Supabase(Auth·RLS·Realtime) / 카카오맵·카카오모빌리티 / 기상청 단기예보 / Vercel

`lib/store` 는 키가 있으면 Supabase, 없으면 브라우저 저장소로 돈다. 조원이 키 없이 코드를 받아도 앱이 실행된다.

## 폴더

```
app/site     현장 화면 (주문·즐겨찾기·AI 배분·배송 추적·타설 모니터·납품서)
app/plant    레미콘사 화면 (출하 현황·주문 관리·배차)
app/driver   기사 화면 (내 배송·GPS 전송)
app/api      서버 — 카카오 길찾기 프록시, 기상청 프록시, AI 배분
lib/rules.ts       시방·KS F 4009 규칙 (숫자는 전부 여기 상수로만)
lib/services       외부 API (route·weather·tracking·clock) — 가짜 구현과 교체 가능
lib/auth.tsx       세션과 내 프로필
lib/store          shared(공통) · local(브라우저) · remote(Supabase) · index(선택)
lib/supabase       클라이언트와 DB↔앱 변환기
lib/ai             배분 최적화·지연 예측·콜드조인트 경고
components         화면 공용 부품 (KakaoMap 등)
supabase/migrations  SQL
docs/prototype-a.html  기존 프로토타입 (참고용, 고치지 않는다)
```

## 규칙

- UI 문구는 한국어, 모바일 우선(폭 360px에서 깨지지 않게)
- 시방 수치(90/120분, 25℃, 차 1대 6m³ 등)는 `lib/rules.ts` 상수로만 쓴다
- 가정치에는 `// [가정]` 주석을 단다
- API 키는 `.env.local`, REST 키는 서버 코드(app/api)에서만
- `SUPABASE_SERVICE_ROLE_KEY` 는 쓰지 않는다 — RLS 를 무시하는 키다
- 새 테이블을 만들면 RLS 를 켜고 정책을 같이 쓴다
- 외부 API 는 `lib/services` 의 함수로만 부른다 (시그니처 유지, 내부만 교체)
- 내 담당 폴더 밖 파일을 바꿀 땐 먼저 알려준다
- 기능을 만들면 테스트도 만들고 `npm test` 를 통과시킨다
- 디자인 토큰은 `app/globals.css` 의 `@theme` 에만 둔다 (색상 하드코딩 금지)

## 디자인

레미go 콘크리트 무드. 종이색 바탕(`--color-paper`), 진회색 글자(`--color-concrete-dark`),
강조는 철근 녹색(`--color-rust`) 하나만. 모서리 반경 3px, 제목은 IBM Plex Sans KR,
숫자·코드는 JetBrains Mono.

## 자주 쓰는 명령

```bash
npm run dev     # http://localhost:3000
npm test        # vitest — 배분 알고리즘·시방 규칙 검증
npm run build   # 배포 전 확인
```
