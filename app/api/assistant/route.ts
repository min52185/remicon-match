/**
 * 레캉쌤 — Claude 에 묻는 서버 쪽 창구.
 *
 * API 키는 서버에서만 쓴다. 키가 없으면 { source: 'unconfigured' } 를 돌려주고,
 * 브라우저(lib/services/assistant)가 정해진 문장으로 답한다.
 *
 * 숫자는 브라우저가 계산해 context 로 보낸다(lib/ai/assistant). 데이터가 브라우저
 * 저장소에만 있는 모드에서도 서버가 현장 상황을 알 수 있게 하기 위해서다.
 */

import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { ASSISTANT_SYSTEM, contextBlock, type SiteContext } from '@/lib/ai/assistant';

/** [가정] 질문 한 번의 길이 상한 — 긴 붙여넣기로 요금이 새지 않게 */
const MAX_QUESTION_CHARS = 500;
/** [가정] 앞 대화는 이만큼만 같이 보낸다 */
const MAX_HISTORY = 8;
const MAX_HISTORY_CHARS = 2000;
/** [가정] 현장 상황 JSON 상한 */
const MAX_CONTEXT_CHARS = 20_000;

const MODEL = 'claude-opus-5-5';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

interface Body {
  question?: unknown;
  context?: unknown;
  history?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다.' }, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return NextResponse.json({ error: '질문이 비었습니다.' }, { status: 400 });
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json({ error: `질문은 ${MAX_QUESTION_CHARS}자까지입니다.` }, { status: 400 });
  }

  const context = (body.context ?? null) as SiteContext | null;
  if (context && JSON.stringify(context).length > MAX_CONTEXT_CHARS) {
    return NextResponse.json({ error: '현장 정보가 너무 큽니다.' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ source: 'unconfigured' });
  }

  const messages = toMessages(body.history, question);

  try {
    const client = new Anthropic();
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // 채팅이라 깊이 생각할 일이 적다 — 낮춰서 빨리, 싸게 답한다
      output_config: { effort: 'low' },
      // 정책상 거절되면 서버가 대신할 모델로 다시 돌린다
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        { type: 'text', text: ASSISTANT_SYSTEM },
        { type: 'text', text: contextBlock(context) },
      ],
      messages,
    });

    if (res.stop_reason === 'refusal') {
      return NextResponse.json({
        source: 'claude',
        answer: '그 질문에는 답하기 어려워요. 레미콘 주문이나 배송, 타설에 대해 물어봐 주세요.',
      });
    }

    const answer = res.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('')
      .trim();

    return NextResponse.json({ source: 'claude', answer });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.warn('[api/assistant] API 키가 맞지 않습니다.');
    } else if (err instanceof Anthropic.RateLimitError) {
      console.warn('[api/assistant] 요청이 몰렸습니다.');
    } else {
      console.warn('[api/assistant] Claude 호출 실패', err);
    }
    // 브라우저가 정해진 문장으로 대신 답한다
    return NextResponse.json({ source: 'error' }, { status: 502 });
  }
}

/**
 * 앞 대화 + 이번 질문.
 * 브라우저가 보낸 기록은 믿지 않고 모양을 다시 맞춘다 — user 로 시작해 번갈아 오게.
 */
function toMessages(history: unknown, question: string): Anthropic.Beta.BetaMessageParam[] {
  const turns: Turn[] = Array.isArray(history)
    ? history
        .filter(
          (t): t is Turn =>
            !!t &&
            (t.role === 'user' || t.role === 'assistant') &&
            typeof t.text === 'string' &&
            t.text.trim() !== '',
        )
        .slice(-MAX_HISTORY)
        .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_HISTORY_CHARS) }))
    : [];

  while (turns.length > 0 && turns[0].role !== 'user') turns.shift();

  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) {
      last.content = `${last.content as string}\n${t.text}`;
    } else {
      out.push({ role: t.role, content: t.text });
    }
  }

  if (out.length > 0 && out[out.length - 1].role === 'user') {
    out[out.length - 1].content = `${out[out.length - 1].content as string}\n${question}`;
  } else {
    out.push({ role: 'user', content: question });
  }
  return out;
}
