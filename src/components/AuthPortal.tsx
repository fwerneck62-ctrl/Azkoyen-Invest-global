import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Lock,
  UserPlus,
  Briefcase,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  ArrowUpRight,
} from 'lucide-react';
import { BrandLogo, OFFICIAL_LOGO_PATH } from './BrandLogo';
import { CountryLanguageSelector } from './CountryLanguageSelector';
import { GlobalIdentityFields, type IdentityFormState } from './GlobalIdentityFields';
import { useLocale } from '../i18n/LocaleContext';
import { validateDocumentForCountry } from '../shared/validators';
import { apiFetch, setAuthToken } from '../lib/api';
import { formatPctFromBps } from '../lib/format';
import type { User } from '../types';

interface AuthPortalProps {
  onAuthenticated: (token: string, user: User) => void;
}

type AuthMode = 'login' | 'register_investor' | 'register_trader' | 'forgot' | 'verify_email' | 'private_admin_setup';

export const AuthPortal: React.FC<AuthPortalProps> = ({ onAuthenticated }) => {
  const { countryCode, lang, t, formatUsdLocale } = useLocale();
  const isPrivateAdminHash = typeof window !== 'undefined' && window.location.hash.startsWith('#/admin');
  const [mode, setMode] = useState<AuthMode>(isPrivateAdminHash ? 'private_admin_setup' : 'login');
  const [bootstrapStatus, setBootstrapStatus] = useState<{
    hasRealAdmin: boolean;
    hasPasscodeEnv: boolean;
    brlPerUsdRate: number;
  } | null>(null);
  const [catalog, setCatalog] = useState<any[]>([]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [fullName, setFullName] = useState('');
  const [identity, setIdentity] = useState<IdentityFormState>({
    country: countryCode,
    documentType: 'CPF',
    taxId: '',
    phone: '',
    postalCode: '',
    city: '',
    stateRegion: '',
  });
  const [passcode, setPasscode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');

  // Trader onboarding fields
  const [bio, setBio] = useState('');
  const [experienceYears, setExperienceYears] = useState('5');
  const [specialties, setSpecialties] = useState('Arbitragem Quantitativa, Futuros, Câmbio G10');
  const [strategies, setStrategies] = useState('');
  const [credentialsSummary, setCredentialsSummary] = useState('');

  // Verification / Recovery
  const [verifyCode, setVerifyCode] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setIdentity((prev) => (prev.country === countryCode ? prev : { ...prev, country: countryCode }));
  }, [countryCode]);

  useEffect(() => {
    apiFetch('/api/auth/bootstrap-status')
      .then((res) => {
        setBootstrapStatus(res);
        if (window.location.hash.startsWith('#/admin') && res.hasRealAdmin) {
          setMode('login');
        }
      })
      .catch(() => {});

    apiFetch('/api/public/catalog')
      .then((res) => setCatalog(res.products || []))
      .catch(() => {});

    const onHashChange = () => {
      if (window.location.hash.startsWith('#/admin')) {
        setMode('private_admin_setup');
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, mfaCode: mfaRequired ? mfaCode : undefined }),
      });
      if (res.mfaRequired) {
        setMfaRequired(true);
        setInfo(t('mfaInputLabel'));
      } else if (res.token && res.user) {
        setAuthToken(res.token);
        onAuthenticated(res.token, res.user);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent, role: 'investor' | 'trader') => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const localCheck = validateDocumentForCountry(identity.country, identity.documentType, identity.taxId);
    if (!localCheck.valid) {
      setError(localCheck.reason || t('docInvalid'));
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          fullName,
          role,
          country: identity.country,
          preferredLanguage: lang,
          documentType: identity.documentType,
          taxId: identity.taxId,
          phone: identity.phone,
          postalCode: identity.postalCode,
          city: identity.city,
          stateRegion: identity.stateRegion,
          bio,
          experienceYears: Number(experienceYears),
          specialties,
          strategies,
          credentialsSummary,
        }),
      });

      if (res.token && res.user) {
        setAuthToken(res.token);
        onAuthenticated(res.token, res.user);
      } else {
        setInfo(res.message);
        setMode('login');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email, code: verifyCode }),
      });
      setInfo('E-mail confirmed.');
      setMode('login');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setInfo(res.message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, code: resetCode, newPassword }),
      });
      setInfo(res.message);
      setMode('login');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrapAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/bootstrap-admin', {
        method: 'POST',
        body: JSON.stringify({ email, password, fullName, passcode }),
      });
      window.location.hash = '';
      setAuthToken(res.token);
      onAuthenticated(res.token, res.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060609] text-[#F1F3F5] flex flex-col">
      {/* Institutional 3-Zone Top Bar */}
      <header className="h-18 px-4 sm:px-6 lg:px-12 border-b border-white/[0.08] bg-[#07080C]/95 backdrop-blur flex items-center justify-between gap-4 sticky top-0 z-30">
        <BrandLogo size="sm" />

        <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-zinc-400">
          <a href="#estrategias" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            {t('navStrategies')}
          </a>
          <a href="#arquitetura" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            {t('navInfra')}
          </a>
          <button
            type="button"
            onClick={() => setMode('register_trader')}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            {t('navTraderApply')}
          </button>
          <button
            type="button"
            onClick={() => setMode('login')}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            {t('navClientPortal')}
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <CountryLanguageSelector />
          {bootstrapStatus && countryCode === 'BR' && (
            <span className="hidden xl:inline text-xs font-mono tabular-nums text-zinc-400">
              USD/BRL R$ {bootstrapStatus.brlPerUsdRate.toFixed(2)}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setMode('register_investor');
              setError(null);
            }}
            className="hidden sm:inline-flex px-4 py-2 text-xs font-semibold bg-[#E11D2E] hover:bg-[#FF2438] text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {t('openAccount')}
          </button>
        </div>
      </header>

      {/* Main Split Hero & Access Console */}
      <section className="relative overflow-hidden border-b border-white/[0.07] bg-[radial-gradient(circle_at_24%_32%,rgba(225,29,46,0.14),transparent_52%),linear-gradient(180deg,#08090F_0%,#050507_100%)]">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-12 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Brand Focal Presentation */}
          <div className="lg:col-span-7 space-y-8">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-7">
              <div className="relative h-36 w-36 sm:h-44 sm:w-44 shrink-0 rounded-full bg-[#050507] p-1 ring-1 ring-[#E11D2E]/55 shadow-[0_0_70px_rgba(225,29,46,0.28)]">
                <img
                  src={OFFICIAL_LOGO_PATH}
                  alt="AZKOYEN INVEST"
                  referrerPolicy="no-referrer"
                  className="h-full w-full rounded-full object-cover"
                />
              </div>
              <div className="text-center sm:text-left pt-2">
                <div className="text-xs font-medium tracking-[0.2em] text-[#E11D2E] uppercase">
                  {t('heroKicker')}
                </div>
                <h1 className="mt-2 text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-white leading-[1.12]">
                  {t('heroTitle')}
                </h1>
              </div>
            </div>

            <p className="text-base text-zinc-400 max-w-2xl leading-relaxed">
              {t('heroSubtitle')}
            </p>

            <div id="arquitetura" className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 border-t border-white/[0.08]">
              <div>
                <div className="text-xs text-zinc-500">{t('pillar1Label')}</div>
                <div className="text-sm font-semibold text-white mt-1">{t('pillar1Value')}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">{t('pillar2Label')}</div>
                <div className="text-sm font-semibold text-white mt-1">{t('pillar2Value')}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">{t('pillar3Label')}</div>
                <div className="text-sm font-semibold text-white mt-1">{t('pillar3Value')}</div>
              </div>
            </div>
          </div>

          {/* Access Card */}
          <div className="lg:col-span-5 w-full max-w-md mx-auto">
            {mode !== 'private_admin_setup' && (
              <div className="flex items-center gap-1 p-1 bg-[#10121A] border border-white/[0.08] rounded-lg mb-5">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setMfaRequired(false);
                  }}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    mode === 'login' ? 'bg-[#E11D2E] text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {t('tabSignIn')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register_investor');
                    setError(null);
                  }}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    mode === 'register_investor' ? 'bg-[#E11D2E] text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {t('tabInvestor')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register_trader');
                    setError(null);
                  }}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    mode === 'register_trader' ? 'bg-[#E11D2E] text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {t('tabTrader')}
                </button>
              </div>
            )}

            {error && (
              <div className="mb-4 p-3.5 rounded-lg bg-[#E11D2E]/10 border border-[#E11D2E]/40 text-xs text-red-200 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-[#E11D2E] shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {info && (
              <div className="mb-4 p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/35 text-xs text-emerald-200 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{info}</span>
              </div>
            )}

            {/* LOGIN */}
            {mode === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4 bg-[#0C0E15] border border-white/[0.09] rounded-xl p-6 shadow-2xl">
                <div>
                  <h2 className="text-lg font-display font-semibold text-white">{t('loginTitle')}</h2>
                  <p className="text-xs text-zinc-400 mt-1">{t('loginDesc')}</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">{t('emailLabel')}</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-[#E11D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">{t('passwordLabel')}</label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full px-3.5 py-2.5 pr-10 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-[#E11D2E]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mfaRequired && (
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">{t('mfaInputLabel')}</label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      placeholder="000000"
                      className="w-full px-3.5 py-2.5 text-sm font-mono tracking-widest bg-[#06070B] border border-[#E11D2E]/50 rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-[#E11D2E] hover:bg-[#FF2438] disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  <span>{loading ? t('validating') : t('signInBtn')}</span>
                </button>

                <div className="flex items-center justify-between text-xs pt-2 border-t border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setError(null);
                    }}
                    className="text-zinc-400 hover:text-white transition-colors"
                  >
                    {t('forgotPass')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('verify_email');
                      setError(null);
                    }}
                    className="text-zinc-400 hover:text-white transition-colors"
                  >
                    {t('verifyEmailLink')}
                  </button>
                </div>
              </form>
            )}

            {/* INVESTOR REGISTRATION WITH GLOBAL COUNTRY + DOCUMENT VALIDATION */}
            {mode === 'register_investor' && (
              <form
                onSubmit={(e) => handleRegister(e, 'investor')}
                className="space-y-3 bg-[#0C0E15] border border-white/[0.09] rounded-xl p-6 shadow-2xl"
              >
                <div className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-[#E11D2E]" />
                  <h2 className="text-lg font-display font-semibold text-white">{t('regInvestorTitle')}</h2>
                </div>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t('fullNamePlaceholder')}
                  className="w-full px-3.5 py-2 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-[#E11D2E]"
                />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  className="w-full px-3.5 py-2 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-[#E11D2E]"
                />

                <GlobalIdentityFields value={identity} onChange={setIdentity} />

                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('passwordMinPlaceholder')}
                  className="w-full px-3.5 py-2 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-[#E11D2E]"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-[#E11D2E] hover:bg-[#FF2438] text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {loading ? t('registeringBtn') : t('createAccountBtn')}
                </button>
              </form>
            )}

            {/* TRADER ONBOARDING WITH GLOBAL COUNTRY + DOCUMENT VALIDATION */}
            {mode === 'register_trader' && (
              <form
                onSubmit={(e) => handleRegister(e, 'trader')}
                className="space-y-3 bg-[#0C0E15] border border-white/[0.09] rounded-xl p-6 shadow-2xl"
              >
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-[#E11D2E]" />
                  <h2 className="text-lg font-display font-semibold text-white">{t('regTraderTitle')}</h2>
                </div>
                <p className="text-xs text-zinc-400">{t('regTraderDesc')}</p>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t('fullNamePlaceholder')}
                  className="w-full px-3.5 py-2 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('emailPlaceholder')}
                    className="w-full px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                  />
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={experienceYears}
                    onChange={(e) => setExperienceYears(e.target.value)}
                    placeholder="Years exp."
                    className="w-full px-3 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                  />
                </div>

                <GlobalIdentityFields value={identity} onChange={setIdentity} compact />

                <input
                  type="text"
                  required
                  value={specialties}
                  onChange={(e) => setSpecialties(e.target.value)}
                  placeholder="Specialties (FX, Futures, Quant)"
                  className="w-full px-3.5 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                />
                <input
                  type="text"
                  required
                  value={credentialsSummary}
                  onChange={(e) => setCredentialsSummary(e.target.value)}
                  placeholder="CFA / CQF / Certifications"
                  className="w-full px-3.5 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                />
                <textarea
                  rows={2}
                  required
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Bio"
                  className="w-full px-3.5 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                />
                <textarea
                  rows={2}
                  required
                  value={strategies}
                  onChange={(e) => setStrategies(e.target.value)}
                  placeholder="Strategies & Risk"
                  className="w-full px-3.5 py-2 text-xs bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('passwordMinPlaceholder')}
                  className="w-full px-3.5 py-2 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#E11D2E]"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-[#E11D2E] hover:bg-[#FF2438] text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {loading ? t('sendingAppBtn') : t('applyTraderBtn')}
                </button>
              </form>
            )}

            {/* VERIFY EMAIL */}
            {mode === 'verify_email' && (
              <form onSubmit={handleVerifyEmail} className="space-y-4 bg-[#0C0E15] border border-white/[0.09] rounded-xl p-6">
                <h2 className="text-lg font-display font-semibold text-white">{t('verifyEmailLink')}</h2>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  className="w-full px-3.5 py-2.5 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                />
                <input
                  type="text"
                  required
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder="6-digit code"
                  className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                />
                <button type="submit" disabled={loading} className="w-full py-2.5 bg-[#E11D2E] text-white text-sm font-semibold rounded-lg">
                  {t('verifyEmailLink')}
                </button>
              </form>
            )}

            {/* FORGOT / RESET PASSWORD */}
            {mode === 'forgot' && (
              <div className="space-y-4 bg-[#0C0E15] border border-white/[0.09] rounded-xl p-6">
                <h2 className="text-lg font-display font-semibold text-white">{t('forgotPass')}</h2>
                <form onSubmit={handleForgot} className="space-y-3">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('emailPlaceholder')}
                    className="w-full px-3.5 py-2.5 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  />
                  <button type="submit" disabled={loading} className="w-full py-2 bg-[#181B26] hover:bg-[#222635] text-white text-xs font-semibold rounded-lg">
                    Send Reset Code
                  </button>
                </form>
                <form onSubmit={handleResetPassword} className="space-y-3 pt-3 border-t border-white/[0.08]">
                  <input
                    type="text"
                    required
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    placeholder="Code"
                    className="w-full px-3.5 py-2 text-sm font-mono bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t('passwordMinPlaceholder')}
                    className="w-full px-3.5 py-2 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  />
                  <button type="submit" disabled={loading} className="w-full py-2.5 bg-[#E11D2E] text-white text-sm font-semibold rounded-lg">
                    Reset Password
                  </button>
                </form>
              </div>
            )}

            {/* PRIVATE ADMIN SETUP (ONLY ACCESSIBLE VIA #/admin) */}
            {mode === 'private_admin_setup' && (
              <form onSubmit={handleBootstrapAdmin} className="space-y-3.5 bg-[#0C0E15] border border-[#E11D2E]/40 rounded-xl p-6 shadow-2xl">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#E11D2E]" />
                  <h2 className="text-lg font-display font-semibold text-white">Executive Initialization</h2>
                </div>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t('fullNamePlaceholder')}
                  className="w-full px-3.5 py-2.5 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailLabel')}
                  className="w-full px-3.5 py-2.5 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('passwordMinPlaceholder')}
                  className="w-full px-3.5 py-2.5 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                />
                {bootstrapStatus?.hasPasscodeEnv && (
                  <input
                    type="password"
                    required
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="Passcode"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#06070B] border border-white/[0.1] rounded-lg text-white"
                  />
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      window.location.hash = '';
                      setMode('login');
                    }}
                    className="px-4 py-2.5 text-xs bg-[#181B26] text-zinc-300 rounded-lg"
                  >
                    {t('close')}
                  </button>
                  <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-[#E11D2E] text-white text-sm font-semibold rounded-lg">
                    Activate
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Institutional Product Showcase Below Fold */}
      {catalog.length > 0 && (
        <section id="estrategias" className="max-w-7xl mx-auto w-full px-6 lg:px-12 py-14 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-[#E11D2E] tracking-wider uppercase">{t('portfolioKicker')}</div>
              <h2 className="text-2xl font-display font-bold text-white mt-1">{t('portfolioTitle')}</h2>
            </div>
            <p className="text-xs text-zinc-400 max-w-md">{t('portfolioNote')}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {catalog.map((item) => (
              <div
                key={item.id}
                className="rounded-xl bg-[#0C0E15] border border-white/[0.08] overflow-hidden flex flex-col sm:flex-row"
              >
                <div className="sm:w-52 h-48 sm:h-auto relative shrink-0 bg-[#07080C]">
                  <img
                    src={item.image_url}
                    alt={item.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="text-xs text-zinc-400">
                      {item.market} · {t('riskWord')} {item.risk_level}
                    </div>
                    <h3 className="text-lg font-display font-semibold text-white mt-1">{item.name}</h3>
                    <p className="text-xs text-zinc-400 mt-2 line-clamp-2">{item.description}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/[0.07] text-xs font-mono tabular-nums">
                    <div>
                      <div className="text-[11px] font-sans text-zinc-500">{t('targetCycle')}</div>
                      <div className="text-emerald-400 font-semibold">{formatPctFromBps(item.contractual_yield_bps)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-sans text-zinc-500">{t('termLabel')}</div>
                      <div className="text-white">{item.term_days}d</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-sans text-zinc-500">{t('minLabel')}</div>
                      <div className="text-white">{formatUsdLocale(item.min_capital_cents)}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={item.trader_photo || '/src/assets/images/trader_portrait_one_1795271716411.jpg'}
                        alt={item.trader_name}
                        referrerPolicy="no-referrer"
                        className="w-7 h-7 rounded-full object-cover"
                      />
                      <span className="text-xs text-zinc-300 truncate">{item.trader_name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('register_investor');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#E11D2E] hover:text-[#FF2438] whitespace-nowrap"
                    >
                      <span>{t('investAction')}</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Clean Institutional Footer */}
      <footer className="mt-auto border-t border-white/[0.07] py-6 px-6 lg:px-12 text-xs text-zinc-500 flex flex-wrap items-center justify-between gap-4">
        <span>© {new Date().getFullYear()} AZKOYEN INVEST. {t('footerRights')}</span>
        <span>{t('footerTagline')}</span>
      </footer>
    </div>
  );
};
