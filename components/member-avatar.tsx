"use client";

import { useState } from "react";

const avatarPalettes = [
  ["#e8e7ff", "#4338ca"],
  ["#dcfce7", "#166534"],
  ["#e0f2fe", "#075985"],
  ["#ffedd5", "#9a3412"],
  ["#fce7f3", "#9d174d"],
] as const;

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words.length > 1
      ? `${words[0][0]}${words.at(-1)?.[0]}`
      : (words[0]?.[0] ?? "M")
  ).toUpperCase();
}

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
  const [imageFailed, setImageFailed] = useState(false);
  const paletteIndex =
    [...userId].reduce((sum, character) => sum + character.charCodeAt(0), 0) %
    avatarPalettes.length;
  const [background, color] = avatarPalettes[paletteIndex];

  return (
    <span
      className={`member-avatar member-avatar-${size}`}
      style={{ background, color }}
      aria-hidden="true"
    >
      {avatarUrl && !imageFailed ? (
        // Profiles can contain provider-hosted avatar URLs, so a plain image is intentional.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" onError={() => setImageFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
