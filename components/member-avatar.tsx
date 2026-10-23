"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { defaultAvatarUrl } from "@/lib/profile/avatars";

export function MemberAvatar({
  name,
  userId,
  avatarUrl,
  size = "medium",
}: {
  name: string;
  userId: string;
  avatarUrl?: string | null;
  size?: "small" | "medium" | "large";
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const resolvedAvatarUrl = avatarUrl || defaultAvatarUrl(userId);
  const imageFailed = failedUrl === resolvedAvatarUrl;

  return (
    <span className={`member-avatar member-avatar-${size}`} aria-hidden="true">
      {!imageFailed ? (
        // Profiles can contain provider-hosted or DiceBear avatar URLs.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedAvatarUrl}
          alt=""
          onError={() => setFailedUrl(resolvedAvatarUrl)}
        />
      ) : (
        <UserRound aria-label={`${name} avatar`} />
      )}
    </span>
  );
}
