// Load test: POST /auth/login under concurrent load.
// This is the proof point for the Phase 0 fix (bcrypt moved off the event
// loop via run_in_threadpool) — before that fix, p95/p99 latency here grew
// with concurrency because every login blocked the single event loop.
//
// Run:  k6 run -e BASE_URL=http://localhost:8000 k6/login.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";

const errorRate = new Rate("login_errors");
const loginDuration = new Trend("login_duration", true);

export const options = {
  scenarios: {
    login_ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 100 },
        { duration: "1m", target: 500 },
        { duration: "2m", target: 500 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    // p95 < 500ms is the plan's read-endpoint bar; login does a bcrypt
    // compare so treat it like a light write for headroom.
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    login_errors: ["rate<0.001"],
  },
};

// The demo seeds (and their well-known passwords) are gone — the database
// holds real accounts with random passwords now, so credentials must come
// from env:  k6 run -e EMAIL=... -e PASSWORD=... k6/login.js
// The 10/min-per-IP rate limiter (backend-erp-fastapi/rate_limit.py) will
// still dominate a single-machine run — see k6/README.md.
if (!__ENV.EMAIL || !__ENV.PASSWORD) {
  throw new Error("Pass -e EMAIL=... -e PASSWORD=... (a real account; demo logins were removed)");
}
const ACCOUNTS = [{ email: __ENV.EMAIL, password: __ENV.PASSWORD }];

export default function () {
  const account = ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)];
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: account.email, password: account.password }),
    { headers: { "Content-Type": "application/json" } },
  );

  loginDuration.add(res.timings.duration);
  const ok = check(res, {
    "status is 200 or 429": (r) => r.status === 200 || r.status === 429,
    "200 has accessToken": (r) =>
      r.status !== 200 || JSON.parse(r.body).accessToken !== undefined,
  });
  errorRate.add(!ok);

  sleep(0.5);
}
