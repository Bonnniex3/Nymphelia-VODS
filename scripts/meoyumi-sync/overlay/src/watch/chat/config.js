// Chat replay's own channel settings. They live here (not in src/lib/channel.js) because the
// frontend sync regenerates channel.js from a fixed key list; this folder survives it as an overlay.
// Numeric Twitch user id (not the login): chat's 7TV channel emotes are looked up by it.
export const TWITCH_ID = "542363039";
