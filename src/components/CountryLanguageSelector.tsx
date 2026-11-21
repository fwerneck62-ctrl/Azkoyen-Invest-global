import React from 'react';
import { Globe } from 'lucide-react';
import { SUPPORTED_COUNTRIES, LANGUAGE_OPTIONS, type SupportedLang } from '../shared/countries';
import { useLocale } from '../i18n/LocaleContext';

interface CountryLanguageSelectorProps {
  onCountryOrLangChange?: (countryCode: string, lang: SupportedLang) => void;
  compact?: boolean;
}

export const CountryLanguageSelector: React.FC<CountryLanguageSelectorProps> = ({
  onCountryOrLangChange,
  compact = false,
}) => {
  const { countryCode, lang, setCountryCode, setLang, t } = useLocale();

  const handleCountryChange = (nextCode: string) => {
    setCountryCode(nextCode);
    const matched = SUPPORTED_COUNTRIES.find((c) => c.code === nextCode);
    const nextLang = matched ? matched.lang : lang;
    onCountryOrLangChange?.(nextCode, nextLang);
  };

  const handleLangChange = (nextLang: SupportedLang) => {
    setLang(nextLang);
    onCountryOrLangChange?.(countryCode, nextLang);
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0D0F16] border border-white/[0.1] text-xs text-zinc-200">
        <Globe className="w-3.5 h-3.5 text-[#E11D2E] shrink-0" />
        <select
          aria-label={t('countryLabel')}
          value={countryCode}
          onChange={(e) => handleCountryChange(e.target.value)}
          className="bg-transparent text-xs text-white focus:outline-none cursor-pointer pr-1"
        >
          {SUPPORTED_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code} className="bg-[#0C0E15] text-white">
              {c.code} · {c.nativeName}
            </option>
          ))}
        </select>
      </div>

      {!compact && (
        <select
          aria-label={t('languageLabel')}
          value={lang}
          onChange={(e) => handleLangChange(e.target.value as SupportedLang)}
          className="px-2 py-1.5 rounded-lg bg-[#0D0F16] border border-white/[0.1] text-xs text-zinc-200 focus:outline-none cursor-pointer"
        >
          {LANGUAGE_OPTIONS.map((l) => (
            <option key={l.code} value={l.code} className="bg-[#0C0E15] text-white">
              {l.native}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};
