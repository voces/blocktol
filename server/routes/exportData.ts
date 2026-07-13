import { z } from "zod";
import { parseSettings } from "../../common/settings.ts";
import { exportUserData } from "../db/export.ts";
import { deserializeRun } from "../util/run.ts";
import { method } from "./apiHelpers.ts";

// A stored JSON column (notification payload), parsed defensively — a legacy or
// malformed blob comes back as the raw string rather than throwing the export.
const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

// "Export my data" (GDPR access / portability): everything we hold about the
// caller, as one JSON document the client offers as a download. Authed by the
// header id. The maze blob is deserialized to pieces and the JSON columns are
// parsed so the file is human-readable rather than opaque; push encryption keys
// are omitted (crypto material, not meaningful personal data — the endpoint that
// identifies the subscription is included).
export const exportData = method(z.object({}).optional(), true)(
  async ({ userId }) => {
    const [users, runs, notifications, subscriptions] = await exportUserData(
      userId,
    );
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
    };
  },
);
