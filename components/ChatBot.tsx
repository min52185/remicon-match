'use client';

/**
 * 레캉쌤 — 오른쪽 아래에 떠 있는 AI 도우미.
 * 지금은 대화창이 열리는 것까지만 있다. 질문을 받아 답하는 부분은 아직 연결하지 않았다.
 */

import { useState } from 'react';
import s from './ChatBot.module.css';

const NAME = '레캉쌤';

export default function ChatBot() {
  const [open, setOpen] = useState(false);
  const [bubbleHidden, setBubbleHidden] = useState(false);

  return (
    <div className={s.root}>
      {open && (
        <section className={s.panel} role="dialog" aria-label={`AI 튜터 ${NAME}`}>
          <header className={s.panelHead}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/img/lecang.png" alt="" className={s.headImg} />
            <div className={s.headText}>
              <strong>{NAME}</strong>
              <span>AI 튜터</span>
            </div>
            <button type="button" className={s.close} onClick={() => setOpen(false)} aria-label="대화창 닫기">
              ×
            </button>
          </header>
          <div className={s.messages}>
            <p className={s.botMsg}>
              안녕하세요, {NAME}이에요. 레미콘 주문이나 슬럼프, 타설 시간 같은 게 궁금하면 편하게 물어보세요.
            </p>
          </div>
          <form className={s.inputRow} onSubmit={(e) => e.preventDefault()}>
            <input type="text" placeholder="질문 기능은 준비 중이에요" disabled aria-label="질문 입력" />
            <button type="submit" disabled>
              보내기
            </button>
          </form>
        </section>
      )}

      {!open && (
        <div className={s.launcher}>
          {!bubbleHidden && (
            <button type="button" className={s.hide} onClick={() => setBubbleHidden(true)} aria-label="안내 말풍선 닫기">
              ×
            </button>
          )}
          <button type="button" className={s.fab} onClick={() => setOpen(true)} aria-label={`AI 튜터 ${NAME} 열기`}>
            {!bubbleHidden && (
              <span className={s.bubble}>
                AI 튜터
                <br />
                {NAME}
              </span>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/img/lecang.png" alt="" className={s.mascot} />
          </button>
        </div>
      )}
    </div>
  );
}
