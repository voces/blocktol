import { h } from "preact";
import { useState } from "preact/compat";
import { api } from "../api.ts";
import { clearFreePlay } from "./Game/freePlay.ts";
import { startFreshId } from "../util/id.ts";
import { Modal } from "./Modal.tsx";
import { t, tJsx } from "../util/t.ts";

const TrashIcon = () => (
  <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true">
    <g
      fill="none"
      stroke="var(--lose)"
      stroke-width={1.4}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 4.5h12" />
      <path d="M7 4.5V3h4v1.5" />
      <path d="M4.5 4.5l.8 10a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9l.8-10" />
    </g>
  </svg>
);

// The word the confirm input must match, case-insensitive. A deliberate friction
// step so an account isn't wiped on a stray tap — the button stays disabled until
// it's typed exactly (see the safety note below).
const CONFIRM_WORD = "DELETE";

/**
 * "Delete my data" confirmation sheet. Replaces the profile dialog (not stacked):
 * back (‹) returns to the profile, close (× / backdrop) dismisses to the board.
 *
 * The delete is destructive and irreversible from the player's side — the server
 * severs their runs from their id and rotates it to an anonymous value they can
 * never reach again (see routes/deleteAccount.ts). So the confirm is gated behind
 * typing the word DELETE, and on success we reset this device to a brand-new
 * player (fresh local id + cleared free-play draft) and reload so every store
 * re-boots clean rather than trying to surgically unwind the old identity.
 */
export const DeleteAccount = (
  { onBack, onClose }: { onBack: () => void; onClose: () => void },
) => {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const armed = confirm.trim().toUpperCase() === CONFIRM_WORD && !busy;

  const remove = () => {
    if (!armed) return;
    setBusy(true);
    setFailed(false);
    api.deleteAccount({}).then((r) => {
      if (r && "error" in r) {
        setBusy(false);
        setFailed(true);
        return;
      }
      // The old id now points at an anonymized orphan; start over as a new player
      // and hard-reload so the app boots fresh against the new identity.
      clearFreePlay();
      startFreshId();
      location.href = "/";
    }).catch(() => {
      setBusy(false);
      setFailed(true);
    });
  };

  return (
    <Modal class="delete-sheet" onClose={onClose}>
      <div class="move__head">
        <button
          type="button"
          class="modal__icon tapc"
          aria-label={t("a11y.back")}
          onClick={onBack}
        >
          ‹
        </button>
        <span class="move__title">{t("del.title")}</span>
        <button
          type="button"
          class="modal__icon modal__close-x tapc"
          aria-label={t("a11y.close")}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div class="move__body">
        <p class="move__lead">{t("del.lead")}</p>

        <form
          class="delete-confirm"
          onSubmit={(e) => {
            e.preventDefault();
            remove();
          }}
        >
          <label class="delete-confirm__label" htmlFor="delete-confirm-input">
            {tJsx("del.confirmLabel", {
              word: <b class="mono">{CONFIRM_WORD}</b>,
            })}
          </label>
          <input
            id="delete-confirm-input"
            class="delete-confirm__input"
            value={confirm}
            autoFocus
            autocapitalize="characters"
            autocorrect="off"
            autocomplete="off"
            spellcheck={false}
            placeholder={CONFIRM_WORD}
            onInput={(e) => setConfirm(e.currentTarget.value)}
          />
        </form>

        {failed && (
          <div class="delete-error" role="alert">
            {t("del.error")}
          </div>
        )}

        <button
          type="button"
          class="delete-confirm__btn tapc"
          disabled={!armed}
          onClick={remove}
        >
          {busy ? t("del.deleting") : t("del.deleteBtn")}
        </button>

        <div class="move__safety delete-safety">
          <TrashIcon />
          <div>
            {tJsx("del.moveHint", { move: <b>{t("move.title")}</b> })}
          </div>
        </div>
      </div>
    </Modal>
  );
};
