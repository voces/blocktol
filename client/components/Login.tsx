import { useEffect, useState } from "preact/compat";
import { h } from "preact";
import { Card } from "./Card.tsx";
import { names } from "../util/random/names.ts";
import { Button } from "./Button.tsx";
import { Input } from "./Input.tsx";

const setStoredName = (name: string) => localStorage.setItem("name", name);

const getStoredName = (random = false) => {
  let name = localStorage.getItem("name");
  if (name) return name;

  if (!random) return "";

  name = names[Math.floor(Math.random() ** 2 * names.length)];
  setStoredName(name);

  return name;
};

export const Login = (
  { onLogin, connected }: {
    onLogin: (username: string) => void;
    connected: boolean;
  },
) => {
  const [value, setValue] = useState(getStoredName());
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setShowError(true), 1_000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <Card
      style={{
        width: 300,
        maxWidth: "100%",
        position: "absolute",
        top: "calc(80px + 20%)",
        left: "50%",
        transform: "translate(-50%, -50%)",
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.length) setStoredName(value);
          onLogin(value || getStoredName(true));
        }}
      >
        <h2 style={{ marginTop: 0 }}>Login</h2>
        <Input
          style={{ display: "block", width: "100%" }}
          placeholder="Username"
          autoFocus
          onInput={(e) => setValue(e.currentTarget.value)}
          value={value}
        />
        <div>
          <Button
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
