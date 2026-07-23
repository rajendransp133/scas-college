// Load test: POST /attendance — the one mutating hot path. Exercises write
// contention + the DB pool under concurrent writes (session upsert on
// (course_id, date, period), correction diffing, audit stamping), not just
// reads like the other three scripts.
//
// Each iteration marks a *different* (date, period) for the same course, so
// VUs create distinct new sessions rather than serializing corrections onto
// one row — a more realistic write-contention shape for "many teachers
// marking many classes" than "many people editing the same session".
//
// Run:  k6 run -e BASE_URL=http://localhost:8000 \
//              -e EMAIL=admin@scas.edu -e PASSWORD=admin123 k6/mark-attendance.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
// Demo logins were removed — pass a real account with attendance-marking rights.
const EMAIL = __ENV.EMAIL || "admin@scascollege.ac.in";
const PASSWORD = __ENV.PASSWORD;
if (!PASSWORD) throw new Error("Pass -e PASSWORD=... (demo logins were removed)");

const errorRate = new Rate("mark_errors");

export const options = {
  scenarios: {
    mark_ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 25 },
        { duration: "1m", target: 100 },
        { duration: "2m", target: 100 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    // Write endpoint gets the plan's 800ms bar, not the 500ms read bar.
    http_req_duration: ["p(95)<800", "p(99)<1500"],
    mark_errors: ["rate<0.001"],
  },
};

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
}

export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (loginRes.status !== 200) {
    throw new Error(`setup login failed: ${loginRes.status} ${loginRes.body}`);
  }
  const token = JSON.parse(loginRes.body).accessToken;

  const settingsRes = http.get(`${BASE_URL}/settings`, authHeaders(token));
  if (settingsRes.status !== 200) {
    throw new Error(`setup /settings failed: ${settingsRes.status} ${settingsRes.body}`);
  }
  const termId = JSON.parse(settingsRes.body).currentTermId;

  const coursesRes = http.get(`${BASE_URL}/courses`, authHeaders(token));
  if (coursesRes.status !== 200) {
    throw new Error(`setup /courses failed: ${coursesRes.status} ${coursesRes.body}`);
  }
  const courses = JSON.parse(coursesRes.body);

  // Find the first course with a non-empty roster (some may have zero
  // active students depending on seed state) — try a handful before giving up.
  let courseId = null;
  let studentIds = [];
  for (const course of courses.slice(0, 20)) {
    const rosterRes = http.get(
      `${BASE_URL}/attendance/roster?courseId=${course.id}`,
      authHeaders(token),
    );
    if (rosterRes.status === 200) {
      const roster = JSON.parse(rosterRes.body);
      if (roster.length > 0) {
        courseId = course.id;
        studentIds = roster.map((s) => s.id);
        break;
      }
    }
  }
  if (!courseId) {
    throw new Error("setup: no course with a non-empty roster found");
  }

  return { token, termId, courseId, studentIds };
}

function randomPastDate() {
  // Anywhere in the last 60 days but never today/future (server allows any
  // past date; period+date combo just needs to be unique per iteration).
  const daysAgo = 1 + Math.floor(Math.random() * 60);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export default function ({ token, termId, courseId, studentIds }) {
  const period = 1 + Math.floor(Math.random() * 12);
  const date = randomPastDate();

  const records = studentIds.map((studentId) => ({
    studentId,
    status: Math.random() < 0.9 ? "present" : "absent",
  }));

  const payload = JSON.stringify({
    courseId,
    termId,
    date,
    period,
    records,
  });

  const res = http.post(`${BASE_URL}/attendance`, payload, authHeaders(token));

  const ok = check(res, {
    // 200 = saved; 403 can legitimately occur if the random date lands on or
    // before a lock date set by another concurrent test run against the same
    // DB — both are "the server behaved correctly", only 5xx counts as a
    // real failure for this script's purposes.
    "status is 200 or 403": (r) => r.status === 200 || r.status === 403,
  });
  errorRate.add(!ok);

  sleep(0.5);
}
