'use client';

/**
 * 인쇄(PDF 저장) 전용 묶음.
 *
 * 예전에는 "인쇄할 때 숨길 것" 에 .no-print 를 하나씩 달았다. 그 방식은 화면에
 * 뭐가 하나 늘 때마다 샌다 — 실제로 납품서를 PDF 로 저장하면 제목·주문 내역·
 * 새 납품서 안내가 같이 따라 나왔다. 숨길 것을 세는 한, 새로 만든 패널에
 * .no-print 를 다는 것을 잊은 날 바로 깨진다.
 *
 * 그래서 반대로 한다. 인쇄할 것만 이 묶음에 담고, 인쇄 때는 body 의 다른
 * 자식을 전부 끈다(globals.css 의 @media print). body 바로 아래에 붙이는 이유도
 * 그것이다 — 화면 트리 안에 두면 상위 요소가 숨겨질 때 같이 숨는다.
 *
 * 쓰는 쪽은 "무엇을 인쇄할지" 만 정하면 된다. 담기면 인쇄창이 뜨고, 닫히면
 * onDone 으로 알려 준다.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function PrintArea({
  active,
  children,
  onDone,
}: {
  /**
   * 인쇄를 걸었나.
   *
   * children 으로 판단하면 안 된다 — JSX 는 렌더마다 새 값이라, 화면이 한 번
   * 다시 그려질 때마다 예약해 둔 인쇄 호출이 취소되고 다시 잡힌다. 실제로
   * 단추를 눌러도 인쇄창이 안 떴다. 켜고 끄는 신호는 따로 받는다.
   */
  active: boolean;
  /** 인쇄할 내용 */
  children: React.ReactNode;
  onDone: () => void;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  // 서버에는 document 가 없다. 브라우저에 올라온 뒤에 붙인다.
  useEffect(() => setHost(document.body), []);

  useEffect(() => {
    if (!active || !host) return;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onDone();
    };

    window.addEventListener('afterprint', finish);

    /*
     * 내용이 DOM 에 들어간 뒤에 부른다. 이 effect 가 도는 시점에 이미 들어가
     * 있지만, 브라우저가 배치를 한 번 하도록 틈을 준다.
     *
     * requestAnimationFrame 을 쓰면 안 된다 — 탭이 가려져 있으면 아예 돌지 않아서
     * 단추를 눌러도 인쇄창이 뜨지 않는다. setTimeout 은 느려질 뿐 멈추지는 않는다.
     */
    const id = window.setTimeout(() => window.print(), 0);

    return () => {
      window.clearTimeout(id);
      window.removeEventListener('afterprint', finish);
    };
  }, [active, host, onDone]);

  if (!active || !host) return null;
  return createPortal(
    <div id="print-root" aria-hidden>
      {children}
    </div>,
    host,
  );
}
