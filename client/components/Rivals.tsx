import { h } from "preact";
import { useEffect, useState } from "preact/compat";
import { avatarColorFromHue, avatarInitial } from "../../common/avatar.ts";
import { fetchRivals, rivals as rivalsSignal } from "../store/rivals.ts";
import type { ProfileData } from "../store/profile.ts";
import { t } from "../util/t.ts";
import { Modal } from "./Modal.tsx";

export type Rival = ProfileData["rivals"][number];
export type Board = "daily" | "pb";

// Which board a record comes from. The two are the standings' own — DAILY (the
// ranked attempts on days both played) and PB (best builds on dailies both
// played) — and a row shows one at a time, never both: a record only reads
// clearly when its pool is named once, at the top.
export const BoardSwitch = (
  { board, onChange }: { board: Board; onChange: (board: Board) => void },
) => (
  <div class="pref__seg" role="group" aria-label={t("profile.headToHead")}>
    {(["daily", "pb"] as const).map((value) => (
      <button
        key={value}
        type="button"
        class={"pref__seg-btn tapc" +
          (board === value ? " pref__seg-btn--active" : "")}
        aria-pressed={board === value}
        onClick={() => onChange(value)}
      >
        {value === "daily" ? t("profile.boardDaily") : t("profile.boardPb")}
      </button>
    ))}
  </div>
);

export const RivalRow = (
  { rival, board }: { rival: Rival; board: Board },
) => {
  const record = rival[board];
  if (!record) return null;
  return (
    <div class="profile-rival">
      <span
        class="profile-rival__avatar"
        style={{ background: avatarColorFromHue(rival.hue) }}
        aria-hidden="true"
      >
        {avatarInitial(rival.name)}
      </span>
      <div class="profile-rival__who">
        <span class="profile-rival__name">{rival.name}</span>
        <span class="profile-rival__sub">
          {board === "daily"
            ? t("profile.metDays", { count: record.met })
            : t("profile.metBoards", { count: record.met })}
        </span>
      </div>
      <div class="profile-rival__nums">
        <span class="profile-rival__record mono">
          <b>{record.won}</b>–<span>{record.lost}</span>
        </span>
        <span class="profile-rival__small mono">
          {t("profile.tied", { count: record.tied })}
        </span>
      </div>
    </div>
  );
};

// How even a rivalry is, weighted by how often the pair meet: a record of
// 36–35 over 74 days outranks 5–0 over 5, and a 61–11 drops below both. It is
// `met - |won - lost|`, which is the meetings left over once the lopsided ones
// are cancelled out — the games that were actually contests.
const closeness = (rival: Rival, board: Board) => {
  const record = rival[board];
  return record ? record.met - Math.abs(record.won - record.lost) : -1;
};

const SearchIcon = () => (
  <svg
    width={15}
    height={15}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={2.2}
    stroke-linecap="round"
    aria-hidden="true"
  >
    <circle cx={10.5} cy={10.5} r={6.5} />
    <path d="m20 20-4.8-4.8" />
  </svg>
);

// The whole head-to-head list, opened from the profile's short one. The full
// set is fetched here rather than riding on boot, so a big field costs nothing
// until someone asks to see it.
export const RivalsSheet = (
  { onBack, onClose }: { onBack: () => void; onClose: () => void },
) => {
  const all = rivalsSignal.value;
  const [board, setBoard] = useState<Board>("daily");
  const [sort, setSort] = useState<"met" | "close">("met");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchRivals();
  }, []);

  const needle = query.trim().toLowerCase();
  const rows = (all ?? [])
    .filter((rival) => rival[board])
    .filter((rival) => rival.name.toLowerCase().includes(needle))
    .sort((a, b) =>
      sort === "met"
        ? (b[board]?.met ?? 0) - (a[board]?.met ?? 0)
        : closeness(b, board) - closeness(a, board)
    );

  return (
    <Modal class="rivals-sheet" onClose={onClose}>
      <div class="move__head">
        <button
          type="button"
          class="modal__icon tapc"
          aria-label={t("a11y.back")}
          onClick={onBack}
        >
          ‹
        </button>
        <span class="move__title">{t("profile.headToHead")}</span>
        <button
          type="button"
          class="modal__icon modal__close-x tapc"
          aria-label={t("a11y.close")}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <label class="rivals__search">
        <SearchIcon />
        <input
          class="rivals__search-input"
          type="search"
          value={query}
          placeholder={t("rivals.search")}
          aria-label={t("rivals.search")}
          autocapitalize="none"
          autocorrect="off"
          autocomplete="off"
          spellcheck={false}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </label>

      <div class="rivals__bar">
        <BoardSwitch board={board} onChange={setBoard} />
        <div class="pref__seg" role="group" aria-label={t("rivals.sort")}>
          {(["met", "close"] as const).map((value) => (
            <button
              key={value}
              type="button"
              class={"pref__seg-btn tapc" +
                (sort === value ? " pref__seg-btn--active" : "")}
              aria-pressed={sort === value}
              onClick={() => setSort(value)}
            >
              {value === "met" ? t("rivals.sortMet") : t("rivals.sortClose")}
            </button>
          ))}
        </div>
      </div>

      <div class="profile-rivals">
        {rows.length
          ? rows.map((rival) => (
            <RivalRow
              key={rival.name + rival.hue}
              rival={rival}
              board={board}
            />
          ))
          : (
            <div class="profile-rivals__empty">
              {all === undefined
                ? t("rivals.loading")
                : needle
                ? t("rivals.noMatch")
                : t("profile.noRivals")}
            </div>
          )}
      </div>
    </Modal>
  );
};
