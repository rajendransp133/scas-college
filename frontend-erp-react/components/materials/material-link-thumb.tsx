"use client";

// The thumbnail tile for a shared material link. The image is a best guess
// derived from the URL (see lib/material-link.ts) and lives on someone else's
// server, so a failure to load is expected, not exceptional — fall back to the
// icon rather than showing a broken image.

import { useState } from "react";
import { linkPreview } from "@/lib/material-link";
import { cn } from "@/lib/utils";

export function MaterialLinkThumb({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const preview = linkPreview(url);
  const [failed, setFailed] = useState(false);
  const showImage = preview.thumbnailUrl && !failed;

  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md",
        preview.className,
        className,
      )}
    >
      {showImage ? (
        // Remote host, unknown at build time; next/image would need a domain
        // allowlist. (The directive must be the line directly above <img>.)
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview.thumbnailUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <preview.Icon size={18} />
      )}
    </span>
  );
}
