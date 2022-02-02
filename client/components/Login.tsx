import { useEffect, useState } from "preact/hooks";
import { h } from "preact";
import { Card } from "./Card.tsx";
import { names } from "../util/random/names.ts";
import { Button } from "./Button.tsx";
import { Input } from "./Input.tsx";

export const Login = (
  { onLogin, connected }: {
    onLogin: (username: string) => void;
    connected: boolean;
  },
) => {
  const [value, setValue] = useState("");
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setShowError(true), 1000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <Card style={{ maxWidth: 300, margin: "4px auto" }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.length) {
            onLogin(value);
          } else {
            onLogin(
              names[Math.floor(Math.random() ** 2 * names.length)],
            );
          }
        }}
      >
        <h2 style={{ marginTop: 0 }}>Welcome to mazing contest!</h2>
        <Input
          style={{ display: "block", width: "100%" }}
          placeholder="Username"
          autoFocus
          onInput={(e) => setValue(e.currentTarget.value)}
          value={value}
        />
        <div>
          <Button
            color="secondary"
            style={{ width: "100%", marginTop: 8 }}
            disabled={!connected && showError}
          >
            Play
          </Button>
          {!connected && showError && (
            <div style={{ color: "red" }}>Not connected</div>
          )}
        </div>
      </form>
    </Card>
  );
};
