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

export async function getJson<T>(url: string, throttle?: Throttle, init?: RequestInit): Promise<Fetched<T>> {
  for (let attempt = 0; ; attempt++) {
    await throttle?.wait();
    const res = await fetch(url, init);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return { status: res.status, body: (await res.json()) as T, url };
  }
}
