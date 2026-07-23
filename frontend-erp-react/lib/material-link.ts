// Thumbnails for shared study-material links, derived from the URL alone.
//
// Deliberately pure and network-free on our side: we never fetch the target to
// scrape OpenGraph tags, because materials are no longer stored on our backend
// and a link should cost nothing to render. YouTube exposes a poster image at a
// predictable path; a handful of well-known hosts get a branded icon; anything
// else falls back to the host's favicon, and to a generic icon if even that
// fails to load.

import {
  FileText,
  FolderOpen,
  CodeXml,
  Link as LinkIcon,
  Presentation,
  Table,
  CirclePlay,
  type LucideIcon,
} from "lucide-react"

export interface LinkPreview {
  /** What kind of link this is — handy for `key`s and tests. */
  kind: string
  /** Icon shown when there is no thumbnail, or when the thumbnail fails. */
  Icon: LucideIcon
  /** Tailwind classes tinting the thumbnail tile. */
  className: string
  /** An image to show instead of the icon, when we can name one confidently. */
  thumbnailUrl?: string
}

function parse(url: string): URL | null {
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u : null
  } catch {
    return null
  }
}

/** The bare host, minus `www.` — the card's subtitle ("youtube.com"). */
export function hostLabel(url: string): string {
  const u = parse(url)
  return u ? u.hostname.replace(/^www\./, "") : "link"
}

/**
 * A title suggestion for a freshly pasted link: the last meaningful path
 * segment, tidied up, else the host. Used only to prefill an empty title.
 */
export function suggestTitle(url: string): string {
  const u = parse(url)
  if (!u) return ""
  const segment = u.pathname
    .split("/")
    .filter(Boolean)
    .pop()
  if (!segment || segment.length > 80) return hostLabel(url)
  const cleaned = decodeURIComponent(segment)
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[-_+]+/g, " ")
    .trim()
  // Opaque ids ("1aBc9XyZ...") make worse titles than the host does.
  if (!cleaned || !/[a-z]/.test(cleaned) || !/\s/.test(cleaned)) {
    return hostLabel(url)
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

/** The video id, for the two YouTube URL shapes people actually paste. */
function youtubeId(u: URL): string | null {
  if (u.hostname.endsWith("youtu.be")) {
    return u.pathname.split("/").filter(Boolean)[0] ?? null
  }
  if (!u.hostname.endsWith("youtube.com")) return null
  const v = u.searchParams.get("v")
  if (v) return v
  const embed = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)
  return embed?.[1] ?? null
}

export function linkPreview(url: string): LinkPreview {
  const u = parse(url)
  if (!u) {
    return { kind: "unknown", Icon: LinkIcon, className: "bg-muted text-muted-foreground" }
  }
  const host = u.hostname.replace(/^www\./, "")
  const path = u.pathname.toLowerCase()

  const ytId = youtubeId(u)
  if (ytId) {
    return {
      kind: "youtube",
      Icon: CirclePlay,
      className: "bg-red-50 text-red-600",
      thumbnailUrl: `https://img.youtube.com/vi/${encodeURIComponent(ytId)}/mqdefault.jpg`,
    }
  }
  if (host === "docs.google.com") {
    if (path.startsWith("/spreadsheets"))
      return { kind: "sheets", Icon: Table, className: "bg-emerald-50 text-emerald-700" }
    if (path.startsWith("/presentation"))
      return { kind: "slides", Icon: Presentation, className: "bg-amber-50 text-amber-700" }
    return { kind: "docs", Icon: FileText, className: "bg-blue-50 text-blue-700" }
  }
  if (host === "drive.google.com") {
    return { kind: "drive", Icon: FolderOpen, className: "bg-yellow-50 text-yellow-700" }
  }
  if (host === "github.com" || host === "gist.github.com") {
    return { kind: "github", Icon: CodeXml, className: "bg-neutral-100 text-neutral-800" }
  }
  if (path.endsWith(".pdf")) {
    return { kind: "pdf", Icon: FileText, className: "bg-rose-50 text-rose-700" }
  }
  return {
    kind: "site",
    Icon: LinkIcon,
    className: "bg-muted text-muted-foreground",
    thumbnailUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
  }
}
