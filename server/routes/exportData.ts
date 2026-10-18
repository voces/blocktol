import { z } from "zod";
import { parseSettings } from "../../common/settings.ts";
import { exportUserData } from "../db/export.ts";
import { deserializeFlags } from "../util/flags.ts";
import { deserializeRun } from "../util/run.ts";
import { method } from "./apiHelpers.ts";

// Parse a stored JSON column (notification payload); a malformed blob comes
// back as the raw string rather than failing the export.
const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

// "Export my data" (GDPR access / portability): everything held about the
// caller, as one JSON document the client offers as a download. Mazes and JSON
// columns are decoded so the file is readable. Push encryption keys are omitted
// (crypto material); the subscription endpoint is included.
export const exportData = method(z.object({}).optional(), true)(
  async ({ userId }) => {
    const [
      users,
      runs,
      notifications,
      subscriptions,
      flags,
      pbTops,
    ] = await exportUserData(userId);
    const u = users[0];

    return {
      exportedAt: Date.now(),
      user: u
        ? {
          id: u.id,
          name: u.name,
          rating: u.rating,
          plays: u.plays,
          locale: u.locale,
          joined: Number(u.created),
          settings: parseSettings(u.settings ?? null),
        }
        : null,
      runs: runs.map((r) => ({
        iteration: r.iteration,
        created: Number(r.created),
        time: r.time,
        daily: !!r.daily,
        void: !!r.void,
        ranked: !!r.ranked,
        pinned: !!r.pinned,
        clientId: r.client_id,
        maze: deserializeRun(r.data),
      })),
      notifications: notifications.map((n) => ({
        iteration: n.iteration,
        kind: n.kind,
        created: Number(n.created),
        readAt: n.read_at == null ? null : Number(n.read_at),
        data: safeJson(n.data),
      })),
      pushSubscriptions: subscriptions.map((s) => ({
        endpoint: s.endpoint,
        created: Number(s.created),
      })),
      // Splits flags per board (see common/splits.ts), decoded to cells.
      flags: flags.map((f) => ({
        iteration: f.iteration,
        cells: deserializeFlags(f.data),
      })),
      // Days whose Discord top-PB post currently names the player as holder.
      pbRecords: pbTops.map((t) => ({
        iteration: t.iteration,
        messageId: t.message_id,
        time: t.top_time == null ? null : Number(t.top_time),
        holders: Number(t.holders),
        announcedAt: t.announced_at == null ? null : Number(t.announced_at),
      })),
    };
  },
);
