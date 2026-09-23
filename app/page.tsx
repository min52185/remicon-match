import Link from 'next/link';
import s from './landing.module.css';

const PROCESS = [
  {
    index: '01 · 주문',
    title: '사양을 고르고 한 번에',
    body: 'KS F 4009 표에서 종류·골재·강도·슬럼프를 고르면 만들 수 있는 공장만 지도에 남습니다. 현장마다 자주 쓰는 배합은 즐겨찾기에 저장해 한 번에 불러옵니다.',
  },
  {
    index: '02 · 배분',
    title: '여러 공장을 AI가 나눕니다',
    body: '300m³를 한 공장이 다 대지 못할 때, 거리·이동시간·시간당 출하 능력을 함께 풀어 공장별 대수와 출하 시각표를 냅니다. 가까운 곳부터 채우면 중간에 끊깁니다.',
  },
  { media: '/assets/img/process-truck.png', alt: '현장에 도착한 레미콘 믹서 트럭' },
  { media: '/assets/img/process-cure.png', alt: '물이 고인 원형 콘크리트 표면, 양생 중인 모습' },
  {
    index: '03 · 추적',
    title: '지금 어디까지 왔는지',
    body: '기사 휴대폰 GPS로 차량 위치를 지도에 띄우고, 실시간 교통을 반영해 도착 시각을 다시 계산합니다. 처음 예상보다 몇 분 늦는지, 어느 도로가 막히는지까지 보여 줍니다.',
  },
  {
    index: '04 · 연속 타설',
    title: '끊기기 전에 알립니다',
    body: '지금 타설 중인 차가 끝나는 시각과 다음 차 도착 예상 사이의 공백을 계산합니다. 이어치기 허용 시간간격에 가까워지면 경고하고, 무엇을 해야 하는지 같이 내놓습니다.',
  },
];

const WHY = [
  {
    tag: '콜드조인트',
    title: '끊기지 않는 타설',
    body: '레미콘이 제때 오지 않아 생기는 콜드조인트는 구조체 품질을 직접 떨어뜨립니다. 공백을 미리 계산해, 굳기 전에 손을 쓸 수 있게 합니다.',
  },
  {
    tag: '소통 부담',
    title: '전화 대신, 화면으로',
    body: '여러 공장에 일일이 전화해 물량을 묻고 조율하던 시간을 줄입니다. 조건을 넣으면 주문 가능한 공장만 남고, 수락 여부가 바로 화면에 뜹니다.',
  },
  {
    tag: '입력 부담',
    title: '두 번째 주문부터는 한 번에',
    body: '현장마다 쓰는 배합은 정해져 있습니다. “2층 슬래브 25-24-150”을 저장해 두면 다음 타설은 카드 한 번으로 주문서가 채워집니다.',
  },
];

const ROLES = [
  {
    href: '/site',
    name: '현장',
    desc: '주문 · 즐겨찾기 · AI 배분 · 배송 추적 · 타설 모니터 · 납품서',
  },
  { href: '/plant', name: '레미콘사', desc: '출하 현황 입력 · 주문 수락 · 배차와 출하 지시' },
  { href: '/driver', name: '기사', desc: '배송 받기 · 운행 시작(GPS 전송) · 도착 · 하역 완료' },
];

