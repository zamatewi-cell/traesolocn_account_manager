import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Language, Translations } from '../i18n/translations';
import { getTranslations } from '../i18n/translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translations;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('zh');
  const [t, setT] = useState<Translations>(() => getTranslations('zh'));

  useEffect(() => {
    // Load saved language from main process
    const loadLanguage = async () => {
      try {
        const result = await window.electronAPI.app.getLanguage();
        if (result.success && result.data?.language) {
          setLanguageState(result.data.language);
          setT(getTranslations(result.data.language));
        }
      } catch (err) {
        console.warn('Failed to load language setting:', err);
      }
    };
    loadLanguage();
  }, []);

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    setT(getTranslations(lang));
    try {
      await window.electronAPI.app.setLanguage(lang);
    } catch (err) {
      console.warn('Failed to save language setting:', err);
    }
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
