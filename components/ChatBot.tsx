'use client';

/**
 * 레캉쌤 — 오른쪽 아래에 떠 있는 AI 도우미.
 *
 * 첫 화면에서는 일반 질문에 답하고, 현장 화면(site 를 받으면)에서는 내 배송·타설·
 * 근처 공장·급처 매물을 보고 답한다. 숫자는 lib/ai/assistant 가 계산하고,
 * Claude 는 그걸 설명만 한다. 키가 없으면 정해진 문장으로 답한다.
 */

import { useEffect, useRef, useState } from 'react';
import { SITE_STARTERS, buildSiteContext, followUps } from '@/lib/ai/assistant';
import { askAssistant, type ChatTurn } from '@/lib/services/assistant';
import { simClock } from '@/lib/services/clock';
import { getTemperature } from '@/lib/services/weather';
import { useAuth } from '@/lib/auth';
import { useDb, useSelection } from '@/lib/store/hooks';
import type { Site } from '@/lib/types';
import s from './ChatBot.module.css';

const NAME = '레캉쌤';


export default function ChatBot({ site: shellSite }: { site?: Site }) {
  const db = useDb();
  const { demoMode, profile } = useAuth();
  const [lastSiteId] = useSelection('site', '');

  /*
   * 현장 화면 밖(첫 화면)에서도 내 현장 이야기에 답하려고 현장을 스스로 정한다.
   *   로그인한 현장 계정  → 그 계정의 현장
   *   시연 모드          → 마지막으로 보던 현장, 없으면 첫 현장
   * 공장·기사 계정이면 정하지 않는다 — 남의 현장 배송을 읽어 주면 안 된다.
   */
  const site =
    shellSite ??
    (demoMode
      ? (db.sites.find((x) => x.id === lastSiteId) ?? db.sites[0])
      : profile?.role === 'site'
        ? db.sites.find((x) => x.id === profile.siteId)
        : undefined);
  const [open, setOpen] = useState(false);
  // 앱 화면 안에서는 말풍선이 화면을 가리지 않게 처음부터 접어 둔다
  const [bubbleHidden, setBubbleHidden] = useState(!!shellSite);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  /** 방금 답한 질문에 이어 물을 것. 아직 묻기 전이면 null — 처음 질문을 보여 준다 */
  const [next, setNext] = useState<string[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [tempC, setTempC] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 제한시간(90/120분) 판단에 쓰는 기온 — 대화창을 열 때 한 번 가져온다
  useEffect(() => {
    if (!open || !site) return;
    let alive = true;
    getTemperature(site, simClock.now()).then((t) => alive && setTempC(t.tempC));
    return () => {
      alive = false;
    };
  }, [open, site]);

  // 새 말이 오면 맨 아래로
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const suggestions = next ?? (site ? SITE_STARTERS : []);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const history = messages;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setDraft('');
    setBusy(true);

    // 숫자는 보내는 순간의 상황으로 계산한다
    const context = site ? buildSiteContext(db, site, simClock.now(), tempC) : null;
    const reply = await askAssistant(question, context, history);
    setMessages((m) => [...m, { role: 'assistant', text: reply.text }]);
    setNext(followUps(question, context));
    setBusy(false);
  }

  return (
    <div className={`${s.root} ${shellSite ? s.docked : ''}`}>
      {open && (
        <section className={s.panel} role="dialog" aria-label={`AI 튜터 ${NAME}`}>
          <header className={s.panelHead}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/img/lecang.png" alt="" className={s.headImg} />
            <div className={s.headText}>
              <strong>{NAME}</strong>
              <span>{site ? `${site.name} 도우미` : 'AI 튜터'}</span>
            </div>
            <button type="button" className={s.close} onClick={() => setOpen(false)} aria-label="대화창 닫기">
              ×
            </button>
          </header>

          <div className={s.messages} ref={listRef} aria-live="polite">
            <p className={s.botMsg}>
              안녕하세요, {NAME}이에요.{' '}
              {site
                ? '배송이 어디쯤인지, 근처 공장이나 급처 매물이 어떤지 물어보세요.'
                : '레미콘 주문이나 슬럼프, 타설 시간 같은 게 궁금하면 편하게 물어보세요.'}
            </p>

            {messages.map((m, i) =>
              m.role === 'user' ? (
                <p key={i} className={s.userMsg}>
                  {m.text}
                </p>
              ) : (
                <div key={i}>
                  <p className={s.botMsg}>{m.text}</p>
                </div>
              ),
            )}

            {busy && <p className={`${s.botMsg} ${s.typing}`}>생각하는 중…</p>}
          </div>

          {/*
            추천 질문 — 늘 입력칸 위에 둔다. 처음에는 대표 질문, 답한 뒤에는
            방금 질문에 이어 물을 만한 것으로 바뀐다. 전부 '지금 내 현장' 질문이라
            현장을 모르는 화면(공장·기사 계정)에서는 줄째로 숨긴다.
          */}
          {suggestions.length > 0 && (
            <div className={s.suggestions} aria-label="이어서 물어볼 질문">
              {suggestions.map((q) => (
                <button key={q} type="button" disabled={busy} onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}

          <form
            className={s.inputRow}
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <input
              type="text"
              placeholder={site ? '예: 3호차 언제 와요?' : '궁금한 걸 물어보세요'}
              value={draft}
              maxLength={500}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="질문 입력"
            />
            <button type="submit" disabled={busy || !draft.trim()}>
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
