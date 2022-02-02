import { createContext } from "preact";

const defaultTheme = {
  primary: "#1565c0",
  secondary: "#15c065",
};

export const ThemeContext = createContext(defaultTheme);

export type ThemeColor = keyof typeof defaultTheme;
