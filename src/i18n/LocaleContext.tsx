import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getCountrySpec, type CountrySpec, type SupportedLang } from '../shared/countries';
import { TRANSLATIONS, STATUS_TRANSLATIONS } from './translations';

interface LocaleContextValue {
  countryCode: string;
  country: CountrySpec;
  lang: SupportedLang;
  setCountryCode: (code: string) => void;
  setLang: (lang: SupportedLang) => void;
  t: (key: string) => string;
  statusLabel: (status?: string | null) => string;
  formatUsdLocale: (cents: number | null | undefined) => string;
  formatDateLocale: (iso: string | null | undefined) => string;
  formatDateTimeLocale: (iso: string | null | undefined) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export const LocaleProvider: React.FC<{
  initialCountry?: string | null;
  initialLang?: string | null;
  children: React.ReactNode;
}> = ({ initialCountry, initialLang, children }) => {
  const [countryCode, setCountryCodeState] = useState<string>(
    (initialCountry || 'BR').toUpperCase()
  );
  const [lang, setLangState] = useState<SupportedLang>(
    ((initialLang as SupportedLang) || getCountrySpec(initialCountry || 'BR').lang)
  );

  const country = getCountrySpec(countryCode);

  useEffect(() => {
    if (initialCountry) {
      const spec = getCountrySpec(initialCountry);
      setCountryCodeState(spec.code);
      if (!initialLang) {
        setLangState(spec.lang);
      }
    }
    if (initialLang && TRANSLATIONS[initialLang as SupportedLang]) {
      setLangState(initialLang as SupportedLang);
    }
  }, [initialCountry, initialLang]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = country.intlLocale;
    }
  }, [country.intlLocale, lang]);

  const setCountryCode = useCallback((code: string) => {
    const spec = getCountrySpec(code);
    setCountryCodeState(spec.code);
    setLangState(spec.lang);
  }, []);

  const setLang = useCallback((nextLang: SupportedLang) => {
    setLangState(nextLang);
  }, []);

  const t = useCallback(
    (key: string): string => {
      return TRANSLATIONS[lang]?.[key] || TRANSLATIONS.en[key] || TRANSLATIONS.pt[key] || key;
    },
    [lang]
  );

  const statusLabel = useCallback(
    (status?: string | null): string => {
      if (!status) return '—';
      return (
        STATUS_TRANSLATIONS[lang]?.[status] ||
        STATUS_TRANSLATIONS.en[status] ||
        STATUS_TRANSLATIONS.pt[status] ||
        status
      );
    },
    [lang]
  );

  const formatUsdLocale = useCallback(
    (cents: number | null | undefined) => {
      const val = (cents || 0) / 100;
      return new Intl.NumberFormat(country.intlLocale || 'en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(val);
    },
    [country.intlLocale]
  );

  const formatDateLocale = useCallback(
    (iso: string | null | undefined) => {
      if (!iso) return '—';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return new Intl.DateTimeFormat(country.intlLocale || 'en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(d);
    },
    [country.intlLocale]
  );

  const formatDateTimeLocale = useCallback(
    (iso: string | null | undefined) => {
      if (!iso) return '—';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return new Intl.DateTimeFormat(country.intlLocale || 'en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    },
    [country.intlLocale]
  );

  return (
    <LocaleContext.Provider
      value={{
        countryCode,
        country,
        lang,
        setCountryCode,
        setLang,
        t,
        statusLabel,
        formatUsdLocale,
        formatDateLocale,
        formatDateTimeLocale,
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
};

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used inside LocaleProvider');
  return ctx;
}
