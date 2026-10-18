import { Component, ComponentChildren, h } from "preact";
import { api } from "../api.ts";
import { t } from "../util/t.ts";

// A render/effect crash anywhere below would otherwise unmount the whole app to
// a blank page with only the console knowing why. Catch it, report it (the
// reporter swallows its own failures), and leave the player a way back.
export class ErrorBoundary extends Component<{ children: ComponentChildren }> {
  override state = { failed: false };

  override componentDidCatch(err: unknown) {
    this.setState({ failed: true });
    api.reportClientError({
      message: "render crash",
      data: {
        error: err instanceof Error ? err.stack ?? err.message : String(err),
      },
    }).catch(() => {});
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return <CrashScreen />;
  }
}

// The "something broke — reload" screen. Also what App shows when boot keeps
// getting an error answer (not a dropped connection, which waits on the
// Disconnected overlay instead): the failure has been reported either way.
export const CrashScreen = () => (
  <div class="crash" role="alert">
    <div class="crash__card">
      <div class="crash__title">{t("error.crash.title")}</div>
      <div class="crash__sub">{t("error.crash.body")}</div>
      <button
        type="button"
        class="btn tapc"
        onClick={() => location.reload()}
      >
        {t("error.crash.reload")}
      </button>
    </div>
  </div>
);
