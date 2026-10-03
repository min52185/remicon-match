/**
 * 레캉쌤에게 묻기.
 *
 * 서버(app/api/assistant)가 Gemini 나 Claude 를 부른다. 키가 없거나 호출이 실패하면
 * 여기서 정해진 문장으로 대신 답한다 — 어느 쪽이든 숫자는 같은 context 에서 나온다.
 */

import { offlineAnswer, type SiteContext } from '../ai/assistant';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantReply {
  text: string;
  /** gemini·claude: 그 LLM 이 답함 / template: 정해진 문장 */
  source: 'gemini' | 'claude' | 'template';
}

/**
 * 서버에 키가 없다고 한 번 들었으면 그다음부터는 묻지 않는다.
 * 키 없이 쓰는 동안 질문마다 서버를 한 바퀴 돌면 답이 그만큼 늦다.
 * (키를 넣고 서버를 다시 켜면 새로고침한 화면부터 LLM 으로 답한다)
 */
let serverUnconfigured = false;

export async function askAssistant(
  question: string,
  context: SiteContext | null,
  history: ChatTurn[],
): Promise<AssistantReply> {
  if (serverUnconfigured) return { text: offlineAnswer(question, context), source: 'template' };

  try {
    const res = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, context, history }),
    });
    const data = (await res.json()) as { source?: string; answer?: string; error?: string };
    if (res.ok && (data.source === 'gemini' || data.source === 'claude') && data.answer) {
      return { text: data.answer, source: data.source };
    }
    if (data.source === 'unconfigured') serverUnconfigured = true;
    // 질문 자체가 잘못된 경우(너무 김 등)는 그 이유를 그대로 보여 준다
    if (res.status === 400 && data.error) return { text: data.error, source: 'template' };
  } catch {
    /* 네트워크 실패 — 아래에서 정해진 문장으로 답한다 */
  }

  return { text: offlineAnswer(question, context), source: 'template' };
}
