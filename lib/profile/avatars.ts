const DICEBEAR_BASE = "https://api.dicebear.com/10.x";

export const avatarChoices = [
  { id: "aurora", label: "Aurora", style: "notionists", color: "e0e7ff" },
  { id: "sage", label: "Sage", style: "lorelei", color: "dcfce7" },
  { id: "river", label: "River", style: "adventurer", color: "e0f2fe" },
  { id: "ember", label: "Ember", style: "avataaars", color: "ffedd5" },
  { id: "berry", label: "Berry", style: "notionists", color: "fce7f3" },
  { id: "cosmo", label: "Cosmo", style: "lorelei", color: "ede9fe" },
  { id: "sunny", label: "Sunny", style: "adventurer", color: "fef3c7" },
  { id: "ocean", label: "Ocean", style: "avataaars", color: "cffafe" },
] as const;

function stableSeed(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `nest-${(hash >>> 0).toString(36)}`;
}

export function avatarUrl(
  userId: string,
  choice: (typeof avatarChoices)[number],
) {
  const seed = encodeURIComponent(stableSeed(`${userId}:${choice.id}`));
  return `${DICEBEAR_BASE}/${choice.style}/svg?seed=${seed}&backgroundColor=${choice.color}`;
}

export function defaultAvatarUrl(userId: string) {
  const choice =
    avatarChoices[
      [...userId].reduce(
        (total, character) => total + character.charCodeAt(0),
        0,
      ) % avatarChoices.length
    ];
  return avatarUrl(userId, choice);
}

export function selectableAvatars(userId: string) {
  return avatarChoices.map((choice) => ({
    ...choice,
    url: avatarUrl(userId, choice),
  }));
}
