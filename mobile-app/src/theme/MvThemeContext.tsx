import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { MvTheme, darkTheme, lightTheme } from "./MvColors";

const THEME_KEY = "@personalapp/themeMode";

interface MvThemeContextValue {
  theme: MvTheme;
  isDark: boolean;
  toggleTheme: () => void;
}

const MvThemeContext = createContext<MvThemeContextValue>({
  theme: darkTheme,
  isDark: true,
  toggleTheme: () => {},
});

export function MvThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((saved) => {
      if (saved === "light") setIsDark(false);
      else setIsDark(true);
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      AsyncStorage.setItem(THEME_KEY, next ? "dark" : "light");
      return next;
    });
  }, []);

  const theme = isDark ? darkTheme : lightTheme;
  const value = useMemo(() => ({ theme, isDark, toggleTheme }), [isDark, toggleTheme]);

  return (
    <MvThemeContext.Provider value={value}>
      {children}
    </MvThemeContext.Provider>
  );
}

export function useMvTheme(): MvThemeContextValue {
  return useContext(MvThemeContext);
}
