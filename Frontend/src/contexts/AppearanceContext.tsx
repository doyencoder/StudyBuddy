import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export type ColorMode = "light" | "auto" | "dark";
export type ChatFont = "default" | "sans" | "system" | "dyslexic";
export type VoiceSetting = "buttery" | "airy" | "mellow" | "glassy" | "rounded";

interface AppearanceContextType {
  colorMode: ColorMode;
  chatFont: ChatFont;
  voice: VoiceSetting;
  setColorMode: (mode: ColorMode) => void;
  setChatFont: (font: ChatFont) => void;
  setVoice: (voice: VoiceSetting) => void;
}

// ── Font class mapping ───────────────────────────────────────────────────────

const FONT_CLASS_MAP: Record<ChatFont, string> = {
  default: "font-default",
  sans: "font-sans-custom",
  system: "font-system",
  dyslexic: "font-dyslexic",
};

// ── Context ──────────────────────────────────────────────────────────────────

const AppearanceContext = createContext<AppearanceContextType>({
  colorMode: "dark",
  chatFont: "default",
  voice: "buttery",
  setColorMode: () => {},
  setChatFont: () => {},
  setVoice: () => {},
});

export const useAppearance = () => useContext(AppearanceContext);

// ── Provider ─────────────────────────────────────────────────────────────────

export const AppearanceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [colorMode, setColorModeState] = useState<ColorMode>(() => {
    return (localStorage.getItem("sb-color-mode") as ColorMode) || "dark";
  });
  const [chatFont, setChatFontState] = useState<ChatFont>(() => {
    return (localStorage.getItem("sb-chat-font") as ChatFont) || "default";
  });
  const [voice, setVoiceState] = useState<VoiceSetting>(() => {
    return (localStorage.getItem("sb-voice") as VoiceSetting) || "buttery";
  });

  // ── Apply color mode ─────────────────────────────────────────────────────

  const applyColorMode = useCallback((mode: ColorMode) => {
    const root = document.documentElement;

    // Remove existing theme classes
    root.classList.remove("light", "dark");

    if (mode === "auto") {
      // Use system preference
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.add(prefersDark ? "dark" : "light");
    } else {
      root.classList.add(mode);
    }
  }, []);

  // ── Apply chat font ──────────────────────────────────────────────────────

  const applyChatFont = useCallback((font: ChatFont) => {
    const body = document.body;
    // Remove all font classes
    Object.values(FONT_CLASS_MAP).forEach((cls) => body.classList.remove(cls));
    // Add new font class
    body.classList.add(FONT_CLASS_MAP[font]);
  }, []);

  // ── Setters (update state + persist + apply) ─────────────────────────────

  const setColorMode = useCallback((mode: ColorMode) => {
    setColorModeState(mode);
    localStorage.setItem("sb-color-mode", mode);
    applyColorMode(mode);
  }, [applyColorMode]);

  const setChatFont = useCallback((font: ChatFont) => {
    setChatFontState(font);
    localStorage.setItem("sb-chat-font", font);
    applyChatFont(font);
  }, [applyChatFont]);

  const setVoice = useCallback((v: VoiceSetting) => {
    setVoiceState(v);
    localStorage.setItem("sb-voice", v);
  }, []);

  // ── Apply on mount ───────────────────────────────────────────────────────

  useEffect(() => {
    applyColorMode(colorMode);
    applyChatFont(chatFont);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Listen for system theme changes when in auto mode ────────────────────

  useEffect(() => {
    if (colorMode !== "auto") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyColorMode("auto");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [colorMode, applyColorMode]);

  return (
    <AppearanceContext.Provider
      value={{ colorMode, chatFont, voice, setColorMode, setChatFont, setVoice }}
    >
      {children}
    </AppearanceContext.Provider>
  );
};
