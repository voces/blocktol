import { useContext } from "preact/hooks";
import { ThemeContext } from "../contexts/Theme.ts";

export const useTheme = () => {
  return useContext(ThemeContext);
};
