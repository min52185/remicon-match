/**
 * 레캉쌤 — LLM 에 묻는 서버 쪽 창구.
 *
 * 두 곳 중 키가 있는 곳에 묻는다 (LLM_PROVIDER 로 고를 수도 있다).
 *   gemini  Google Gemini API — 무료 사용 구간이 있다
 *   claude  Anthropic Claude API — 유료
 * 키가 둘 다 없으면 { source: 'unconfigured' } 를 돌려주고, 브라우저
 * (lib/services/assistant)가 정해진 문장으로 답한다. 호출이 실패해도 마찬가지다.
 *
 * API 키는 서버에서만 쓴다. 숫자는 브라우저가 계산해 context 로 보낸다
 * (lib/ai/assistant). LLM 은 그 숫자를 설명만 한다.
 */

import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { ASSISTANT_SYSTEM, contextBlock, plain, type SiteContext } from '@/lib/ai/assistant';

/** [가정] 질문 한 번의 길이 상한 — 긴 붙여넣기로 사용량이 새지 않게 */
const MAX_QUESTION_CHARS = 500;
/** [가정] 앞 대화는 이만큼만 같이 보낸다 */
const MAX_HISTORY = 8;
const MAX_HISTORY_CHARS = 2000;
/** [가정] 현장 상황 JSON 상한 */
const MAX_CONTEXT_CHARS = 20_000;
/** [가정] LLM 이 이 시간 안에 답하지 않으면 정해진 문장으로 넘어간다 */
const TIMEOUT_MS = 20_000;

const CLAUDE_MODEL = 'claude-opus-5-5';
/** 무료 사용 구간이 있는 Flash 모델. 바꾸려면 .env.local 의 GEMINI_MODEL */
const GEMINI_DEFAULT_MODEL = 'gemini-3.6-flash';

const REFUSED = '그 질문에는 답하기 어려워요. 레미콘 주문이나 배송, 타설에 대해 물어봐 주세요.';

type Provider = 'gemini' | 'claude';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

interface Body {
  question?: unknown;
  context?: unknown;
  history?: unknown;
}

/** 어느 LLM 에 물을지 — 고른 것이 있으면 그것, 없으면 키가 있는 쪽(Gemini 먼저) */
function pickProvider(): Provider | null {
  const chosen = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (chosen === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (chosen === 'claude' && process.env.ANTHROPIC_API_KEY) return 'claude';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  return null;
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

  const provider = pickProvider();
  if (!provider) return NextResponse.json({ source: 'unconfigured' });

  const turns = toTurns(body.history, question);

  try {
    const answer =
      provider === 'gemini' ? await askGemini(turns, context) : await askClaude(turns, context);
    return NextResponse.json({ source: provider, answer: plain(answer) || REFUSED });
  } catch (err) {
    console.warn(`[api/assistant] ${provider} 호출 실패 — 정해진 문장으로 대신합니다.`, err);
    return NextResponse.json({ source: 'error' }, { status: 502 });
  }
}

/* ==========================================================================
 * Gemini
 * ======================================================================== */

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

async function askGemini(turns: Turn[], context: SiteContext | null): Promise<string> {
  const model = process.env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // 키는 주소(?key=)가 아니라 머리글로 보낸다 — 주소는 서버 기록에 남기 쉽다
      'x-goog-api-key': process.env.GEMINI_API_KEY!,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${ASSISTANT_SYSTEM}\n\n${contextBlock(context)}` }] },
      contents: turns.map((t) => ({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: t.text }],
      })),
      generationConfig: {
        // 사실을 말하는 도우미라 들쭉날쭉하지 않게 낮춘다
        temperature: 0.3,
        maxOutputTokens: 2048,
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const data = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    // 429 = 무료 사용 한도, 400/403 = 키나 모델 이름 문제
    throw new Error(`Gemini ${res.status} ${data.error?.status ?? ''} ${data.error?.message ?? ''}`);
  }

  if (data.promptFeedback?.blockReason) return REFUSED;
  const cand = data.candidates?.[0];
  if (cand?.finishReason === 'SAFETY') return REFUSED;

  return (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
}

/* ==========================================================================
 * Claude
 * ======================================================================== */

async function askClaude(turns: Turn[], context: SiteContext | null): Promise<string> {
  const client = new Anthropic({ timeout: TIMEOUT_MS });
  const res = await client.beta.messages.create({
    model: CLAUDE_MODEL,
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
    messages: turns.map((t) => ({ role: t.role, content: t.text })),
  });

  if (res.stop_reason === 'refusal') return REFUSED;
  return res.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('')
    .trim();
}

/* ==========================================================================
 * 대화 정리
 * ======================================================================== */

/**
 * 앞 대화 + 이번 질문.
 * 브라우저가 보낸 기록은 믿지 않고 모양을 다시 맞춘다 — user 로 시작해 번갈아 오게.
 * (Claude·Gemini 둘 다 이 모양을 요구한다)
 */
function toTurns(history: unknown, question: string): Turn[] {
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

  const out: Turn[] = [];
  for (const t of [...turns, { role: 'user' as const, text: question }]) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.text = `${last.text}\n${t.text}`;
    else out.push({ ...t });
  }
  return out;
}
