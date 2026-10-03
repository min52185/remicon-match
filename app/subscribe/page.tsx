import Link from 'next/link';
import { findPlan } from '@/lib/plans';
import s from '../landing.module.css';

// 요금제 신청 — 결제는 아직 붙이지 않았다. 고른 요금제를 확인하고 바로 써 보게 한다.
export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan: planId } = await searchParams;
  const plan = findPlan(planId);

  return (
    <>
      <header className={s.header}>
        <div className={`wrap ${s.headerInner}`}>
          <Link href="/" className={s.logo}>
            레미<span className={s.logoDot}>go</span>
          </Link>
          <Link href="/#pricing" className="btn btn-outline btn-sm">
            요금제 다시 보기
          </Link>
        </div>
      </header>

      <main className={s.section}>
        <div className={`wrap ${s.subscribeWrap}`}>
          {plan ? (
            <>
              <p className={s.sectionEyebrow}>SUBSCRIBE</p>
              <h1 className={s.sectionTitle}>{plan.name} 요금제</h1>
              <article className={`${s.planCard} ${plan.recommended ? s.planRecommended : ''}`}>
                <p className={s.planTarget}>{plan.target}</p>
                <p className={s.planPrice}>{plan.price}</p>
                <ul className={s.planFeatures}>
                  {plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {plan.contactOnly ? (
                  <p className={s.subscribeNote}>
                    엔터프라이즈는 현장 수와 계약 기간에 맞춰 따로 협의합니다. 시연 버전에서는 문의
                    접수가 아직 연결되어 있지 않습니다.
                  </p>
                ) : (
                  <p className={s.subscribeNote}>
                    시연 버전이라 결제는 아직 연결되어 있지 않습니다. 아래에서 바로 써 볼 수 있습니다.
                  </p>
                )}
                <Link href="/site" className={`btn btn-primary btn-block ${s.planCta}`}>
                  현장 화면으로 써 보기
                </Link>
              </article>
            </>
          ) : (
            <>
              <p className={s.sectionEyebrow}>SUBSCRIBE</p>
              <h1 className={s.sectionTitle}>요금제를 찾지 못했습니다</h1>
              <Link href="/#pricing" className="btn btn-primary">
                요금제 고르러 가기
              </Link>
            </>
          )}
        </div>
      </main>
    </>
  );
}
