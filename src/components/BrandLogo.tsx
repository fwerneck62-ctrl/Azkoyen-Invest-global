import React from 'react';

export const OFFICIAL_LOGO_PATH = '/assets/aistudio/file_0000000078e4820eb0332c8fba1f3ebe_f4ecc4e3.png';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showWordmark?: boolean;
  subtitle?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showWordmark = true,
  subtitle,
}) => {
  const dim =
    size === 'sm'
      ? 'h-9 w-9'
      : size === 'md'
        ? 'h-11 w-11'
        : size === 'lg'
          ? 'h-16 w-16'
          : 'h-28 w-28';

  const titleClass =
    size === 'sm'
      ? 'text-base tracking-[0.14em]'
      : size === 'md'
        ? 'text-lg tracking-[0.15em]'
        : size === 'lg'
          ? 'text-2xl tracking-[0.16em]'
          : 'text-3xl tracking-[0.18em]';

  return (
    <div className="flex items-center gap-3.5 select-none">
      <div
        className={`${dim} relative shrink-0 rounded-full bg-[#050507] p-0.5 ring-1 ring-[#E11D2E]/45 shadow-[0_0_24px_rgba(225,29,46,0.22)] overflow-hidden`}
      >
        <img
          src={OFFICIAL_LOGO_PATH}
          alt="AZKOYEN INVEST Logomarca Oficial"
          referrerPolicy="no-referrer"
          className="h-full w-full rounded-full object-cover"
        />
      </div>
      {showWordmark && (
        <div className="min-w-0 leading-tight">
          <div className={`font-display font-bold text-white whitespace-nowrap ${titleClass}`}>
            AZKOYEN <span className="text-[#E11D2E]">INVEST</span>
          </div>
          {subtitle && (
            <div className="text-[11px] font-medium text-[#9CA3AF] tracking-wide truncate mt-0.5">
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
