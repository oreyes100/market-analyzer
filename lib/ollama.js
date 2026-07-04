// LLM local opcional vía Ollama (localhost:11434). Degradación limpia: si no está corriendo,
// todo el sistema funciona en modo determinista (intents + plantillas).

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
// Preferencia: modelos locales rápidos ya instalados en esta máquina
const MODEL_PREFERENCE = ['qwen3.5:9b-mlx', 'gemma4:12b-mlx', 'llama3.2:latest', 'nemotron-3-nano:4b'];

let state = { checkedAt: 0, available: false, model: null };

export async function ollamaStatus() {
  if (Date.now() - state.checkedAt < 5 * 60_000) return state;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error();
    const { models } = await res.json();
    const names = models.map(m => m.name);
    const model = process.env.OLLAMA_MODEL
      ?? MODEL_PREFERENCE.find(p => names.includes(p))
      ?? names.find(n => !n.includes('cloud')) // evitar modelos cloud (requieren cuenta)
      ?? null;
    state = { checkedAt: Date.now(), available: !!model, model };
  } catch {
    state = { checkedAt: Date.now(), available: false, model: null };
  }
  return state;
}

export async function ollamaGenerate(prompt, { system = '', maxTokens = 400, timeoutMs = 90_000 } = {}) {
  const { available, model } = await ollamaStatus();
  if (!available) throw new Error('Ollama no disponible');
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt, system, stream: false,
      think: false, // modelos qwen3.x gastan todo num_predict en <think> si no se desactiva
      options: { num_predict: maxTokens, temperature: 0.3 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const json = await res.json();
  // Modelos con razonamiento embebido devuelven <think>...</think> — quitarlo para TTS
  return String(json.response ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