export default function LandingPage() {
  return (
    <>
      <header className={s.header}>
        <div className={`wrap ${s.headerInner}`}>
          <Link href="/" className={s.logo}>
            레미<span className={s.logoDot}>go</span>
          </Link>
          <nav className={s.nav} aria-label="주요 메뉴">
            <a href="#process">소개</a>
            <Link href="/site/order">주문</Link>
            <Link href="/site/tracking">배송 추적</Link>
            <Link href="/site/allocate">AI 배분</Link>
            <Link href="/plant">레미콘사</Link>
          </nav>
          <Link href="#role" className="btn btn-outline btn-sm">
            시작하기
          </Link>
        </div>
      </header>

      <main>
        {/* 1. 히어로 */}
        <section className={s.hero}>
          <div className={s.heroMedia}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/img/hero-pour.png" alt="레미콘 슈트에서 콘크리트가 쏟아지는 모습" />
            <div className={s.heroScrim} />
          </div>
          <div className={`wrap ${s.heroContent}`}>
            <p className={s.heroEyebrow}>REAL-TIME REMICON MATCHING</p>
            <h1>아직, 굳지 않았습니다.</h1>
            <p className={s.heroSub}>
              공사장과 레미콘 공장을 잇는 실시간 매칭·배송 관리.
              <br />
              여러 공장을 AI가 나눠, 타설이 중간에 끊기지 않게 합니다.
            </p>
            <div className={s.heroActions}>
              <Link href="/site/order" className="btn btn-primary">
                레미콘 주문하기
              </Link>
              <Link href="/site/tracking" className={`btn btn-outline ${s.heroOutline}`}>
                배송 상태 보기
              </Link>
            </div>
            <ul className={s.heroMeta}>
              <li>
                <span className="num">90분</span>비비기~타설 제한 (외기 25℃ 이상)
              </li>
              <li>
                <span className="num">6분</span>300m³·펌프 60m³/h 의 도착 간격
              </li>
              <li>
                <span className="num">7곳</span>한 번에 배분할 수 있는 공장
              </li>
            </ul>
          </div>
        </section>

        {/* 2. 문제 */}
        <section className={s.statement}>
          <div className="wrap">
            <p className={s.statementText}>
              전화로 물어물어 찾던 물량을,
              <br />
              이제 <em>거리·이동시간·타설 속도</em>로 한 번에 풉니다.
            </p>
          </div>
        </section>

        {/* 3. 프로세스 */}
        <section className={s.section} id="process">
          <div className="wrap">
            <p className={s.sectionEyebrow}>HOW IT WORKS</p>
            <h2 className={s.sectionTitle}>
              주문부터 연속 타설까지,
              <br />
              하나의 흐름으로
            </h2>
            <div className={s.processGrid}>
              {PROCESS.map((p, i) =>
                p.media ? (
                  <article key={i} className={`${s.processCard} ${s.processMedia}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.media} alt={p.alt ?? ''} />
                  </article>
                ) : (
                  <article key={i} className={s.processCard}>
                    <span className={s.processIndex}>{p.index}</span>
                    <h3>{p.title}</h3>
                    <p>{p.body}</p>
                  </article>
                ),
              )}
            </div>
          </div>
        </section>

        {/* 4. WHY */}
        <section className={s.section}>
          <div className="wrap">
            <p className={s.sectionEyebrow}>WHY</p>
            <h2 className={s.sectionTitle}>덜어내고, 채웁니다.</h2>
            <div className={s.whyGrid}>
              {WHY.map((w) => (
                <article key={w.tag} className={s.whyCard}>
                  <span className={s.whyTag}>{w.tag}</span>
                  <h3>{w.title}</h3>
                  <p>{w.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 5. 역할 선택 */}
        <section className={s.section} id="role">
          <div className="wrap">
            <p className={s.sectionEyebrow}>START</p>
            <h2 className={s.sectionTitle}>어느 쪽으로 들어오시나요?</h2>
            <div className={s.roleGrid}>
              {ROLES.map((r) => (
                <Link key={r.href} href={r.href} className={s.roleCard}>
                  <strong>{r.name}</strong>
                  <span>{r.desc}</span>
                  <span className={s.go}>들어가기 →</span>
                </Link>
              ))}
            </div>
            <p className="mock-notice" style={{ marginTop: 24, display: 'inline-block' }}>
              시연용 가상 데이터입니다. 공장·현장·차량은 실제 업체와 무관하게 지어낸 것입니다.
            </p>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={`wrap ${s.footerInner}`}>
          <div className={s.footerBrand}>
            <span className={s.logo}>
              레미<span className={s.logoDot}>go</span>
            </span>
            <p>
              공사장과 레미콘 공장을 연결하는 실시간 레미콘 매칭·배송 관리 플랫폼. AI 공장 배분과
              지연 예측으로 콜드조인트를 막습니다.
            </p>
          </div>
        </div>
        <div className={`wrap ${s.footerBottom}`}>
          <p>
            © 2026 레미go. 콘크리트는 굳지만, 기록은 남습니다. ·{' '}
            <Link href="/setup" style={{ color: 'inherit' }}>
              설정 점검
            </Link>
          </p>
        </div>
      </footer>
    </>
  );
}
