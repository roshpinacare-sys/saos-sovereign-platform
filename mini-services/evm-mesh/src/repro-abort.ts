/** ISOLATED REPRO: does Bun's fetch+abort actually reject when the peer stalls?
 *  Server A: accepts the TCP connection, never responds (headers never arrive).
 *  Server B: sends 200 + headers + PARTIAL body, then stalls forever.
 *  Client:   fetchJson-style — AbortController with 3s timeout, cleared after fetch resolves.
 */
import * as BunTypes from "bun";

// Server A — accept, never respond
Bun.listen({
  port: 9971,
  hostname: "127.0.0.1",
  socket: {
    data() { /* swallow — never respond */ },
  },
});

// Server B — respond with headers + partial JSON body, then stall
Bun.listen({
  port: 9972,
  hostname: "127.0.0.1",
  socket: {
    data(s) {
      s.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{\"partial\":");
      // never write the rest — body stalls mid-stream
    },
  },
});

async function fetchJsonStyle(url: string, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const res = await fetch(url, { signal: ctl.signal });
  clearTimeout(t); // ← EXACTLY like deploy.ts — timer cleared after headers
  if (!res.ok) return "not-ok";
  return await res.json(); // ← body read with NO abort coverage
}

async function trial(name: string, url: string): Promise<void> {
  const t0 = Date.now();
  const killer = setTimeout(() => {
    console.log(`${name}: HUNG >15s — the abort NEVER rejected the promise (BUG CONFIRMED)`);
    process.exit(3);
  }, 15_000);
  try {
    const out = await fetchJsonStyle(url, 3000);
    console.log(`${name}: resolved at +${Date.now() - t0}ms →`, JSON.stringify(out).slice(0, 60));
  } catch (e) {
    console.log(`${name}: rejected at +${Date.now() - t0}ms — ${e instanceof Error ? e.name : "unknown"} (abort worked)`);
  }
  clearTimeout(killer);
}

await trial("A-headers-never-arrive", "http://127.0.0.1:9971/");
await trial("B-body-stalls-mid-stream", "http://127.0.0.1:9972/");
console.log("BOTH TRIALS SETTLED — no hang");
process.exit(0);
