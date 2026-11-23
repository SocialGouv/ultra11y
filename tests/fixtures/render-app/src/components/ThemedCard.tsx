import { createContext, useContext } from "react";

const ThemeContext = createContext<{ tone: string } | null>(null);

function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used within a ThemeProvider");
  return theme;
}

export function ThemedCard() {
  const { tone } = useTheme();
  return <section className={tone}>Card</section>;
}
