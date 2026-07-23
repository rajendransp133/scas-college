// Load test: GET /students?search=&page=&pageSize= — trigram search +
// pagination under load, against the seed_large.py dataset (~4.8k students).
//
// Run:  k6 run -e BASE_URL=http://localhost:8000 \
//              -e EMAIL=admin@scas.edu -e PASSWORD=admin123 k6/students-search.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
// Demo logins were removed — pass a real account.
const EMAIL = __ENV.EMAIL || "admin@scascollege.ac.in";
const PASSWORD = __ENV.PASSWORD;
if (!PASSWORD) throw new Error("Pass -e PASSWORD=... (demo logins were removed)");

const errorRate = new Rate("students_errors");

export const options = {
  scenarios: {
    students_ramp: {
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
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    students_errors: ["rate<0.001"],
  },
};

// One shared login per test run (setup() runs once, not per-VU) — this
// exercises the students list/search endpoint, not the login endpoint
// (that's k6/login.js's job), so a single token reused across VUs is
// correct here and avoids drowning the run in login rate-limit noise.
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

// A spread of search terms so the trigram index (pg_trgm GIN on lower(name)
// / lower(roll_number)) is actually exercised across different substrings,
// not one hot, fully-cached query.
const SEARCH_TERMS = ["a", "sh", "ku", "an", "ra", "pr", "de", "202"];

export default function ({ token }) {
  const page = 1 + Math.floor(Math.random() * 20);
  const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
  const url = `${BASE_URL}/students?search=${term}&page=${page}&pageSize=25`;

  const res = http.get(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "has items/total/page envelope": (r) => {
      if (r.status !== 200) return false;
      const body = JSON.parse(r.body);
      return (
        Array.isArray(body.items) &&
        typeof body.total === "number" &&
        typeof body.page === "number"
      );
    },
  });
  errorRate.add(!ok);

  sleep(0.3);
}
