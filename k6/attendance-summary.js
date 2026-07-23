// Load test: GET /attendance/summary — the heaviest read in the app: a
// per-student attendance % aggregate computed in SQL over the
// seed_large.py dataset (4M attendance_record rows).
//
// Run:  k6 run -e BASE_URL=http://localhost:8000 \
//              -e EMAIL=admin@scas.edu -e PASSWORD=admin123 k6/attendance-summary.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
// Demo logins were removed — pass a real account.
const EMAIL = __ENV.EMAIL || "admin@scascollege.ac.in";
const PASSWORD = __ENV.PASSWORD;
if (!PASSWORD) throw new Error("Pass -e PASSWORD=... (demo logins were removed)");

const errorRate = new Rate("summary_errors");

export const options = {
  scenarios: {
    summary_ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "1m", target: 300 },
        { duration: "2m", target: 300 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    summary_errors: ["rate<0.001"],
  },
};

export function setup() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (res.status !== 200) {
    throw new Error(`setup login failed: ${res.status} ${res.body}`);
  }
  return { token: JSON.parse(res.body).accessToken };
}

export default function ({ token }) {
  const page = 1 + Math.floor(Math.random() * 10);
  // Vary minPct so the query can't just serve one cached plan/result shape.
  const minPct = [60, 65, 70, 75, 80][Math.floor(Math.random() * 5)];
  const url = `${BASE_URL}/attendance/summary?page=${page}&pageSize=25&minPct=${minPct}`;

  const res = http.get(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "has items + totals": (r) => {
      if (r.status !== 200) return false;
      const body = JSON.parse(r.body);
      return Array.isArray(body.items) && body.totals !== undefined;
    },
  });
  errorRate.add(!ok);

  sleep(0.5);
}
