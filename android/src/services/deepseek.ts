import type { ChatMessage } from './types';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

export async function chat(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
): Promise<string> {
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}
