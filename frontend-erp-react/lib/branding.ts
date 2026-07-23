/**
 * Institution identity, in one place.
 *
 * Sourced from the college's public site (scascollege.ac.in). Swapping the
 * logo or renaming the institution is a change to this file plus the asset in
 * `public/` — no component hardcodes any of it.
 */

export const COLLEGE_NAME = "Sudharsan College of Arts and Science"

/** Short form for tight spaces (sidebar header, mobile top bar). */
export const COLLEGE_SHORT_NAME = "SCAS"

export const COLLEGE_TAGLINE =
  "An Institution with Academic Excellence, Employability and Leadership Skills"

export const COLLEGE_WEBSITE = "https://scascollege.ac.in/"

/**
 * Crest, served from `public/`. Copied from the college site, not hotlinked.
 *
 * Rendered with next/image's `fill` inside a fixed-size box rather than
 * explicit width/height: the intrinsic dimensions aren't pinned here, so
 * replacing the file with a different aspect ratio can't distort it.
 */
export const COLLEGE_LOGO = "/sudharsan_college_logo.webp"
