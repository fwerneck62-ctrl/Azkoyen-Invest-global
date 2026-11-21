import {
  validateDocumentForCountry,
  validatePostalCodeForCountry,
  type LocalValidationResult,
} from '../shared/validators.ts';

export interface IdentityVerificationResult extends LocalValidationResult {
  postalValid: boolean;
  entityName?: string;
  registryStatus?: string;
  city?: string;
  stateRegion?: string;
  street?: string;
  verificationSource: 'registry_live' | 'cryptographic_checksum' | 'rejected_by_registry';
  registryMessage?: string;
}

export async function verifyIdentityWithExternalRegistry(params: {
  countryCode: string;
  documentType: string;
  taxId: string;
  postalCode?: string;
}): Promise<IdentityVerificationResult> {
  const cc = (params.countryCode || 'BR').toUpperCase();
  const docType = (params.documentType || '').toUpperCase();
  const base = validateDocumentForCountry(cc, docType, params.taxId);
  const postalValid = validatePostalCodeForCountry(cc, params.postalCode || '');

  const result: IdentityVerificationResult = {
    ...base,
    postalValid,
    verificationSource: 'cryptographic_checksum',
  };

  if (!base.valid) {
    return result;
  }

  // 1. Live Postal Lookup (BR CEP, GB Postcode, or Zippopotam)
  const cleanPostal = (params.postalCode || '').trim();
  if (cleanPostal && postalValid) {
    const postalDigits = cleanPostal.replace(/\D/g, '');
    if (cc === 'BR' && postalDigits.length === 8) {
      try {
        const resp = await fetch(`https://brasilapi.com.br/api/cep/v2/${postalDigits}`, {
          signal: AbortSignal.timeout(3500),
          headers: { 'User-Agent': 'AZKOYEN-INVEST-Compliance/1.0' },
        });
        if (resp.status === 404) {
          result.postalValid = false;
          result.registryMessage = 'CEP não localizado na base dos Correios / BrasilAPI.';
        } else if (resp.ok) {
          const data = (await resp.json()) as Record<string, any>;
          result.city = data.city;
          result.stateRegion = data.state;
          result.street = data.street;
          result.verificationSource = 'registry_live';
        }
      } catch {
        // Fallback to ViaCEP
        try {
          const resp2 = await fetch(`https://viacep.com.br/ws/${postalDigits}/json/`, {
            signal: AbortSignal.timeout(3500),
          });
          if (resp2.ok) {
            const data2 = (await resp2.json()) as Record<string, any>;
            if (data2.erro) {
              result.postalValid = false;
              result.registryMessage = 'CEP inexistente na base ViaCEP.';
            } else {
              result.city = data2.localidade;
              result.stateRegion = data2.uf;
              result.street = data2.logradouro;
              result.verificationSource = 'registry_live';
            }
          }
        } catch {
          // Network unreachable; keep structural validation
        }
      }
    } else if (cc === 'GB') {
      try {
        const pc = encodeURIComponent(cleanPostal.replace(/\s+/g, ''));
        const resp = await fetch(`https://api.postcodes.io/postcodes/${pc}`, {
          signal: AbortSignal.timeout(3500),
        });
        if (resp.status === 404) {
          result.postalValid = false;
          result.registryMessage = 'UK postcode not found in Royal Mail / Postcodes.io.';
        } else if (resp.ok) {
          const data = (await resp.json()) as { result?: Record<string, any> };
          if (data.result) {
            result.city = data.result.admin_district || data.result.parish;
            result.stateRegion = data.result.region || data.result.country;
            result.verificationSource = 'registry_live';
          }
        }
      } catch {
        // ignore timeout
      }
    } else if (['US', 'PT', 'ES', 'DE', 'FR', 'IT', 'MX', 'CA', 'AU', 'CH', 'JP'].includes(cc)) {
      try {
        const zipQuery = cc === 'CA' ? cleanPostal.replace(/\s+/g, '').slice(0, 3) : cleanPostal.split('-')[0].trim();
        const resp = await fetch(
          `https://api.zippopotam.us/${cc.toLowerCase()}/${encodeURIComponent(zipQuery)}`,
          { signal: AbortSignal.timeout(3000) }
        );
        if (resp.ok) {
          const data = (await resp.json()) as { places?: Array<Record<string, string>> };
          const place = data.places?.[0];
          if (place) {
            result.city = place['place name'];
            result.stateRegion = place['state abbreviation'] || place['state'];
            result.verificationSource = 'registry_live';
          }
        }
      } catch {
        // ignore network timeout
      }
    }
  }

  // 2. Live Tax / Corporate Registry Lookups
  // Brazil CNPJ -> BrasilAPI / Receita Federal mirror
  if (cc === 'BR' && base.documentType === 'CNPJ') {
    try {
      const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${base.normalized}`, {
        signal: AbortSignal.timeout(4500),
        headers: { 'User-Agent': 'AZKOYEN-INVEST-Compliance/1.0' },
      });
      if (resp.status === 404) {
        return {
          ...result,
          valid: false,
          verificationSource: 'rejected_by_registry',
          reason: 'CNPJ não encontrado na base oficial da Receita Federal.',
        };
      }
      if (resp.ok) {
        const data = (await resp.json()) as Record<string, any>;
        const sit = String(data.descricao_situacao_cadastral || '').toUpperCase();
        result.entityName = data.razao_social || data.nome_fantasia;
        result.registryStatus = sit || 'CONSULTADO';
        result.city = result.city || data.municipio;
        result.stateRegion = result.stateRegion || data.uf;
        result.verificationSource = 'registry_live';

        if (['BAIXADA', 'INAPTA', 'NULA', 'SUSPENSA'].includes(sit)) {
          return {
            ...result,
            valid: false,
            verificationSource: 'rejected_by_registry',
            reason: `CNPJ consta como ${sit} na Receita Federal.`,
          };
        }
        result.registryMessage = `Receita Federal: ${result.entityName} (${result.registryStatus})`;
      }
    } catch {
      // Fallback to cryptographic validation when external mirror is unavailable
      result.registryMessage = 'Dígito verificador CNPJ validado matematicamente.';
    }
  }

  // European Union VAT / Business Tax Lookup via European Commission VIES
  const euVatCountries: Record<string, string[]> = {
    PT: ['NIPC'],
    ES: ['CIF'],
    DE: ['USTID'],
    FR: ['SIREN'],
    IT: ['PIVA'],
  };
  if (euVatCountries[cc]?.includes(base.documentType)) {
    const vatNumber = base.normalized.startsWith(cc) ? base.normalized.slice(2) : base.normalized;
    try {
      const resp = await fetch(
        `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${cc}/vat/${encodeURIComponent(vatNumber)}`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (resp.ok) {
        const data = (await resp.json()) as { isValid?: boolean; name?: string };
        if (data.isValid) {
          result.entityName = data.name && data.name !== '---' ? data.name : undefined;
          result.registryStatus = 'EU_VIES_ACTIVE';
          result.verificationSource = 'registry_live';
          result.registryMessage = result.entityName
            ? `EU VIES Verified: ${result.entityName}`
            : 'EU VIES VAT active.';
        }
      }
    } catch {
      // keep checksum validation
    }
  }

  return result;
}
