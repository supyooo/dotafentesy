/** Ответ источника как есть — для raw_payloads. */
export interface Fetched<T> { status: number; body: T; url: string }

/** Простой ограничитель: не чаще одного запроса в minIntervalMs (OpenDota без ключа ~60/мин). */
export class Throttle {
  private next = 0;
  constructor(private readonly minIntervalMs: number) {}
  async wait() {
    const now = Date.now(), at = Math.max(now, this.next);
    this.next = at + this.minIntervalMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getJson<T>(url: string, throttle?: Throttle, init?: RequestInit): Promise<Fetched<T>> {
  for (let attempt = 0; ; attempt++) {
    await throttle?.wait();
    // обрыв соединения / таймаут — тоже повод повторить, а не ронять весь сбор
    const res = await fetch(url, init).catch((e: unknown) => { if (attempt < 3) return null; throw e; });
    if (!res) { await sleep(2000 * 2 ** attempt); continue; }
    // 429: у OpenDota лимит поминутный (X-Rate-Limit-Remaining-Minute) — ждать сброса минуты, а не секунды
    if (res.status === 429 && attempt < 3) { await sleep(Number(res.headers.get("retry-after") ?? 0) * 1000 || 61_000); continue; }
    if (res.status >= 500 && attempt < 3) { await sleep(2000 * 2 ** attempt); continue; }
    // лимит минуты на исходе — переждать заранее, чтобы не получать 429
    const left = Number(res.headers.get("x-rate-limit-remaining-minute") ?? NaN);
    if (left <= 2) await sleep(60_000);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return { status: res.status, body: (await res.json()) as T, url };
  }
}
