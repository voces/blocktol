// The four cells a 2x2 block covers, relative to its top-left corner.
export const offsets: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

// Community Discord's permanent invite code. Drives the join link
// (discord.gg/<code>) and the live "online now" lookup (`discordInfo` in
// server/routes/discord.ts), which needs no widget or bot token.
export const DISCORD_INVITE = "A6r7Ub6dRh";
