// Everything channel-specific lives here so a future fork only edits one file.
export const CHANNEL = {
  name: "Nymphelia",
  handle: "nymphelia",
  kana: "ニンフェリア",
  tagline: "asmrtist ✦ streamer",
  twitch: "https://www.twitch.tv/nymphelia",
  x: "https://x.com/nymphelia_",
  youtube: "https://www.youtube.com/@nympheliach",
  discord: "https://discord.gg/nymphelia",
};

// Order here is the order the social buttons render in.
export const SOCIALS = [
  { key: "twitch", label: "Twitch", url: CHANNEL.twitch },
  { key: "youtube", label: "YouTube", url: CHANNEL.youtube },
  { key: "x", label: "X", url: CHANNEL.x },
  { key: "tiktok", label: "TikTok", url: CHANNEL.tiktok },
  { key: "instagram", label: "Instagram", url: CHANNEL.instagram },
  { key: "discord", label: "Discord", url: CHANNEL.discord },
].filter((s) => s.url);

export const CREDITS = {
  maintainer: { name: "Bonnniex3", url: "https://github.com/Bonnniex3" },
  artist: null,
};
