import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, ShieldCheck, Loader2 } from 'lucide-react';
import { SUPPORTED_COUNTRIES } from '../shared/countries';
import { validateDocumentForCountry, validatePostalCodeForCountry } from '../shared/validators';
import { useLocale } from '../i18n/LocaleContext';
import { apiFetch } from '../lib/api';

export interface IdentityFormState {
  country: string;
  documentType: string;
  taxId: string;
  phone: string;
  postalCode: string;
  city: string;
  stateRegion: string;
}

interface GlobalIdentityFieldsProps {
  value: IdentityFormState;
  onChange: (next: IdentityFormState) => void;
  compact?: boolean;
}

export const GlobalIdentityFields: React.FC<GlobalIdentityFieldsProps> = ({
  value,
  onChange,
  compact = false,
}) => {
  const { country, setCountryCode, t } = useLocale();
  const [verifying, setVerifying] = useState(false);
  const [remoteResult, setRemoteResult] = useState<{
    valid: boolean;
    postalValid?: boolean;
    entityName?: string;
    registryStatus?: string;
    registryMessage?: string;
    verificationSource?: string;
    reason?: string;
  } | null>(null);

  const selectedSpec =
    SUPPORTED_COUNTRIES.find((c) => c.code === value.country) || country;

  useEffect(() => {
    // Ensure documentType belongs to selected country
    if (!selectedSpec.idTypes.some((d) => d.code === value.documentType)) {
      onChange({
        ...value,
        documentType: selectedSpec.idTypes[0].code,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSpec.code]);

  const localCheck = value.taxId.trim()
    ? validateDocumentForCountry(selectedSpec.code, value.documentType, value.taxId)
    : null;
  const postalOk = validatePostalCodeForCountry(selectedSpec.code, value.postalCode);
  const currentDocSpec =
    selectedSpec.idTypes.find((d) => d.code === value.documentType) || selectedSpec.idTypes[0];

  const handleCountrySelect = (code: string) => {
    const nextSpec = SUPPORTED_COUNTRIES.find((c) => c.code === code) || SUPPORTED_COUNTRIES[0];
    setCountryCode(nextSpec.code);
    setRemoteResult(null);
    onChange({
      ...value,
      country: nextSpec.code,
      documentType: nextSpec.idTypes[0].code,
      taxId: '',
      postalCode: '',
      city: '',
      stateRegion: '',
    });
  };

  const runLiveVerification = async () => {
    if (!value.taxId.trim() && !value.postalCode.trim()) return;
    setVerifying(true);
    try {
      const res = await apiFetch('/api/public/validate-identity', {
        method: 'POST',
        body: JSON.stringify({
          countryCode: selectedSpec.code,
          documentType: value.documentType,
          taxId: value.taxId,
          postalCode: value.postalCode,
        }),
      });
      setRemoteResult(res);
      if (res.formatted || res.city || res.stateRegion) {
        onChange({
          ...value,
          taxId: res.formatted || value.taxId,
          city: res.city || value.city,
          stateRegion: res.stateRegion || value.stateRegion,
        });
      }
    } catch (err: any) {
      setRemoteResult({ valid: false, reason: err.message });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Country selector that translates platform + switches local form fields */}
      <div>
        <label className="block text-[11px] font-medium text-zinc-400 mb-1">
          {t('countryLabel')}
        </label>
        <select
          value={value.country}
          onChange={(e) => handleCountrySelect(e.target.value)}
          className="w-full px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
        >
          {SUPPORTED_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.nativeName} ({c.currency} · {c.dialCode})
            </option>
          ))}
        </select>
      </div>

      {/* Document Type + Tax ID + Verify Button */}
      <div className={compact ? 'space-y-2' : 'grid grid-cols-1 sm:grid-cols-12 gap-2'}>
        <div className={compact ? '' : 'sm:col-span-4'}>
          <label className="block text-[11px] font-medium text-zinc-400 mb-1">
            {t('docTypeLabel')}
          </label>
          <select
            value={value.documentType}
            onChange={(e) => {
              setRemoteResult(null);
              onChange({ ...value, documentType: e.target.value });
            }}
            className="w-full px-2.5 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
          >
            {selectedSpec.idTypes.map((dt) => (
              <option key={dt.code} value={dt.code}>
                {dt.label}
              </option>
            ))}
          </select>
        </div>

        <div className={compact ? '' : 'sm:col-span-8'}>
          <label className="block text-[11px] font-medium text-zinc-400 mb-1">
            {currentDocSpec.label}
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              required
              value={value.taxId}
              onChange={(e) => {
                setRemoteResult(null);
                onChange({ ...value, taxId: e.target.value });
              }}
              onBlur={() => {
                if (value.taxId.trim().length >= 6) runLiveVerification();
              }}
              placeholder={currentDocSpec.placeholder}
              className={`flex-1 px-3 py-2 text-xs font-mono bg-[#06070B] border rounded-lg text-white placeholder-zinc-600 focus:outline-none ${
                localCheck
                  ? localCheck.valid && remoteResult?.valid !== false
                    ? 'border-emerald-500/60'
                    : 'border-[#E11D2E]/70'
                  : 'border-white/[0.1] focus:border-[#E11D2E]'
              }`}
            />
            <button
              type="button"
              onClick={runLiveVerification}
              disabled={verifying || !value.taxId.trim()}
              className="px-2.5 py-2 text-[11px] font-semibold bg-[#181B26] hover:bg-[#232736] disabled:opacity-40 text-zinc-100 rounded-lg whitespace-nowrap flex items-center gap-1"
            >
              {verifying ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ShieldCheck className="w-3 h-3 text-[#E11D2E]" />
              )}
              <span>{verifying ? t('verifyingDoc') : t('verifyDocBtn')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Real-time Checksum & Registry Verification Banner */}
      {(localCheck || remoteResult) && (
        <div
          className={`px-3 py-2 rounded-lg border text-[11px] flex items-start gap-2 ${
            remoteResult?.valid === false || (localCheck && !localCheck.valid)
              ? 'bg-[#E11D2E]/10 border-[#E11D2E]/40 text-red-200'
              : 'bg-emerald-500/10 border-emerald-500/35 text-emerald-200'
          }`}
        >
          {remoteResult?.valid === false || (localCheck && !localCheck.valid) ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-[#E11D2E] shrink-0 mt-0.5" />
              <span>{remoteResult?.reason || localCheck?.reason || t('docInvalid')}</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">
                  {remoteResult?.verificationSource === 'registry_live' && remoteResult?.registryMessage
                    ? remoteResult.registryMessage
                    : t('docValidChecksum')}
                </div>
                {remoteResult?.entityName && (
                  <div className="text-emerald-300/90 mt-0.5">{remoteResult.entityName}</div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Local Phone & Postal Code */}
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="block text-[11px] font-medium text-zinc-400 mb-1">
            {t('phonePlaceholder')} ({selectedSpec.dialCode})
          </label>
          <input
            type="text"
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value })}
            placeholder={`${selectedSpec.dialCode} ${selectedSpec.phonePlaceholder}`}
            className="w-full px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-[#E11D2E]"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-zinc-400 mb-1">
            {selectedSpec.postalLabel}
          </label>
          <input
            type="text"
            value={value.postalCode}
            onChange={(e) => onChange({ ...value, postalCode: e.target.value })}
            onBlur={() => {
              if (value.postalCode.trim().length >= 4) runLiveVerification();
            }}
            placeholder={selectedSpec.postalPlaceholder}
            className={`w-full px-3 py-2 text-xs font-mono bg-[#06070B] border rounded-lg text-white placeholder-zinc-600 focus:outline-none ${
              !postalOk || remoteResult?.postalValid === false
                ? 'border-[#E11D2E]/70'
                : 'border-white/[0.1] focus:border-[#E11D2E]'
            }`}
          />
        </div>
      </div>

      {/* City & State/Region (auto-populated by live lookup when available) */}
      <div className="grid grid-cols-2 gap-2.5">
        <input
          type="text"
          value={value.city}
          onChange={(e) => onChange({ ...value, city: e.target.value })}
          placeholder={selectedSpec.cityLabel}
          className="w-full px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-[#E11D2E]"
        />
        <input
          type="text"
          value={value.stateRegion}
          onChange={(e) => onChange({ ...value, stateRegion: e.target.value })}
          placeholder={selectedSpec.stateLabel}
          className="w-full px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-[#E11D2E]"
        />
      </div>
    </div>
  );
};
