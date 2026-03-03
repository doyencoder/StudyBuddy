import React, { createContext, useContext, useState } from "react";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "mr", label: "मराठी" },
  { code: "ta", label: "தமிழ்" },
  { code: "te", label: "తెలుగు" },
  { code: "bn", label: "বাংলা" },
  { code: "gu", label: "ગુજરાતી" },
  { code: "kn", label: "ಕನ್ನಡ" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

interface LanguageContextType {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  languageLabel: string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  setLanguage: () => {},
  languageLabel: "English",
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<LanguageCode>("en");
  const languageLabel = LANGUAGES.find((l) => l.code === language)?.label ?? "English";

  return (
    <LanguageContext.Provider value={{ language, setLanguage, languageLabel }}>
      {children}
    </LanguageContext.Provider>
  );
};
