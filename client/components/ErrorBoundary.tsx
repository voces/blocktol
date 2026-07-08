import { Component, ComponentChildren, h } from "preact";
import { api } from "../api.ts";

// A render/effect crash anywhere below used to unmount the whole app to a
// blank page with only the console knowing why. Catch it, report it (the
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
    return (
      <div class="crash">
        <div class="crash__card">
          <div class="crash__title">Something broke</div>
          <div class="crash__sub">
            The error has been reported. Reloading usually fixes it — your runs
            are saved on the server.
          </div>
          <button
            type="button"
            class="btn tapc"
            onClick={() => location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
