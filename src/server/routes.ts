import crypto from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import QRCode from 'qrcode';
import {
  db,
  ensureWalletForUser,
  ensureLedgerAccount,
  postDoubleEntryTransaction,
  writeAuditLog,
  createNotification,
  runReconciliation,
  getSetting,
  setSetting,
} from './db.ts';
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  hashToken,
  generateTotpSecret,
  verifyTotpCode,
  buildOtpAuthUri,
  encryptVaultSecret,
  decryptVaultSecret,
  createRateLimiter,
} from './security.ts';
import { broadcastToUser, broadcastToRole, broadcastAll } from './realtime.ts';
import { verifyIdentityWithExternalRegistry } from './identityVerifier.ts';
import {
  getCachedAssetsSnapshot,
  getSymbolSeries,
  isMarketFeedHealthy,
} from './marketFeed.ts';
import { getSelfTradingConfig, openTimedTrade } from './timedTrading.ts';

interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: 'investor' | 'trader' | 'admin';
  admin_tier: string | null;
  email_verified: number;
  kyc_status: string;
  mfa_enabled: number;
  status: string;
  is_demo: number;
  sessionId: string;
}

interface AuthedRequest extends Request {
  authUser?: AuthUser;
}

const authLimiter = createRateLimiter(25, 60_000);
const sensitiveLimiter = createRateLimiter(30, 60_000);

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }
  const token = header.slice('Bearer '.length).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }

  const session = db
    .prepare(
      `SELECT id, user_id, revoked_at, expires_at FROM sessions WHERE id = ? AND token_hash = ?`
    )
    .get(payload.sid, hashToken(token)) as
    | { id: string; user_id: string; revoked_at: string | null; expires_at: string }
    | undefined;

  if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
    return res.status(401).json({ error: 'Sessão revogada ou expirada.' });
  }

  const user = db
    .prepare(
      `SELECT id, email, full_name, role, admin_tier, email_verified, kyc_status, mfa_enabled, status, is_demo
       FROM users WHERE id = ?`
    )
    .get(session.user_id) as Omit<AuthUser, 'sessionId'> | undefined;

  if (!user || user.status === 'suspended') {
    return res.status(403).json({ error: 'Conta suspensa ou inexistente.' });
  }

  req.authUser = { ...user, sessionId: session.id };
  next();
}

function requireRole(...roles: Array<'investor' | 'trader' | 'admin'>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) return res.status(401).json({ error: 'Não autenticado.' });
    if (!roles.includes(req.authUser.role)) {
      return res.status(403).json({ error: 'Permissão insuficiente para este ambiente.' });
    }
    next();
  };
}

function requireAdminTier(...tiers: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser || req.authUser.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso restrito à administração.' });
    }
    if (req.authUser.admin_tier === 'super_admin') return next();
    if (!req.authUser.admin_tier || !tiers.includes(req.authUser.admin_tier)) {
      return res.status(403).json({ error: 'Nível administrativo insuficiente para esta operação.' });
    }
    next();
  };
}

function createSessionForUser(user: { id: string; role: 'investor' | 'trader' | 'admin' }, req: Request, mfaVerified = true) {
  const sid = `SES-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const token = signSessionToken({ sid, uid: user.id, role: user.role, exp });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, mfa_verified, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sid,
    user.id,
    hashToken(token),
    req.ip || req.socket.remoteAddress || 'unknown',
    (req.headers['user-agent'] || 'browser').slice(0, 180),
    mfaVerified ? 1 : 0,
    new Date(exp).toISOString(),
    now
  );
  return token;
}

export function registerRoutes(app: Express) {
  app.get('/api/health', (_req, res) => {
    let dbOk = false;
    try {
      const row = db.prepare(`SELECT 1 AS ok`).get() as { ok: number } | undefined;
      dbOk = row?.ok === 1;
    } catch {
      dbOk = false;
    }
    const feed = isMarketFeedHealthy();
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      platform: 'AZKOYEN INVEST',
      db: dbOk ? 'connected' : 'error',
      marketFeed: feed,
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/public/catalog', (_req, res) => {
    const products = db
      .prepare(
        `SELECT p.id, p.name, p.image_url, p.description, p.strategy, p.market, p.risk_level,
                p.min_capital_cents, p.max_capital_cents, p.contractual_yield_bps, p.term_days, p.maturity_date,
                u.full_name AS trader_name, tp.photo_url AS trader_photo, tp.credentials_summary
         FROM products p
         JOIN users u ON u.id = p.trader_id
         LEFT JOIN trader_profiles tp ON tp.user_id = u.id
         WHERE p.status = 'active' AND p.is_demo = 0
         ORDER BY p.created_at DESC`
      )
      .all();
    res.json({
      products,
      brlPerUsdRate: Number(getSetting('brl_per_usd_rate', '5.78')),
    });
  });

  app.post('/api/public/validate-identity', authLimiter, async (req, res) => {
    try {
      const { countryCode, documentType, taxId, postalCode } = req.body as {
        countryCode?: string;
        documentType?: string;
        taxId?: string;
        postalCode?: string;
      };
      if (!taxId && !postalCode) {
        return res.status(400).json({ error: 'Informe o documento ou código postal para validação.' });
      }
      const verification = await verifyIdentityWithExternalRegistry({
        countryCode: countryCode || 'BR',
        documentType: documentType || 'CPF',
        taxId: taxId || '',
        postalCode: postalCode || '',
      });
      res.json(verification);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Erro ao validar documento.' });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. AUTHENTICATION, BOOTSTRAP, EMAIL VERIFICATION, MFA & SESSIONS
  // ───────────────────────────────────────────────────────────────────────────
  app.get('/api/auth/bootstrap-status', (_req, res) => {
    const adminRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND is_demo = 0`)
      .get() as { cnt: number };
    res.json({
      hasRealAdmin: adminRow.cnt > 0,
      hasPasscodeEnv: Boolean(process.env.ADMIN_BOOTSTRAP_PASSCODE),
      publicFundraisingEnabled: getSetting('public_fundraising_enabled', 'false') === 'true',
      brlPerUsdRate: Number(getSetting('brl_per_usd_rate', '5.78')),
    });
  });

  app.post('/api/auth/bootstrap-admin', authLimiter, (req, res) => {
    try {
      const { email, password, fullName, passcode } = req.body as {
        email?: string;
        password?: string;
        fullName?: string;
        passcode?: string;
      };

      const existing = db
        .prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND is_demo = 0`)
        .get() as { cnt: number };
      if (existing.cnt > 0) {
        return res.status(409).json({ error: 'Administrador principal já configurado.' });
      }

      const envPasscode = process.env.ADMIN_BOOTSTRAP_PASSCODE;
      if (envPasscode && passcode !== envPasscode) {
        return res.status(403).json({ error: 'Código de ativação administrativo inválido.' });
      }

      if (!email || !password || password.length < 8 || !fullName) {
        return res.status(400).json({ error: 'Informe nome, e-mail válido e senha com mínimo de 8 caracteres.' });
      }

      const cleanEmail = email.trim().toLowerCase();
      const id = `ADM-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO users (id, email, password_hash, full_name, role, admin_tier, email_verified, kyc_status, status, is_demo, created_at)
         VALUES (?, ?, ?, ?, 'admin', 'super_admin', 1, 'approved', 'active', 0, ?)`
      ).run(id, cleanEmail, hashPassword(password), fullName.trim(), now);

      writeAuditLog({
        actorId: id,
        actorEmail: cleanEmail,
        actorRole: 'admin',
        action: 'BOOTSTRAP_SUPER_ADMIN',
        entityType: 'user',
        entityId: id,
        ipAddress: req.ip,
      });

      const token = createSessionForUser({ id, role: 'admin' }, req);
      const user = db.prepare(`SELECT id, email, full_name, role, admin_tier, email_verified, kyc_status, mfa_enabled, status, is_demo FROM users WHERE id = ?`).get(id);
      res.status(201).json({ token, user });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Erro ao configurar administrador.' });
    }
  });

  app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
      const {
        email,
        password,
        fullName,
        role,
        taxId,
        documentType,
        phone,
        country,
        preferredLanguage,
        postalCode,
        city,
        stateRegion,
        bio,
        experienceYears,
        specialties,
        strategies,
        credentialsSummary,
      } = req.body as Record<string, any>;

      if (!email || !password || password.length < 8 || !fullName) {
        return res.status(400).json({ error: 'Dados obrigatórios incompletos ou senha menor que 8 caracteres.' });
      }
      const targetCountry = String(country || 'BR').trim().toUpperCase();
      const targetDocType = String(documentType || (targetCountry === 'BR' ? 'CPF' : 'TAX_ID')).trim().toUpperCase();
      const targetLang = String(preferredLanguage || 'pt').trim().toLowerCase();

      if (!taxId || String(taxId).trim().length < 4) {
        return res.status(400).json({ error: 'Documento fiscal/identidade nacional obrigatório para abertura de conta.' });
      }

      // Authoritative mathematical & live registry validation
      const idCheck = await verifyIdentityWithExternalRegistry({
        countryCode: targetCountry,
        documentType: targetDocType,
        taxId: String(taxId),
        postalCode: postalCode ? String(postalCode) : undefined,
      });

      if (!idCheck.valid) {
        return res.status(400).json({ error: idCheck.reason || 'Documento fiscal/identidade inválido para o país selecionado.' });
      }
      if (postalCode && !idCheck.postalValid) {
        return res.status(400).json({ error: idCheck.registryMessage || 'Código postal inválido para o país selecionado.' });
      }

      const targetRole = role === 'trader' ? 'trader' : 'investor';
      const cleanEmail = String(email).trim().toLowerCase();
      const exists = db.prepare(`SELECT id FROM users WHERE email = ?`).get(cleanEmail);
      if (exists) {
        return res.status(409).json({ error: 'Este e-mail já está cadastrado na AZKOYEN INVEST.' });
      }

      const id = `${targetRole === 'trader' ? 'TRD' : 'INV'}-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
      const verificationCode = String(crypto.randomInt(100000, 999999));
      const now = new Date().toISOString();
      const status = targetRole === 'trader' ? 'pending_approval' : 'active';
      const finalCity = city ? String(city).trim() : idCheck.city || null;
      const finalState = stateRegion ? String(stateRegion).trim() : idCheck.stateRegion || null;

      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(
          `INSERT INTO users (id, email, password_hash, full_name, role, email_verified, email_verification_code, kyc_status, tax_id, document_type, phone, country, preferred_language, postal_code, city, state_region, verification_source, status, is_demo, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
        ).run(
          id,
          cleanEmail,
          hashPassword(String(password)),
          String(fullName).trim(),
          targetRole,
          verificationCode,
          idCheck.formatted,
          idCheck.documentType,
          phone ? String(phone).trim() : null,
          targetCountry,
          targetLang,
          postalCode ? String(postalCode).trim() : null,
          finalCity,
          finalState,
          idCheck.verificationSource,
          status,
          now
        );

        ensureWalletForUser(id);

        if (targetRole === 'trader') {
          db.prepare(
            `INSERT INTO trader_profiles (user_id, photo_url, bio, experience_years, specialties_json, strategies, documents_json, credentials_summary, approval_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
          ).run(
            id,
            '/src/assets/images/trader_portrait_one_1795271716411.jpg',
            String(bio || 'Trader profissional candidato à mesa AZKOYEN INVEST.'),
            Number(experienceYears || 3),
            JSON.stringify(Array.isArray(specialties) ? specialties : String(specialties || 'Derivativos').split(',').map((s: string) => s.trim())),
            String(strategies || 'Gestão quantitativa de risco institucional'),
            JSON.stringify([
              {
                name: `${idCheck.documentType} (${targetCountry}) · ${idCheck.verificationSource}`,
                verified: idCheck.valid,
              },
            ]),
            String(credentialsSummary || 'Certificação Profissional Pendente de Análise')
          );

          // Notify admins of new trader application
          const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all() as Array<{ id: string }>;
          for (const adm of admins) {
            createNotification(adm.id, 'Nova Candidatura de Trader', `${fullName} (${cleanEmail} · ${targetCountry}) aguarda análise cadastral.`, 'approval');
          }
          broadcastToRole('admin', 'trader:application', { userId: id, fullName, email: cleanEmail });
        }

        writeAuditLog({
          actorId: id,
          actorEmail: cleanEmail,
          actorRole: targetRole,
          action: 'USER_REGISTERED',
          entityType: 'user',
          entityId: id,
          metadata: { country: targetCountry, documentType: idCheck.documentType, verificationSource: idCheck.verificationSource },
          ipAddress: req.ip,
        });

        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }

      const token = targetRole === 'investor' ? createSessionForUser({ id, role: targetRole }, req) : null;
      const user = db
        .prepare(
          `SELECT id, email, full_name, role, admin_tier, email_verified, kyc_status, tax_id, document_type, phone, country, preferred_language, postal_code, city, state_region, verification_source, mfa_enabled, status, is_demo
           FROM users WHERE id = ?`
        )
        .get(id);

      if (!process.env.SMTP_HOST) {
        console.log(`[AZKOYEN MAIL] Código de verificação para ${cleanEmail}: ${verificationCode}`);
      }

      res.status(201).json({
        user,
        token,
        verificationRequired: targetRole === 'trader',
        identityCheck: idCheck,
        message:
          targetRole === 'trader'
            ? 'Solicitação profissional registrada e encaminhada para análise da mesa administrativa.'
            : 'Conta criada com sucesso. Bem-vindo à AZKOYEN INVEST.',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Erro no cadastro.' });
    }
  });

  app.post('/api/auth/verify-email', authLimiter, (req, res) => {
    const { email, code } = req.body as { email?: string; code?: string };
    if (!email || !code) return res.status(400).json({ error: 'E-mail e código obrigatórios.' });
    const user = db
      .prepare(`SELECT id, email_verification_code FROM users WHERE email = ?`)
      .get(email.trim().toLowerCase()) as { id: string; email_verification_code: string | null } | undefined;

    if (!user || user.email_verification_code !== code.trim()) {
      return res.status(400).json({ error: 'Código de verificação inválido.' });
    }

    db.prepare(`UPDATE users SET email_verified = 1, email_verification_code = NULL WHERE id = ?`).run(user.id);
    writeAuditLog({ actorId: user.id, actorEmail: email, action: 'EMAIL_VERIFIED', entityType: 'user', entityId: user.id });
    res.json({ verified: true });
  });

  app.post('/api/auth/login', authLimiter, (req, res) => {
    const { email, password, mfaCode } = req.body as { email?: string; password?: string; mfaCode?: string };
    if (!email || !password) {
      return res.status(400).json({ error: 'Informe e-mail e senha.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const user = db
      .prepare(
        `SELECT id, email, password_hash, full_name, role, admin_tier, email_verified, kyc_status, tax_id, document_type, phone, country, preferred_language, postal_code, city, state_region, verification_source, mfa_enabled, mfa_secret, status, is_demo
         FROM users WHERE email = ?`
      )
      .get(cleanEmail) as (AuthUser & { password_hash: string; mfa_secret: string | null }) | undefined;

    if (!user || user.is_demo === 1 || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    if (user.status === 'pending_approval') {
      return res.status(403).json({ error: 'Cadastro profissional em análise administrativa.' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Conta suspensa pelo compliance.' });
    }

    if (user.mfa_enabled === 1 && user.mfa_secret) {
      if (!mfaCode) {
        return res.status(200).json({ mfaRequired: true, email: user.email });
      }
      if (!verifyTotpCode(user.mfa_secret, mfaCode)) {
        return res.status(401).json({ error: 'Código MFA (TOTP) inválido.' });
      }
    }

    const token = createSessionForUser({ id: user.id, role: user.role }, req, true);
    writeAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'LOGIN_SUCCESS',
      entityType: 'session',
      ipAddress: req.ip,
    });

    const { password_hash: _ph, mfa_secret: _ms, ...safeUser } = user;
    res.json({ token, user: safeUser });
  });

  app.post('/api/auth/demo-session', authLimiter, (req, res) => {
    const { role } = req.body as { role?: 'investor' | 'trader' | 'admin' };
    const idMap: Record<string, string> = {
      investor: 'DEMO-INVESTOR-001',
      trader: 'DEMO-TRADER-001',
      admin: 'DEMO-ADMIN-001',
    };
    const targetId = idMap[role || 'investor'];
    if (!targetId) return res.status(400).json({ error: 'Perfil demonstrativo inválido.' });

    const user = db
      .prepare(
        `SELECT id, email, full_name, role, admin_tier, email_verified, kyc_status, mfa_enabled, status, is_demo
         FROM users WHERE id = ? AND is_demo = 1`
      )
      .get(targetId) as Omit<AuthUser, 'sessionId'> | undefined;

    if (!user) return res.status(404).json({ error: 'Ambiente de demonstração indisponível.' });
    const token = createSessionForUser({ id: user.id, role: user.role }, req, true);
    res.json({ token, user });
  });

  app.post('/api/auth/forgot-password', authLimiter, (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ error: 'Informe seu e-mail.' });
    const user = db.prepare(`SELECT id, is_demo FROM users WHERE email = ?`).get(email.trim().toLowerCase()) as
      | { id: string; is_demo: number }
      | undefined;
    if (!user || user.is_demo === 1) {
      return res.json({ message: 'Se o e-mail existir, enviamos um código de recuperação.' });
    }
    const resetCode = String(crypto.randomInt(100000, 999999));
    const expires = new Date(Date.now() + 15 * 60_000).toISOString();
    db.prepare(
      `INSERT INTO password_resets (id, user_id, reset_code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(`RST-${crypto.randomUUID().slice(0, 10)}`, user.id, resetCode, expires, new Date().toISOString());

    if (!process.env.SMTP_HOST) {
      console.log(`[AZKOYEN MAIL] Código de recuperação para ${email}: ${resetCode}`);
    }

    res.json({
      message: 'Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.',
    });
  });

  app.post('/api/auth/reset-password', authLimiter, (req, res) => {
    const { email, code, newPassword } = req.body as { email?: string; code?: string; newPassword?: string };
    if (!email || !code || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Informe e-mail, código e nova senha (mín. 8 caracteres).' });
    }
    const user = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email.trim().toLowerCase()) as
      | { id: string }
      | undefined;
    if (!user) return res.status(400).json({ error: 'Solicitação inválida.' });

    const reset = db
      .prepare(
        `SELECT id, expires_at, used_at FROM password_resets WHERE user_id = ? AND reset_code = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(user.id, code.trim()) as { id: string; expires_at: string; used_at: string | null } | undefined;

    if (!reset || reset.used_at || new Date(reset.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Código inválido ou expirado.' });
    }

    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(newPassword), user.id);
      db.prepare(`UPDATE password_resets SET used_at = ? WHERE id = ?`).run(now, reset.id);
      db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ?`).run(now, user.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    writeAuditLog({ actorId: user.id, actorEmail: email, action: 'PASSWORD_RESET', entityType: 'user', entityId: user.id });
    res.json({ message: 'Senha redefinida com sucesso. Faça login novamente.' });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const user = db
      .prepare(
        `SELECT id, email, full_name, role, admin_tier, email_verified, kyc_status, tax_id, document_type, phone, country, preferred_language, postal_code, city, state_region, verification_source, mfa_enabled, status, is_demo, created_at
         FROM users WHERE id = ?`
      )
      .get(req.authUser!.id);
    res.json({ user });
  });

  app.patch('/api/auth/profile', requireAuth, (req: AuthedRequest, res) => {
    const { fullName, phone, country, preferredLanguage, postalCode, city, stateRegion, taxId } = req.body as Record<string, string>;
    db.prepare(
      `UPDATE users
       SET full_name = COALESCE(?, full_name),
           phone = COALESCE(?, phone),
           country = COALESCE(?, country),
           preferred_language = COALESCE(?, preferred_language),
           postal_code = COALESCE(?, postal_code),
           city = COALESCE(?, city),
           state_region = COALESCE(?, state_region),
           tax_id = COALESCE(?, tax_id)
       WHERE id = ?`
    ).run(
      fullName || null,
      phone || null,
      country ? country.toUpperCase() : null,
      preferredLanguage ? preferredLanguage.toLowerCase() : null,
      postalCode || null,
      city || null,
      stateRegion || null,
      taxId || null,
      req.authUser!.id
    );
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      action: 'PROFILE_UPDATED',
      entityType: 'user',
      entityId: req.authUser!.id,
    });
    const updated = db
      .prepare(
        `SELECT id, email, full_name, role, admin_tier, email_verified, kyc_status, tax_id, document_type, phone, country, preferred_language, postal_code, city, state_region, verification_source, mfa_enabled, status, is_demo
         FROM users WHERE id = ?`
      )
      .get(req.authUser!.id);
    res.json({ user: updated });
  });

  app.post('/api/auth/kyc', requireAuth, async (req: AuthedRequest, res) => {
    const { taxId, documentNumber, countryCode, documentType, postalCode, city, stateRegion } = req.body as {
      taxId?: string;
      documentNumber?: string;
      countryCode?: string;
      documentType?: string;
      postalCode?: string;
      city?: string;
      stateRegion?: string;
    };
    if (!taxId || !documentNumber) {
      return res.status(400).json({ error: 'Documento fiscal nacional e número do documento oficial são obrigatórios.' });
    }
    const cc = (countryCode || 'BR').toUpperCase();
    const check = await verifyIdentityWithExternalRegistry({
      countryCode: cc,
      documentType: documentType || (cc === 'BR' ? 'CPF' : 'TAX_ID'),
      taxId,
      postalCode,
    });
    if (!check.valid) {
      return res.status(400).json({ error: check.reason || 'Documento fiscal inválido na validação cadastral.' });
    }
    db.prepare(
      `UPDATE users
       SET tax_id = ?,
           document_type = ?,
           country = ?,
           postal_code = COALESCE(?, postal_code),
           city = COALESCE(?, city),
           state_region = COALESCE(?, state_region),
           verification_source = ?,
           kyc_status = 'submitted'
       WHERE id = ?`
    ).run(
      check.formatted,
      check.documentType,
      cc,
      postalCode || null,
      city || check.city || null,
      stateRegion || check.stateRegion || null,
      check.verificationSource,
      req.authUser!.id
    );
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      action: 'KYC_SUBMITTED',
      entityType: 'user',
      entityId: req.authUser!.id,
      metadata: {
        country: cc,
        documentType: check.documentType,
        verificationSource: check.verificationSource,
        documentNumberMasked: `***${documentNumber.slice(-4)}`,
      },
    });
    broadcastToRole('admin', 'kyc:submitted', { userId: req.authUser!.id, fullName: req.authUser!.full_name });
    const updatedUser = db
      .prepare(
        `SELECT id, email, full_name, role, admin_tier, email_verified, kyc_status, tax_id, document_type, phone, country, preferred_language, postal_code, city, state_region, verification_source, mfa_enabled, status, is_demo
         FROM users WHERE id = ?`
      )
      .get(req.authUser!.id);
    res.json({ kycStatus: 'submitted', identityCheck: check, user: updatedUser });
  });

  app.post('/api/auth/mfa/setup', requireAuth, async (req: AuthedRequest, res) => {
    const secret = generateTotpSecret();
    db.prepare(`UPDATE users SET mfa_secret = ? WHERE id = ?`).run(secret, req.authUser!.id);
    const uri = buildOtpAuthUri(req.authUser!.email, secret);
    const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 200 });
    res.json({ secret, otpauthUri: uri, qrDataUrl });
  });

  app.post('/api/auth/mfa/enable', requireAuth, (req: AuthedRequest, res) => {
    const { code } = req.body as { code?: string };
    const row = db.prepare(`SELECT mfa_secret FROM users WHERE id = ?`).get(req.authUser!.id) as { mfa_secret: string | null };
    if (!row?.mfa_secret || !code || !verifyTotpCode(row.mfa_secret, code)) {
      return res.status(400).json({ error: 'Código TOTP inválido. Verifique seu aplicativo autenticador.' });
    }
    db.prepare(`UPDATE users SET mfa_enabled = 1 WHERE id = ?`).run(req.authUser!.id);
    writeAuditLog({ actorId: req.authUser!.id, actorEmail: req.authUser!.email, action: 'MFA_ENABLED', entityType: 'user', entityId: req.authUser!.id });
    res.json({ mfaEnabled: true });
  });

  app.post('/api/auth/mfa/disable', requireAuth, (req: AuthedRequest, res) => {
    const { code } = req.body as { code?: string };
    const row = db.prepare(`SELECT mfa_secret FROM users WHERE id = ?`).get(req.authUser!.id) as { mfa_secret: string | null };
    if (!row?.mfa_secret || !code || !verifyTotpCode(row.mfa_secret, code)) {
      return res.status(400).json({ error: 'Código TOTP atual obrigatório para desativar MFA.' });
    }
    db.prepare(`UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?`).run(req.authUser!.id);
    writeAuditLog({ actorId: req.authUser!.id, actorEmail: req.authUser!.email, action: 'MFA_DISABLED', entityType: 'user', entityId: req.authUser!.id });
    res.json({ mfaEnabled: false });
  });

  app.get('/api/auth/sessions', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT id, ip_address, user_agent, mfa_verified, expires_at, revoked_at, created_at
         FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
      )
      .all(req.authUser!.id);
    res.json({ sessions: rows, currentSessionId: req.authUser!.sessionId });
  });

  app.delete('/api/auth/sessions/:id', requireAuth, (req: AuthedRequest, res) => {
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?`).run(
      new Date().toISOString(),
      req.params.id,
      req.authUser!.id
    );
    res.json({ revoked: true });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(new Date().toISOString(), req.authUser!.sessionId);
    res.json({ ok: true });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. PUBLIC/AUTHED INVESTMENT PRODUCTS & POOLS CATALOG
  // ───────────────────────────────────────────────────────────────────────────
  app.get('/api/products', requireAuth, (req: AuthedRequest, res) => {
    const showDemo = req.authUser!.is_demo === 1;
    const products = db
      .prepare(
        `SELECT p.*, u.full_name AS trader_name, tp.photo_url AS trader_photo, tp.bio AS trader_bio, tp.experience_years, tp.credentials_summary
         FROM products p
         JOIN users u ON u.id = p.trader_id
         LEFT JOIN trader_profiles tp ON tp.user_id = u.id
         WHERE (? = 1 OR p.is_demo = 0)
         ORDER BY p.created_at DESC`
      )
      .all(showDemo ? 1 : 0);

    const pools = db
      .prepare(
        `SELECT pl.*,
          (SELECT COUNT(*) FROM investments i WHERE i.pool_id = pl.id) AS participant_count,
          (SELECT COUNT(*) FROM manual_operations mo WHERE mo.pool_id = pl.id AND mo.status = 'approved') AS verified_ops_count
         FROM pools pl
         WHERE (? = 1 OR pl.is_demo = 0)
         ORDER BY pl.opened_at DESC`
      )
      .all(showDemo ? 1 : 0);

    const verifiedOps = db
      .prepare(
        `SELECT mo.id, mo.op_code, mo.pool_id, mo.asset, mo.op_type, mo.exchange_venue, mo.net_pnl_cents, mo.executed_at
         FROM manual_operations mo
         JOIN pools pl ON pl.id = mo.pool_id
         WHERE mo.status = 'approved' AND (? = 1 OR pl.is_demo = 0)
         ORDER BY mo.executed_at DESC LIMIT 30`
      )
      .all(showDemo ? 1 : 0);

    res.json({
      products,
      pools,
      verifiedOps,
      publicFundraisingEnabled: getSetting('public_fundraising_enabled', 'false') === 'true',
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. INVESTOR PORTAL & USD WALLET + PIX/USDC DEPOSITS & WITHDRAWALS
  // ───────────────────────────────────────────────────────────────────────────
  app.get('/api/investor/overview', requireAuth, (req: AuthedRequest, res) => {
    const uid = req.authUser!.id;
    ensureWalletForUser(uid);

    const wallet = db.prepare(`SELECT * FROM wallets WHERE user_id = ?`).get(uid) as Record<string, number>;
    const investments = db
      .prepare(
        `SELECT i.*, p.name AS product_name, p.market, p.risk_level, p.contractual_yield_bps, p.term_days, p.redemption_policy, pl.name AS pool_name, pl.status AS pool_status, u.full_name AS trader_name
         FROM investments i
         JOIN products p ON p.id = i.product_id
         JOIN pools pl ON pl.id = i.pool_id
         JOIN users u ON u.id = p.trader_id
         WHERE i.investor_id = ?
         ORDER BY i.invested_at DESC`
      )
      .all(uid);

    const deposits = db
      .prepare(`SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 25`)
      .all(uid);

    const withdrawals = db
      .prepare(`SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 25`)
      .all(uid);

    const transactions = db
      .prepare(
        `SELECT lt.*, (SELECT json_group_array(json_object('account_code', le.account_code, 'debit_cents', le.debit_cents, 'credit_cents', le.credit_cents)) FROM ledger_entries le WHERE le.transaction_id = lt.id) AS entries_json
         FROM ledger_transactions lt
         WHERE lt.user_id = ?
         ORDER BY lt.created_at DESC LIMIT 50`
      )
      .all(uid);

    const notifications = db
      .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`)
      .all(uid);

    const tickets = db
      .prepare(`SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`)
      .all(uid);

    res.json({
      wallet,
      investments,
      deposits,
      withdrawals,
      transactions,
      notifications,
      tickets,
      rates: {
        brlPerUsd: Number(getSetting('brl_per_usd_rate', '5.78')),
        pixFeeBps: Number(getSetting('pix_fee_bps', '45')),
        usdcFeeBps: Number(getSetting('usdc_fee_bps', '25')),
        withdrawalPixFeeBps: Number(getSetting('withdrawal_pix_fee_bps', '60')),
        withdrawalUsdcFeeCents: Number(getSetting('withdrawal_usdc_fee_cents', '250')),
      },
      publicFundraisingEnabled: getSetting('public_fundraising_enabled', 'false') === 'true',
    });
  });

  app.post('/api/investor/invest', requireAuth, sensitiveLimiter, (req: AuthedRequest, res) => {
    try {
      const uid = req.authUser!.id;
      const { poolId, amountUsd } = req.body as { poolId?: string; amountUsd?: number };
      const amountCents = Math.round(Number(amountUsd || 0) * 100);

      if (!poolId || !Number.isInteger(amountCents) || amountCents <= 0) {
        return res.status(400).json({ error: 'Informe um pool válido e valor positivo em USD.' });
      }

      const pool = db
        .prepare(
          `SELECT pl.*, p.name AS product_name, p.min_capital_cents, p.max_capital_cents, p.contractual_yield_bps, p.maturity_date, p.redemption_policy, p.loss_policy, p.contract_terms
           FROM pools pl JOIN products p ON p.id = pl.product_id WHERE pl.id = ?`
        )
        .get(poolId) as Record<string, any> | undefined;

      if (!pool) return res.status(404).json({ error: 'Pool não encontrado.' });

      // Regulatory / Custody Gate
      const publicEnabled = getSetting('public_fundraising_enabled', 'false') === 'true';
      if (pool.is_demo === 0 && !publicEnabled) {
        return res.status(403).json({
          error:
            'Janela de captação indisponível no momento. As alocações estão sujeitas à validação jurídica, regulatória e de custódia institucional.',
        });
      }

      if (pool.status !== 'open' && pool.status !== 'active_trading') {
        return res.status(400).json({ error: 'Este pool não está aberto para novas alocações.' });
      }
      if (amountCents < pool.min_capital_cents || amountCents > pool.max_capital_cents) {
        return res.status(400).json({
          error: `Aporte fora dos limites do produto ($${(pool.min_capital_cents / 100).toFixed(2)} – $${(pool.max_capital_cents / 100).toFixed(2)}).`,
        });
      }
      if (pool.raised_cents + amountCents > pool.max_pool_cents) {
        return res.status(400).json({ error: 'Valor excede o teto máximo de captação do pool.' });
      }

      ensureWalletForUser(uid);
      const wallet = db.prepare(`SELECT available_cents FROM wallets WHERE user_id = ?`).get(uid) as {
        available_cents: number;
      };
      if (wallet.available_cents < amountCents) {
        return res.status(400).json({ error: 'Saldo disponível em USD insuficiente na carteira.' });
      }

      const invId = `INV-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
      const contractCode = `AZK-CTR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const contractualYieldCents = Math.round((amountCents * pool.contractual_yield_bps) / 10000);
      const reserveContribution = Math.round(amountCents * 0.1);
      const operatingContribution = amountCents - reserveContribution;
      const newTotalPool = pool.raised_cents + amountCents;
      const now = new Date().toISOString();

      const snapshot = {
        contractCode,
        investorId: uid,
        investorName: req.authUser!.full_name,
        investorEmail: req.authUser!.email,
        productName: pool.product_name,
        poolName: pool.name,
        principalUsd: amountCents / 100,
        contractualYieldPct: pool.contractual_yield_bps / 100,
        estimatedContractualYieldUsd: contractualYieldCents / 100,
        maturityDate: pool.maturity_date,
        redemptionPolicy: pool.redemption_policy,
        lossPolicy: pool.loss_policy,
        terms: pool.contract_terms,
        issuedAt: now,
        isDemo: pool.is_demo === 1,
        disclaimer:
          'Rentabilidade contratual não configura garantia de lucro operacional. Sujeita à liquidação auditada do pool.',
      };

      postDoubleEntryTransaction({
        idempotencyKey: `INV-${uid}-${poolId}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
        userId: uid,
        txType: 'investment_allocate',
        amountCents,
        originAccount: `LIABILITY_USER_AVAILABLE:${uid}`,
        destinationAccount: `POOL_CAPITAL:${poolId}`,
        externalRef: contractCode,
        description: `Aporte em ${pool.name} (${contractCode})`,
        createdBy: uid,
        legs: [
          {
            accountCode: `LIABILITY_USER_AVAILABLE:${uid}`,
            accountName: `Disponível Investidor ${uid}`,
            accountType: 'liability',
            debitCents: amountCents,
            creditCents: 0,
          },
          {
            accountCode: `LIABILITY_USER_INVESTED:${uid}`,
            accountName: `Investido Investidor ${uid}`,
            accountType: 'liability',
            debitCents: 0,
            creditCents: amountCents,
          },
          {
            accountCode: `POOL_CAPITAL:${poolId}`,
            accountName: `Capital Pool ${poolId}`,
            accountType: 'liability',
            debitCents: 0,
            creditCents: amountCents,
          },
          {
            accountCode: `POOL_OPERATING_ASSET:${poolId}`,
            accountName: `Capital Operacional Alocado ${poolId}`,
            accountType: 'asset',
            debitCents: operatingContribution,
            creditCents: 0,
          },
          {
            accountCode: `POOL_RESERVE:${poolId}`,
            accountName: `Reserva Pool ${poolId}`,
            accountType: 'equity',
            debitCents: reserveContribution,
            creditCents: 0,
          },
        ],
        afterCommit: () => {
          db.prepare(
            `UPDATE wallets
             SET available_cents = available_cents - ?,
                 invested_cents = invested_cents + ?,
                 pending_yield_cents = pending_yield_cents + ?,
                 updated_at = ?
             WHERE user_id = ?`
          ).run(amountCents, amountCents, contractualYieldCents, now, uid);

          db.prepare(
            `UPDATE pools
             SET raised_cents = raised_cents + ?,
                 operational_capital_cents = operational_capital_cents + ?,
                 reserve_cents = reserve_cents + ?,
                 contractual_obligation_cents = contractual_obligation_cents + ?
             WHERE id = ?`
          ).run(amountCents, operatingContribution, reserveContribution, contractualYieldCents, poolId);

          db.prepare(
            `INSERT INTO investments (id, contract_code, investor_id, product_id, pool_id, principal_cents, pool_share_ppm, contractual_yield_cents, realized_yield_cents, status, contract_snapshot_json, invested_at, maturity_date, is_demo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?)`
          ).run(
            invId,
            contractCode,
            uid,
            pool.product_id,
            poolId,
            amountCents,
            Math.round((amountCents / newTotalPool) * 1_000_000),
            contractualYieldCents,
            JSON.stringify(snapshot),
            now,
            pool.maturity_date,
            pool.is_demo
          );

          // Recompute proportional ppm shares for all active investments in this pool
          const allPoolInv = db
            .prepare(`SELECT id, principal_cents FROM investments WHERE pool_id = ?`)
            .all(poolId) as Array<{ id: string; principal_cents: number }>;
          for (const row of allPoolInv) {
            db.prepare(`UPDATE investments SET pool_share_ppm = ? WHERE id = ?`).run(
              Math.round((row.principal_cents / newTotalPool) * 1_000_000),
              row.id
            );
          }

          createNotification(
            uid,
            'Contrato de Investimento Emitido',
            `Participação de $${(amountCents / 100).toFixed(2)} confirmada no pool ${pool.name}. Contrato ${contractCode}.`,
            'investment'
          );
          writeAuditLog({
            actorId: uid,
            actorEmail: req.authUser!.email,
            actorRole: req.authUser!.role,
            action: 'INVESTMENT_ALLOCATED',
            entityType: 'investment',
            entityId: invId,
            metadata: { poolId, amountCents, contractCode },
            ipAddress: req.ip,
          });
        },
      });

      broadcastToUser(uid, 'wallet:updated', { reason: 'investment_allocated' });
      broadcastToRole('admin', 'pool:updated', { poolId });
      res.status(201).json({ investmentId: invId, contractCode, snapshot });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Falha ao alocar investimento.' });
    }
  });

  app.post('/api/investor/deposits', requireAuth, sensitiveLimiter, async (req: AuthedRequest, res) => {
    try {
      const uid = req.authUser!.id;
      const { method, amountInput, network, txHash, idempotencyKey } = req.body as {
        method?: 'PIX' | 'USDC';
        amountInput?: number;
        network?: string;
        txHash?: string;
        idempotencyKey?: string;
      };

      if (!method || !amountInput || Number(amountInput) <= 0) {
        return res.status(400).json({ error: 'Método e valor positivo são obrigatórios.' });
      }

      const publicEnabled = getSetting('public_fundraising_enabled', 'false') === 'true';
      if (req.authUser!.is_demo === 0 && !publicEnabled) {
        return res.status(403).json({
          error:
            'Depósitos temporariamente indisponíveis enquanto a validação jurídica e de custódia institucional estiver em andamento.',
        });
      }

      const idem = idempotencyKey || `DEP-${uid}-${method}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
      const existing = db.prepare(`SELECT * FROM deposits WHERE idempotency_key = ?`).get(idem);
      if (existing) return res.json({ deposit: existing });

      const depId = `DEP-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
      const now = new Date().toISOString();

      if (method === 'PIX') {
        const brlCents = Math.round(Number(amountInput) * 100);
        const fxRate = Number(getSetting('brl_per_usd_rate', '5.78'));
        const feeBps = Number(getSetting('pix_fee_bps', '45'));
        const grossUsdCents = Math.round(brlCents / fxRate);
        const feeCents = Math.round((grossUsdCents * feeBps) / 10000);
        const netUsdCents = Math.max(1, grossUsdCents - feeCents);
        const pixTxid = `AZKPIX${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
        const brCode = `00020126560014BR.GOV.BCB.PIX0134azkoyen-custodia@azkoyeninvest.com5204000053039865406${(brlCents / 100).toFixed(2)}5802BR5914AZKOYEN INVEST6009SAO PAULO62150511${pixTxid}6304A1B2`;
        const qrDataUrl = await QRCode.toDataURL(brCode, { margin: 1, width: 220 });

        db.prepare(
          `INSERT INTO deposits (id, user_id, method, network, gross_brl_cents, fx_rate_brl_per_usd, fee_cents, net_usd_cents, pix_txid, pix_copy_paste, qr_data_url, status, idempotency_key, created_at)
           VALUES (?, ?, 'PIX', 'PIX_BR', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        ).run(depId, uid, brlCents, fxRate, feeCents, netUsdCents, pixTxid, brCode, qrDataUrl, idem, now);
      } else {
        const selectedNet = network || 'ARBITRUM';
        const allowedNetworks: Record<string, string> = {
          ARBITRUM: '0x71C9A8E4B2F904D12C8E4A9B003F4E11A9C28D04',
          POLYGON: '0x71C9A8E4B2F904D12C8E4A9B003F4E11A9C28D04',
          ETHEREUM: '0x71C9A8E4B2F904D12C8E4A9B003F4E11A9C28D04',
          SOLANA: 'AZKoyE7vQmP39xK8nLp2WdR4sT6uYwZ9bN1cF5hJ8mQ',
        };
        const custodyAddr = allowedNetworks[selectedNet];
        if (!custodyAddr) {
          return res.status(400).json({ error: 'Rede USDC não autorizada.' });
        }
        if (txHash) {
          const dupHash = db.prepare(`SELECT id FROM deposits WHERE tx_hash = ?`).get(txHash.trim());
          if (dupHash) {
            return res.status(409).json({ error: 'Hash de transação já registrado (prevenção de duplicidade).' });
          }
        }
        const grossUsdCents = Math.round(Number(amountInput) * 100);
        const feeBps = Number(getSetting('usdc_fee_bps', '25'));
        const feeCents = Math.round((grossUsdCents * feeBps) / 10000);
        const netUsdCents = Math.max(1, grossUsdCents - feeCents);
        const qrDataUrl = await QRCode.toDataURL(custodyAddr, { margin: 1, width: 220 });

        db.prepare(
          `INSERT INTO deposits (id, user_id, method, network, fee_cents, net_usd_cents, usdc_address, tx_hash, confirmations, required_confirmations, qr_data_url, status, idempotency_key, created_at)
           VALUES (?, ?, 'USDC', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
        ).run(
          depId,
          uid,
          selectedNet,
          feeCents,
          netUsdCents,
          custodyAddr,
          txHash ? txHash.trim() : null,
          selectedNet === 'ETHEREUM' ? 12 : 6,
          qrDataUrl,
          txHash ? 'confirming' : 'pending',
          idem,
          now
        );
      }

      const deposit = db.prepare(`SELECT * FROM deposits WHERE id = ?`).get(depId);
      writeAuditLog({
        actorId: uid,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        action: 'DEPOSIT_INITIATED',
        entityType: 'deposit',
        entityId: depId,
      });
      broadcastToRole('admin', 'deposit:updated', { depositId: depId });
      res.status(201).json({ deposit });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Erro ao gerar ordem de depósito.' });
    }
  });

  // Provider Webhook / Sandbox Confirmation Endpoint
  app.post('/api/investor/deposits/:id/confirm', requireAuth, (req: AuthedRequest, res) => {
    const dep = db.prepare(`SELECT * FROM deposits WHERE id = ?`).get(req.params.id) as Record<string, any> | undefined;
    if (!dep) return res.status(404).json({ error: 'Depósito não encontrado.' });

    // Only Admin can confirm real deposits; Demo sandbox users can trigger sandbox webhook confirmation on their own demo deposit
    const isAdmin = req.authUser!.role === 'admin';
    const isDemoSelf = req.authUser!.is_demo === 1 && dep.user_id === req.authUser!.id;
    if (!isAdmin && !isDemoSelf) {
      return res.status(403).json({
        error: 'Confirmação de depósito real exige webhook assinado do provedor ou conciliação administrativa.',
      });
    }

    if (dep.status === 'confirmed') {
      return res.json({ deposit: dep, alreadyConfirmed: true });
    }

    const now = new Date().toISOString();
    const assetAccount = dep.method === 'PIX' ? 'ASSET_PIX_CLEARING' : 'ASSET_USDC_CUSTODY';
    const assetName =
      dep.method === 'PIX' ? 'Conta de Liquidação PIX (BRL -> USD)' : 'Custódia Institucional USDC On-Chain';

    ensureWalletForUser(dep.user_id);

    postDoubleEntryTransaction({
      idempotencyKey: `CONF-DEP-${dep.id}`,
      userId: dep.user_id,
      txType: dep.method === 'PIX' ? 'deposit_pix' : 'deposit_usdc',
      amountCents: dep.net_usd_cents,
      originAccount: assetAccount,
      destinationAccount: `LIABILITY_USER_AVAILABLE:${dep.user_id}`,
      externalRef: dep.pix_txid || dep.tx_hash || dep.id,
      description: `Crédito de depósito ${dep.method} (${dep.network}) conciliado`,
      createdBy: req.authUser!.id,
      legs: [
        {
          accountCode: assetAccount,
          accountName: assetName,
          accountType: 'asset',
          debitCents: dep.net_usd_cents,
          creditCents: 0,
        },
        {
          accountCode: `LIABILITY_USER_AVAILABLE:${dep.user_id}`,
          accountName: `Disponível Investidor ${dep.user_id}`,
          accountType: 'liability',
          debitCents: 0,
          creditCents: dep.net_usd_cents,
        },
      ],
      afterCommit: () => {
        db.prepare(
          `UPDATE deposits SET status = 'confirmed', confirmations = required_confirmations, confirmed_at = ? WHERE id = ?`
        ).run(now, dep.id);
        db.prepare(
          `UPDATE wallets SET available_cents = available_cents + ?, updated_at = ? WHERE user_id = ?`
        ).run(dep.net_usd_cents, now, dep.user_id);
        createNotification(
          dep.user_id,
          'Depósito Confirmado em USD',
          `Crédito líquido de $${(dep.net_usd_cents / 100).toFixed(2)} via ${dep.method} disponível na sua carteira.`,
          'wallet'
        );
        writeAuditLog({
          actorId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: req.authUser!.role,
          action: 'DEPOSIT_CONFIRMED',
          entityType: 'deposit',
          entityId: dep.id,
          metadata: { netUsdCents: dep.net_usd_cents },
        });
      },
    });

    const updated = db.prepare(`SELECT * FROM deposits WHERE id = ?`).get(dep.id);
    broadcastToUser(dep.user_id, 'wallet:updated', { depositId: dep.id });
    broadcastToRole('admin', 'deposit:updated', { depositId: dep.id });
    res.json({ deposit: updated });
  });

  app.post('/api/investor/withdrawals', requireAuth, sensitiveLimiter, (req: AuthedRequest, res) => {
    try {
      const uid = req.authUser!.id;
      const { method, destinationKey, network, amountUsd, mfaCode } = req.body as {
        method?: 'PIX' | 'USDC';
        destinationKey?: string;
        network?: string;
        amountUsd?: number;
        mfaCode?: string;
      };

      const publicEnabled = getSetting('public_fundraising_enabled', 'false') === 'true';
      if (req.authUser!.is_demo === 0 && !publicEnabled) {
        return res.status(403).json({
          error: 'Saques temporariamente indisponíveis durante a validação regulatória e de custódia institucional.',
        });
      }

      if (!method || !destinationKey || !amountUsd || Number(amountUsd) <= 0) {
        return res.status(400).json({ error: 'Informe método, destino válido e valor em USD.' });
      }

      const userSec = db.prepare(`SELECT mfa_enabled, mfa_secret FROM users WHERE id = ?`).get(uid) as {
        mfa_enabled: number;
        mfa_secret: string | null;
      };
      if (userSec.mfa_enabled === 1 && userSec.mfa_secret) {
        if (!mfaCode || !verifyTotpCode(userSec.mfa_secret, mfaCode)) {
          return res.status(401).json({ error: 'Código MFA obrigatório para solicitar saque.' });
        }
      }

      if (method === 'USDC' && !/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(destinationKey.trim())) {
        return res.status(400).json({ error: 'Endereço USDC inválido para a rede selecionada.' });
      }

      const requestedCents = Math.round(Number(amountUsd) * 100);
      const feeCents =
        method === 'PIX'
          ? Math.round((requestedCents * Number(getSetting('withdrawal_pix_fee_bps', '60'))) / 10000)
          : Number(getSetting('withdrawal_usdc_fee_cents', '250'));

      if (requestedCents <= feeCents) {
        return res.status(400).json({ error: 'Valor solicitado deve ser superior à tarifa operacional.' });
      }
      const netPayoutCents = requestedCents - feeCents;

      ensureWalletForUser(uid);
      const wallet = db.prepare(`SELECT available_cents FROM wallets WHERE user_id = ?`).get(uid) as {
        available_cents: number;
      };
      if (wallet.available_cents < requestedCents) {
        return res.status(400).json({ error: 'Saldo disponível insuficiente para reservar o saque.' });
      }

      const wdId = `WD-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
      const now = new Date().toISOString();

      postDoubleEntryTransaction({
        idempotencyKey: `WD-REQ-${wdId}`,
        userId: uid,
        txType: 'withdrawal_request',
        amountCents: requestedCents,
        originAccount: `LIABILITY_USER_AVAILABLE:${uid}`,
        destinationAccount: `LIABILITY_USER_RESERVED:${uid}`,
        externalRef: wdId,
        description: `Reserva de saldo para solicitação de saque ${method} (${wdId})`,
        createdBy: uid,
        legs: [
          {
            accountCode: `LIABILITY_USER_AVAILABLE:${uid}`,
            accountName: `Disponível Investidor ${uid}`,
            accountType: 'liability',
            debitCents: requestedCents,
            creditCents: 0,
          },
          {
            accountCode: `LIABILITY_USER_RESERVED:${uid}`,
            accountName: `Reservado Investidor ${uid}`,
            accountType: 'liability',
            debitCents: 0,
            creditCents: requestedCents,
          },
        ],
        afterCommit: () => {
          db.prepare(
            `UPDATE wallets
             SET available_cents = available_cents - ?,
                 reserved_cents = reserved_cents + ?,
                 updated_at = ?
             WHERE user_id = ?`
          ).run(requestedCents, requestedCents, now, uid);

          db.prepare(
            `INSERT INTO withdrawals (id, user_id, method, destination_key, network, requested_usd_cents, fee_cents, net_payout_cents, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)`
          ).run(wdId, uid, method, destinationKey.trim(), network || (method === 'PIX' ? 'PIX_BR' : 'ARBITRUM'), requestedCents, feeCents, netPayoutCents, now, now);

          writeAuditLog({
            actorId: uid,
            actorEmail: req.authUser!.email,
            actorRole: req.authUser!.role,
            action: 'WITHDRAWAL_REQUESTED',
            entityType: 'withdrawal',
            entityId: wdId,
            metadata: { requestedCents, method },
            ipAddress: req.ip,
          });
        },
      });

      const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all() as Array<{ id: string }>;
      for (const adm of admins) {
        createNotification(adm.id, 'Nova Solicitação de Saque', `${req.authUser!.full_name} solicitou $${(requestedCents / 100).toFixed(2)} via ${method}.`, 'withdrawal');
      }
      broadcastToUser(uid, 'wallet:updated', { withdrawalId: wdId });
      broadcastToRole('admin', 'withdrawal:updated', { withdrawalId: wdId });
      res.status(201).json({ withdrawal: db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(wdId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Erro ao solicitar saque.' });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. SELF-TRADING TIMED OPTIONS & REAL EXCHANGE CONNECTOR
  // ───────────────────────────────────────────────────────────────────────────
  app.get('/api/self-trading/overview', requireAuth, async (req: AuthedRequest, res) => {
    const symbol = String(req.query.symbol || 'BTC-USD').toUpperCase();
    const uid = req.authUser!.id;
    ensureWalletForUser(uid);

    const [series, assets, config] = await Promise.all([
      getSymbolSeries(symbol),
      Promise.resolve(getCachedAssetsSnapshot()),
      Promise.resolve(getSelfTradingConfig()),
    ]);

    const wallet = db.prepare(`SELECT * FROM wallets WHERE user_id = ?`).get(uid);
    const openTrades = db
      .prepare(`SELECT * FROM timed_trades WHERE user_id = ? AND status = 'open' ORDER BY opened_at_ms DESC`)
      .all(uid);
    const settledTrades = db
      .prepare(`SELECT * FROM timed_trades WHERE user_id = ? AND status != 'open' ORDER BY opened_at_ms DESC LIMIT 40`)
      .all(uid);

    res.json({
      symbol,
      assets,
      series,
      config,
      wallet,
      openTrades,
      settledTrades,
    });
  });

  app.get('/api/self-trading/ticks', requireAuth, async (req, res) => {
    const symbol = String(req.query.symbol || 'BTC-USD').toUpperCase();
    const series = await getSymbolSeries(symbol);
    res.json({ ...series, assets: getCachedAssetsSnapshot() });
  });

  app.post('/api/self-trading/trades', requireAuth, sensitiveLimiter, async (req: AuthedRequest, res) => {
    try {
      const { asset, direction, stakeUsd, durationSec } = req.body as {
        asset?: string;
        direction?: 'BUY' | 'SELL';
        stakeUsd?: number;
        durationSec?: number;
      };
      const result = await openTimedTrade({
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        userRole: req.authUser!.role,
        asset: String(asset || 'BTC-USD'),
        direction: direction === 'SELL' ? 'SELL' : 'BUY',
        stakeUsd: Number(stakeUsd),
        durationSec: Number(durationSec),
        ipAddress: req.ip,
      });
      res.status(201).json(result);
    } catch (err: any) {
      const msg = err?.message || 'Erro ao executar operação.';
      const code = msg.includes('indisponível') ? 503 : 400;
      res.status(code).json({ error: msg });
    }
  });

  app.get('/api/self-trading/market', requireAuth, async (req, res) => {
    const symbol = String(req.query.symbol || 'BTC-USD').toUpperCase();
    const series = await getSymbolSeries(symbol);
    res.json({
      symbol,
      source: series.source,
      live: series.live,
      candles: series.candles,
      ticks: series.ticks,
      quote: series.quote,
      notice: series.live
        ? null
        : 'Conectividade externa à exchange indisponível. Nenhuma cotação ou execução está sendo simulada.',
    });
  });

  app.get('/api/self-trading/connections', requireAuth, (req: AuthedRequest, res) => {
    const connections = db
      .prepare(
        `SELECT id, exchange_name, label, api_key_masked, permissions, max_risk_per_trade_bps, status, created_at
         FROM exchange_connections WHERE user_id = ? ORDER BY created_at DESC`
      )
      .all(req.authUser!.id);
    const orders = db
      .prepare(`SELECT * FROM self_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`)
      .all(req.authUser!.id);
    res.json({ connections, orders });
  });

  app.post('/api/self-trading/connections', requireAuth, (req: AuthedRequest, res) => {
    const { exchangeName, label, apiKey, apiSecret, maxRiskBps } = req.body as {
      exchangeName?: 'Binance' | 'Bybit' | 'Coinbase Advanced' | 'Kraken';
      label?: string;
      apiKey?: string;
      apiSecret?: string;
      maxRiskBps?: number;
    };
    if (!exchangeName || !apiKey || !apiSecret || apiKey.length < 10 || apiSecret.length < 10) {
      return res.status(400).json({ error: 'Informe corretora, API Key e API Secret reais válidos.' });
    }
    const id = `EXC-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
    const masked = `${apiKey.slice(0, 4)}••••••••${apiKey.slice(-4)}`;
    db.prepare(
      `INSERT INTO exchange_connections (id, user_id, exchange_name, label, api_key_masked, api_key_encrypted, api_secret_encrypted, max_risk_per_trade_bps, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?)`
    ).run(
      id,
      req.authUser!.id,
      exchangeName,
      label || `${exchangeName} Principal`,
      masked,
      encryptVaultSecret(apiKey.trim()),
      encryptVaultSecret(apiSecret.trim()),
      Number(maxRiskBps || 200),
      new Date().toISOString()
    );
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'EXCHANGE_CONNECTED',
      entityType: 'exchange_connection',
      entityId: id,
      metadata: { exchangeName },
    });
    res.status(201).json({ id, exchangeName, apiKeyMasked: masked });
  });

  app.delete('/api/self-trading/connections/:id', requireAuth, (req: AuthedRequest, res) => {
    db.prepare(`DELETE FROM exchange_connections WHERE id = ? AND user_id = ?`).run(req.params.id, req.authUser!.id);
    res.json({ deleted: true });
  });

  app.post('/api/self-trading/orders', requireAuth, async (req: AuthedRequest, res) => {
    const { connectionId, symbol, side, orderType, quantity, priceUsd, stopLossUsd, takeProfitUsd } = req.body as Record<string, any>;
    const conn = db
      .prepare(`SELECT * FROM exchange_connections WHERE id = ? AND user_id = ?`)
      .get(connectionId, req.authUser!.id) as Record<string, any> | undefined;

    if (!conn) {
      return res.status(400).json({ error: 'Conecte primeiro uma API de corretora real antes de enviar ordens.' });
    }
    if (!symbol || !side || !quantity || Number(quantity) <= 0) {
      return res.status(400).json({ error: 'Parâmetros de ordem inválidos.' });
    }

    // Decrypt credentials strictly on server to dispatch real signed API request
    const apiKey = decryptVaultSecret(conn.api_key_encrypted);
    const apiSecret = decryptVaultSecret(conn.api_secret_encrypted);
    const ts = Date.now().toString();
    const queryStr = `symbol=${encodeURIComponent(String(symbol).replace('-', ''))}&side=${side}&type=${orderType || 'MARKET'}&quantity=${quantity}&timestamp=${ts}`;
    const signature = crypto.createHmac('sha256', apiSecret).update(queryStr).digest('hex');

    try {
      const endpoint =
        conn.exchange_name === 'Binance'
          ? `https://api.binance.com/api/v3/order?${queryStr}&signature=${signature}`
          : null;
      if (!endpoint) {
        return res.status(502).json({
          error: `Despacho direto configurado para API Binance Spot; verifique permissões na corretora ${conn.exchange_name}. Nenhuma ordem foi simulada.`,
        });
      }
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': apiKey },
        signal: AbortSignal.timeout(5000),
      });
      const data = (await resp.json()) as Record<string, any>;
      if (!resp.ok) {
        return res.status(400).json({
          error: `Corretora recusou a ordem (${data.msg || resp.status}). Nenhuma execução simulada foi registrada.`,
        });
      }

      const orderId = `ORD-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
      db.prepare(
        `INSERT INTO self_orders (id, user_id, connection_id, symbol, side, order_type, quantity, price_usd, stop_loss_usd, take_profit_usd, status, exchange_order_id, exchange_response_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        orderId,
        req.authUser!.id,
        conn.id,
        symbol,
        side,
        orderType || 'MARKET',
        Number(quantity),
        Number(priceUsd || 0),
        stopLossUsd ? Number(stopLossUsd) : null,
        takeProfitUsd ? Number(takeProfitUsd) : null,
        String(data.status || 'FILLED'),
        String(data.orderId || ''),
        JSON.stringify(data),
        new Date().toISOString()
      );
      return res.status(201).json({ orderId, exchangeResponse: data });
    } catch {
      return res.status(502).json({
        error: 'Não foi possível comunicar com a API da corretora externa neste ambiente. Execuções simuladas são estritamente proibidas.',
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. TRADER PORTAL & CENTRAL DE OPERAÇÕES MANUAIS
  // ───────────────────────────────────────────────────────────────────────────
  app.get('/api/trader/overview', requireAuth, requireRole('trader', 'admin'), (req: AuthedRequest, res) => {
    const tid = req.authUser!.role === 'admin' && req.query.traderId ? String(req.query.traderId) : req.authUser!.id;
    const profile = db.prepare(`SELECT * FROM trader_profiles WHERE user_id = ?`).get(tid);
    const products = db.prepare(`SELECT * FROM products WHERE trader_id = ?`).all(tid);
    const pools = db.prepare(`SELECT * FROM pools WHERE trader_id = ? ORDER BY opened_at DESC`).all(tid);
    const operations = db
      .prepare(
        `SELECT mo.*, pl.name AS pool_name
         FROM manual_operations mo
         JOIN pools pl ON pl.id = mo.pool_id
         WHERE mo.trader_id = ?
         ORDER BY mo.created_at DESC`
      )
      .all(tid);

    const commissionAccount = db
      .prepare(`SELECT balance_cents FROM ledger_accounts WHERE code = ?`)
      .get(`TRADER_COMMISSION_PAYABLE:${tid}`) as { balance_cents: number } | undefined;

    res.json({
      profile,
      products,
      pools,
      operations,
      accumulatedCommissionsCents: commissionAccount?.balance_cents || 0,
    });
  });

  app.post('/api/trader/operations', requireAuth, requireRole('trader'), (req: AuthedRequest, res) => {
    const tid = req.authUser!.id;
    const {
      poolId,
      asset,
      opType,
      exchangeVenue,
      entryValueUsd,
      exitValueUsd,
      feesUsd,
      evidenceRef,
      notes,
      submitImmediately,
    } = req.body as Record<string, any>;

    const pool = db.prepare(`SELECT * FROM pools WHERE id = ? AND trader_id = ?`).get(poolId, tid) as
      | Record<string, any>
      | undefined;
    if (!pool) return res.status(403).json({ error: 'Pool não encontrado ou não autorizado para este trader.' });
    if (pool.status === 'settled' || pool.status === 'halted') {
      return res.status(400).json({ error: 'Pool encerrado ou bloqueado para novas operações.' });
    }

    const entryCents = Math.round(Number(entryValueUsd || 0) * 100);
    const exitCents = Math.round(Number(exitValueUsd || 0) * 100);
    const feesCents = Math.round(Number(feesUsd || 0) * 100);
    if (entryCents <= 0 || exitCents < 0 || feesCents < 0 || !asset || !evidenceRef) {
      return res.status(400).json({ error: 'Preencha ativo, valores financeiros e comprovante da operação.' });
    }

    const netPnlCents = exitCents - entryCents - feesCents;
    const id = `OP-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
    const opCode = `AZK-OP-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const status = submitImmediately ? 'submitted' : 'draft';
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO manual_operations (id, op_code, pool_id, trader_id, asset, op_type, exchange_venue, entry_value_cents, exit_value_cents, fees_cents, net_pnl_cents, evidence_ref, notes, status, executed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      opCode,
      poolId,
      tid,
      String(asset).toUpperCase(),
      opType || 'LONG',
      exchangeVenue || 'Corretora Externa',
      entryCents,
      exitCents,
      feesCents,
      netPnlCents,
      String(evidenceRef).trim(),
      notes ? String(notes).trim() : null,
      status,
      now,
      now,
      now
    );

    writeAuditLog({
      actorId: tid,
      actorEmail: req.authUser!.email,
      actorRole: 'trader',
      action: status === 'submitted' ? 'OPERATION_SUBMITTED' : 'OPERATION_DRAFTED',
      entityType: 'manual_operation',
      entityId: id,
      metadata: { poolId, opCode, netPnlCents },
    });

    if (status === 'submitted') {
      broadcastToRole('admin', 'operation:submitted', { opId: id, opCode, poolId });
    }

    res.status(201).json({ operation: db.prepare(`SELECT * FROM manual_operations WHERE id = ?`).get(id) });
  });

  app.patch('/api/trader/operations/:id', requireAuth, requireRole('trader'), (req: AuthedRequest, res) => {
    const op = db
      .prepare(`SELECT * FROM manual_operations WHERE id = ? AND trader_id = ?`)
      .get(req.params.id, req.authUser!.id) as Record<string, any> | undefined;

    if (!op) return res.status(404).json({ error: 'Operação não encontrada.' });
    if (op.status === 'approved') {
      return res.status(403).json({
        error:
          'Operações aprovadas são imutáveis. Registre um lançamento de ajuste auditável vinculado a esta operação.',
      });
    }
    if (!['draft', 'adjustment_requested'].includes(op.status)) {
      return res.status(400).json({ error: 'Operação em análise administrativa não pode ser editada.' });
    }

    const { asset, opType, exchangeVenue, entryValueUsd, exitValueUsd, feesUsd, evidenceRef, notes, submit } =
      req.body as Record<string, any>;
    const entryCents = entryValueUsd !== undefined ? Math.round(Number(entryValueUsd) * 100) : op.entry_value_cents;
    const exitCents = exitValueUsd !== undefined ? Math.round(Number(exitValueUsd) * 100) : op.exit_value_cents;
    const feesCents = feesUsd !== undefined ? Math.round(Number(feesUsd) * 100) : op.fees_cents;
    const netPnlCents = exitCents - entryCents - feesCents;
    const nextStatus = submit ? 'submitted' : op.status;

    db.prepare(
      `UPDATE manual_operations
       SET asset = ?, op_type = ?, exchange_venue = ?, entry_value_cents = ?, exit_value_cents = ?, fees_cents = ?, net_pnl_cents = ?, evidence_ref = ?, notes = ?, status = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      asset || op.asset,
      opType || op.op_type,
      exchangeVenue || op.exchange_venue,
      entryCents,
      exitCents,
      feesCents,
      netPnlCents,
      evidenceRef || op.evidence_ref,
      notes ?? op.notes,
      nextStatus,
      new Date().toISOString(),
      op.id
    );

    if (nextStatus === 'submitted') {
      broadcastToRole('admin', 'operation:submitted', { opId: op.id, opCode: op.op_code });
    }
    res.json({ operation: db.prepare(`SELECT * FROM manual_operations WHERE id = ?`).get(op.id) });
  });

  app.post('/api/trader/operations/:id/adjustment', requireAuth, requireRole('trader'), (req: AuthedRequest, res) => {
    const parent = db
      .prepare(`SELECT * FROM manual_operations WHERE id = ? AND trader_id = ? AND status = 'approved'`)
      .get(req.params.id, req.authUser!.id) as Record<string, any> | undefined;
    if (!parent) {
      return res.status(404).json({ error: 'Somente operações já aprovadas permitem lançamento de ajuste.' });
    }

    const { deltaUsd, reason, evidenceRef } = req.body as { deltaUsd?: number; reason?: string; evidenceRef?: string };
    const deltaCents = Math.round(Number(deltaUsd || 0) * 100);
    if (!deltaCents || !reason || !evidenceRef) {
      return res.status(400).json({ error: 'Informe diferença financeira, justificativa e comprovante.' });
    }

    const id = `OP-ADJ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const opCode = `${parent.op_code}-ADJ-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO manual_operations (id, op_code, pool_id, trader_id, asset, op_type, exchange_venue, entry_value_cents, exit_value_cents, fees_cents, net_pnl_cents, evidence_ref, notes, status, parent_op_id, executed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, 'submitted', ?, ?, ?, ?)`
    ).run(
      id,
      opCode,
      parent.pool_id,
      req.authUser!.id,
      parent.asset,
      parent.op_type,
      parent.exchange_venue,
      deltaCents,
      deltaCents,
      evidenceRef,
      `[AJUSTE AUDITÁVEL de ${parent.op_code}] ${reason}`,
      parent.id,
      now,
      now,
      now
    );

    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: 'trader',
      action: 'OPERATION_ADJUSTMENT_CREATED',
      entityType: 'manual_operation',
      entityId: id,
      metadata: { parentOpId: parent.id, deltaCents },
    });
    broadcastToRole('admin', 'operation:submitted', { opId: id, opCode });
    res.status(201).json({ operation: db.prepare(`SELECT * FROM manual_operations WHERE id = ?`).get(id) });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. NOTIFICATIONS & SUPPORT (INVESTOR / TRADER)
  // ───────────────────────────────────────────────────────────────────────────
  app.post('/api/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    db.prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?`).run(
      new Date().toISOString(),
      req.params.id,
      req.authUser!.id
    );
    res.json({ ok: true });
  });

  app.post('/api/support/tickets', requireAuth, (req: AuthedRequest, res) => {
    const { subject, category, message } = req.body as { subject?: string; category?: string; message?: string };
    if (!subject || !message) return res.status(400).json({ error: 'Assunto e mensagem obrigatórios.' });
    const id = `TKT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO support_tickets (id, user_id, subject, category, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`
    ).run(id, req.authUser!.id, subject.trim(), category || 'Geral', message.trim(), now, now);
    broadcastToRole('admin', 'support:new', { ticketId: id });
    res.status(201).json({ ticket: db.prepare(`SELECT * FROM support_tickets WHERE id = ?`).get(id) });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. FULL 23-MODULE ADMIN PANEL
  // ───────────────────────────────────────────────────────────────────────────
  app.get('/api/admin/overview', requireAuth, requireRole('admin'), (_req, res) => {
    const users = db
      .prepare(
        `SELECT id, email, full_name, role, admin_tier, email_verified, kyc_status, tax_id, document_type, phone, country, preferred_language, postal_code, city, state_region, verification_source, mfa_enabled, status, is_demo, created_at
         FROM users ORDER BY created_at DESC`
      )
      .all();
    const traderApps = db
      .prepare(
        `SELECT tp.*, u.email, u.full_name, u.status, u.is_demo, u.created_at
         FROM trader_profiles tp JOIN users u ON u.id = tp.user_id ORDER BY u.created_at DESC`
      )
      .all();
    const wallets = db
      .prepare(
        `SELECT w.*, u.full_name, u.email, u.is_demo FROM wallets w JOIN users u ON u.id = w.user_id ORDER BY w.available_cents + w.invested_cents DESC`
      )
      .all();
    const products = db
      .prepare(
        `SELECT p.*, u.full_name AS trader_name,
                tp.profit_share_bps AS trader_profile_profit_bps,
                tp.commission_fee_bps AS trader_profile_commission_bps
         FROM products p
         JOIN users u ON u.id = p.trader_id
         LEFT JOIN trader_profiles tp ON tp.user_id = u.id
         ORDER BY p.created_at DESC`
      )
      .all();
    const pools = db
      .prepare(
        `SELECT pl.*, p.name AS product_name,
                p.commission_fee_bps AS product_commission_fee_bps,
                tp.commission_fee_bps AS trader_commission_fee_bps,
                u.full_name AS trader_name
         FROM pools pl
         JOIN products p ON p.id = pl.product_id
         JOIN users u ON u.id = pl.trader_id
         LEFT JOIN trader_profiles tp ON tp.user_id = pl.trader_id
         ORDER BY pl.opened_at DESC`
      )
      .all();
    const investments = db
      .prepare(
        `SELECT i.*, u.full_name AS investor_name, u.email AS investor_email, p.name AS product_name, pl.name AS pool_name
         FROM investments i JOIN users u ON u.id = i.investor_id JOIN products p ON p.id = i.product_id JOIN pools pl ON pl.id = i.pool_id
         ORDER BY i.invested_at DESC`
      )
      .all();
    const operations = db
      .prepare(
        `SELECT mo.*, u.full_name AS trader_name, pl.name AS pool_name
         FROM manual_operations mo JOIN users u ON u.id = mo.trader_id JOIN pools pl ON pl.id = mo.pool_id
         ORDER BY mo.created_at DESC`
      )
      .all();
    const deposits = db
      .prepare(
        `SELECT d.*, u.full_name AS user_name, u.email AS user_email
         FROM deposits d JOIN users u ON u.id = d.user_id ORDER BY d.created_at DESC LIMIT 100`
      )
      .all();
    const withdrawals = db
      .prepare(
        `SELECT w.*, u.full_name AS user_name, u.email AS user_email
         FROM withdrawals w JOIN users u ON u.id = w.user_id ORDER BY w.created_at DESC LIMIT 100`
      )
      .all();
    const ledgerAccounts = db.prepare(`SELECT * FROM ledger_accounts ORDER BY account_type, code`).all();
    const ledgerTransactions = db
      .prepare(`SELECT * FROM ledger_transactions ORDER BY created_at DESC LIMIT 100`)
      .all();
    const auditLogs = db.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 120`).all();
    const sessions = db
      .prepare(
        `SELECT s.id, s.user_id, u.email, u.role, s.ip_address, s.user_agent, s.expires_at, s.revoked_at, s.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 50`
      )
      .all();
    const tickets = db
      .prepare(
        `SELECT t.*, u.full_name, u.email FROM support_tickets t JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC`
      )
      .all();
    const timedTrades = db
      .prepare(
        `SELECT tt.*, u.full_name AS user_name, u.email AS user_email
         FROM timed_trades tt JOIN users u ON u.id = tt.user_id
         ORDER BY tt.opened_at_ms DESC LIMIT 120`
      )
      .all();
    const settingsRows = db.prepare(`SELECT key, value, updated_at FROM platform_settings`).all() as Array<{
      key: string;
      value: string;
    }>;
    const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
    const reconciliation = runReconciliation();

    res.json({
      users,
      traderApps,
      wallets,
      products,
      pools,
      investments,
      operations,
      deposits,
      withdrawals,
      timedTrades,
      ledgerAccounts,
      ledgerTransactions,
      auditLogs,
      sessions,
      tickets,
      settings,
      reconciliation,
    });
  });

  app.post('/api/admin/traders/:id/review', requireAuth, requireAdminTier('compliance_admin', 'ops_admin'), (req: AuthedRequest, res) => {
    const { decision } = req.body as { decision?: 'approved' | 'rejected' };
    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Decisão inválida.' });
    }
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE trader_profiles SET approval_status = ?, approved_by = ?, approved_at = ? WHERE user_id = ?`
      ).run(decision, req.authUser!.id, now, req.params.id);
      db.prepare(
        `UPDATE users SET status = ?, kyc_status = ? WHERE id = ? AND role = 'trader'`
      ).run(decision === 'approved' ? 'active' : 'suspended', decision === 'approved' ? 'approved' : 'rejected', req.params.id);
      writeAuditLog({
        actorId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: 'admin',
        action: `TRADER_${decision.toUpperCase()}`,
        entityType: 'user',
        entityId: req.params.id,
      });
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true });
  });

  app.patch('/api/admin/traders/:id/compensation', requireAuth, requireAdminTier('ops_admin', 'finance_admin', 'compliance_admin'), (req: AuthedRequest, res) => {
    const traderId = req.params.id;
    const { profitSharePct, commissionFeePct, applyToProductsAndPools } = req.body as {
      profitSharePct?: number;
      commissionFeePct?: number;
      applyToProductsAndPools?: boolean;
    };

    const existing = db.prepare(`SELECT * FROM trader_profiles WHERE user_id = ?`).get(traderId) as Record<string, any> | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Perfil do trader não encontrado.' });
    }

    const nextProfitPct = profitSharePct !== undefined ? Number(profitSharePct) : existing.profit_share_bps / 100;
    const nextCommPct = commissionFeePct !== undefined ? Number(commissionFeePct) : existing.commission_fee_bps / 100;

    if (!Number.isFinite(nextProfitPct) || nextProfitPct < 0 || nextProfitPct > 80) {
      return res.status(400).json({ error: 'Porcentagem de lucro do trader deve estar entre 0% e 80%.' });
    }
    if (!Number.isFinite(nextCommPct) || nextCommPct < 0 || nextCommPct > 50) {
      return res.status(400).json({ error: 'Taxa de comissão deve estar entre 0% e 50%.' });
    }

    const profitShareBps = Math.round(nextProfitPct * 100);
    const commissionFeeBps = Math.round(nextCommPct * 100);
    const investorShareBps = 10000 - profitShareBps;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE trader_profiles SET profit_share_bps = ?, commission_fee_bps = ? WHERE user_id = ?`
      ).run(profitShareBps, commissionFeeBps, traderId);

      if (applyToProductsAndPools) {
        db.prepare(
          `UPDATE products SET trader_share_bps = ?, commission_fee_bps = ? WHERE trader_id = ? AND status != 'closed'`
        ).run(profitShareBps, commissionFeeBps, traderId);

        db.prepare(
          `UPDATE pools SET trader_share_bps = ?, investor_share_bps = ? WHERE trader_id = ? AND status != 'settled'`
        ).run(profitShareBps, investorShareBps, traderId);
      }

      writeAuditLog({
        actorId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: 'admin',
        action: 'TRADER_COMPENSATION_UPDATED',
        entityType: 'trader_profile',
        entityId: traderId,
        metadata: { profitShareBps, commissionFeeBps, applyToProductsAndPools: Boolean(applyToProductsAndPools) },
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    createNotification(
      traderId,
      'Parâmetros de Remuneração Atualizados',
      `Sua participação nos lucros foi ajustada para ${(profitShareBps / 100).toFixed(2)}% com taxa de comissão da mesa em ${(commissionFeeBps / 100).toFixed(2)}%.`,
      'commission'
    );
    broadcastToUser(traderId, 'trader:compensation_updated', { profitShareBps, commissionFeeBps });
    broadcastToRole('admin', 'pool:updated', { traderId });
    res.json({ ok: true, profitShareBps, commissionFeeBps });
  });

  app.patch('/api/admin/users/:id', requireAuth, requireAdminTier('compliance_admin', 'super_admin'), (req: AuthedRequest, res) => {
    const { status, kycStatus } = req.body as { status?: string; kycStatus?: string };
    db.prepare(
      `UPDATE users SET status = COALESCE(?, status), kyc_status = COALESCE(?, kyc_status) WHERE id = ?`
    ).run(status || null, kycStatus || null, req.params.id);
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'USER_STATUS_UPDATED',
      entityType: 'user',
      entityId: req.params.id,
      metadata: { status, kycStatus },
    });
    res.json({ ok: true });
  });

  app.post('/api/admin/admins', requireAuth, requireAdminTier('super_admin'), (req: AuthedRequest, res) => {
    const { email, password, fullName, adminTier } = req.body as Record<string, string>;
    if (!email || !password || password.length < 8 || !fullName || !adminTier) {
      return res.status(400).json({ error: 'Preencha todos os campos do administrador (senha mín. 8 caracteres).' });
    }
    const id = `ADM-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
    db.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, role, admin_tier, email_verified, kyc_status, status, is_demo, created_at)
       VALUES (?, ?, ?, ?, 'admin', ?, 1, 'approved', 'active', 0, ?)`
    ).run(id, email.trim().toLowerCase(), hashPassword(password), fullName.trim(), adminTier, new Date().toISOString());

    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'ADMIN_CREATED',
      entityType: 'user',
      entityId: id,
      metadata: { adminTier },
    });
    res.status(201).json({ id });
  });

  app.post('/api/admin/products', requireAuth, requireAdminTier('ops_admin', 'finance_admin'), (req: AuthedRequest, res) => {
    const b = req.body as Record<string, any>;
    if (!b.name || !b.traderId || !b.strategy || !b.market) {
      return res.status(400).json({ error: 'Nome, trader responsável, estratégia e mercado são obrigatórios.' });
    }
    const traderProf = db
      .prepare(`SELECT profit_share_bps, commission_fee_bps FROM trader_profiles WHERE user_id = ?`)
      .get(b.traderId) as { profit_share_bps: number; commission_fee_bps: number } | undefined;

    const termDays = Math.max(1, Math.min(3650, Math.round(Number(b.termDays || 90))));
    const maturityDate = b.maturityDate || new Date(Date.now() + termDays * 86400_000).toISOString().slice(0, 10);
    const minCapCents = Math.max(100, Math.round(Number(b.minCapitalUsd || 1000) * 100));
    const maxCapCents = Math.max(minCapCents, Math.round(Number(b.maxCapitalUsd || 100000) * 100));
    const contractualYieldBps = Math.max(0, Math.min(20000, Math.round(Number(b.contractualYieldPct ?? 3.5) * 100)));

    const rawTraderSharePct =
      b.traderSharePct !== undefined && b.traderSharePct !== ''
        ? Number(b.traderSharePct)
        : (traderProf?.profit_share_bps ?? Number(getSetting('default_trader_share_bps', '500'))) / 100;
    const rawCommFeePct =
      b.commissionFeePct !== undefined && b.commissionFeePct !== ''
        ? Number(b.commissionFeePct)
        : (traderProf?.commission_fee_bps ?? Number(getSetting('platform_commission_fee_bps', '0'))) / 100;

    if (!Number.isFinite(rawTraderSharePct) || rawTraderSharePct < 0 || rawTraderSharePct > 80) {
      return res.status(400).json({ error: 'Comissão do trader deve estar entre 0% e 80%.' });
    }
    if (!Number.isFinite(rawCommFeePct) || rawCommFeePct < 0 || rawCommFeePct > 50) {
      return res.status(400).json({ error: 'Taxa de comissão deve estar entre 0% e 50%.' });
    }

    const traderShareBps = Math.round(rawTraderSharePct * 100);
    const commissionFeeBps = Math.round(rawCommFeePct * 100);
    const earlyPenaltyBps =
      b.earlyPenaltyPct !== undefined
        ? Math.max(0, Math.min(5000, Math.round(Number(b.earlyPenaltyPct) * 100)))
        : Math.max(0, Math.min(5000, Number(b.earlyPenaltyBps || 500)));

    const id = `PROD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    db.prepare(
      `INSERT INTO products (id, name, image_url, description, trader_id, strategy, market, risk_level, min_capital_cents, max_capital_cents, contractual_yield_bps, term_days, maturity_date, redemption_policy, loss_policy, early_redemption_allowed, early_redemption_penalty_bps, contract_terms, trader_share_bps, commission_fee_bps, status, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?)`
    ).run(
      id,
      String(b.name).trim(),
      b.imageUrl || '/src/assets/images/product_quant_alpha_1795271716510.jpg',
      b.description || 'Produto institucional estruturado AZKOYEN INVEST.',
      b.traderId,
      String(b.strategy).trim(),
      String(b.market).trim(),
      b.riskLevel || 'Moderado',
      minCapCents,
      maxCapCents,
      contractualYieldBps,
      termDays,
      maturityDate,
      b.redemptionPolicy || 'Resgate programado no vencimento após liquidação auditada.',
      b.lossPolicy || 'Segregação integral de pool e reserva de contingência.',
      b.earlyRedemptionAllowed ? 1 : 0,
      earlyPenaltyBps,
      b.contractTerms || 'Instrumento Particular de Participação em Pool Segregado AZKOYEN INVEST.',
      traderShareBps,
      commissionFeeBps,
      new Date().toISOString()
    );
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'PRODUCT_CREATED',
      entityType: 'product',
      entityId: id,
      metadata: { contractualYieldBps, termDays, traderShareBps, commissionFeeBps },
    });
    res.status(201).json({ id });
  });

  app.patch('/api/admin/products/:id', requireAuth, requireAdminTier('ops_admin', 'finance_admin'), (req: AuthedRequest, res) => {
    const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id) as Record<string, any> | undefined;
    if (!product) return res.status(404).json({ error: 'Produto não encontrado.' });

    const b = req.body as Record<string, any>;
    const nextName = b.name !== undefined ? String(b.name).trim() : product.name;
    const nextTraderId = b.traderId !== undefined ? String(b.traderId) : product.trader_id;
    const nextStrategy = b.strategy !== undefined ? String(b.strategy).trim() : product.strategy;
    const nextMarket = b.market !== undefined ? String(b.market).trim() : product.market;
    const nextRisk = b.riskLevel !== undefined ? String(b.riskLevel) : product.risk_level;
    const nextDesc = b.description !== undefined ? String(b.description).trim() : product.description;

    const nextYieldBps =
      b.contractualYieldPct !== undefined
        ? Math.max(0, Math.min(20000, Math.round(Number(b.contractualYieldPct) * 100)))
        : product.contractual_yield_bps;
    const nextTermDays =
      b.termDays !== undefined
        ? Math.max(1, Math.min(3650, Math.round(Number(b.termDays))))
        : product.term_days;
    const nextMaturityDate =
      b.maturityDate !== undefined && String(b.maturityDate).trim()
        ? String(b.maturityDate).trim()
        : b.termDays !== undefined
          ? new Date(Date.now() + nextTermDays * 86400_000).toISOString().slice(0, 10)
          : product.maturity_date;

    const nextMinCapCents =
      b.minCapitalUsd !== undefined
        ? Math.max(100, Math.round(Number(b.minCapitalUsd) * 100))
        : product.min_capital_cents;
    const nextMaxCapCents =
      b.maxCapitalUsd !== undefined
        ? Math.max(nextMinCapCents, Math.round(Number(b.maxCapitalUsd) * 100))
        : Math.max(nextMinCapCents, product.max_capital_cents);

    const nextTraderSharePct =
      b.traderSharePct !== undefined ? Number(b.traderSharePct) : (product.trader_share_bps ?? 500) / 100;
    const nextCommFeePct =
      b.commissionFeePct !== undefined ? Number(b.commissionFeePct) : (product.commission_fee_bps ?? 0) / 100;

    if (!Number.isFinite(nextTraderSharePct) || nextTraderSharePct < 0 || nextTraderSharePct > 80) {
      return res.status(400).json({ error: 'Comissão do trader deve estar entre 0% e 80%.' });
    }
    if (!Number.isFinite(nextCommFeePct) || nextCommFeePct < 0 || nextCommFeePct > 50) {
      return res.status(400).json({ error: 'Taxa de comissão deve estar entre 0% e 50%.' });
    }

    const nextTraderShareBps = Math.round(nextTraderSharePct * 100);
    const nextCommFeeBps = Math.round(nextCommFeePct * 100);
    const nextEarlyAllowed =
      b.earlyRedemptionAllowed !== undefined
        ? b.earlyRedemptionAllowed
          ? 1
          : 0
        : product.early_redemption_allowed;
    const nextEarlyPenaltyBps =
      b.earlyPenaltyPct !== undefined
        ? Math.max(0, Math.min(5000, Math.round(Number(b.earlyPenaltyPct) * 100)))
        : product.early_redemption_penalty_bps;
    const nextRedemptionPolicy =
      b.redemptionPolicy !== undefined ? String(b.redemptionPolicy).trim() : product.redemption_policy;
    const nextLossPolicy = b.lossPolicy !== undefined ? String(b.lossPolicy).trim() : product.loss_policy;
    const nextContractTerms = b.contractTerms !== undefined ? String(b.contractTerms).trim() : product.contract_terms;
    const nextStatus = b.status !== undefined ? String(b.status) : product.status;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE products
         SET name = ?, trader_id = ?, strategy = ?, market = ?, risk_level = ?, description = ?,
             min_capital_cents = ?, max_capital_cents = ?, contractual_yield_bps = ?,
             term_days = ?, maturity_date = ?, redemption_policy = ?, loss_policy = ?,
             early_redemption_allowed = ?, early_redemption_penalty_bps = ?, contract_terms = ?,
             trader_share_bps = ?, commission_fee_bps = ?, status = ?
         WHERE id = ?`
      ).run(
        nextName,
        nextTraderId,
        nextStrategy,
        nextMarket,
        nextRisk,
        nextDesc,
        nextMinCapCents,
        nextMaxCapCents,
        nextYieldBps,
        nextTermDays,
        nextMaturityDate,
        nextRedemptionPolicy,
        nextLossPolicy,
        nextEarlyAllowed,
        nextEarlyPenaltyBps,
        nextContractTerms,
        nextTraderShareBps,
        nextCommFeeBps,
        nextStatus,
        product.id
      );

      if (b.syncPools) {
        db.prepare(
          `UPDATE pools
           SET trader_id = ?, trader_share_bps = ?, investor_share_bps = ?, closes_at = ?
           WHERE product_id = ? AND status != 'settled'`
        ).run(nextTraderId, nextTraderShareBps, 10000 - nextTraderShareBps, nextMaturityDate, product.id);
      }

      writeAuditLog({
        actorId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        action: 'PRODUCT_UPDATED',
        entityType: 'product',
        entityId: product.id,
        metadata: {
          contractualYieldBps: nextYieldBps,
          termDays: nextTermDays,
          traderShareBps: nextTraderShareBps,
          commissionFeeBps: nextCommFeeBps,
          status: nextStatus,
          syncPools: Boolean(b.syncPools),
        },
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    broadcastAll('catalog:updated', { productId: product.id });
    res.json({ ok: true });
  });

  app.post('/api/admin/pools', requireAuth, requireAdminTier('ops_admin', 'finance_admin'), (req: AuthedRequest, res) => {
    const b = req.body as Record<string, any>;
    const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(b.productId) as Record<string, any> | undefined;
    if (!product) return res.status(404).json({ error: 'Produto não encontrado.' });

    const assignedTraderId = b.traderId || product.trader_id;
    const traderProf = db
      .prepare(`SELECT profit_share_bps FROM trader_profiles WHERE user_id = ?`)
      .get(assignedTraderId) as { profit_share_bps: number } | undefined;

    let trdShare: number;
    if (b.traderSharePct !== undefined && b.traderSharePct !== '') {
      const pct = Number(b.traderSharePct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 80) {
        return res.status(400).json({ error: 'Porcentagem de lucro do trader deve estar entre 0% e 80%.' });
      }
      trdShare = Math.round(pct * 100);
    } else if (b.investorSharePct !== undefined && b.investorSharePct !== '') {
      const invPct = Number(b.investorSharePct);
      if (!Number.isFinite(invPct) || invPct < 20 || invPct > 100) {
        return res.status(400).json({ error: 'Participação do investidor deve estar entre 20% e 100%.' });
      }
      trdShare = 10000 - Math.round(invPct * 100);
    } else {
      trdShare = product.trader_share_bps ?? traderProf?.profit_share_bps ?? 500;
    }

    const invShare = 10000 - trdShare;
    const minPoolCents = Math.max(100, Math.round(Number(b.minPoolUsd || 10000) * 100));
    const maxPoolCents = Math.max(minPoolCents, Math.round(Number(b.maxPoolUsd || 250000) * 100));

    const id = `POOL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO pools (id, product_id, name, trader_id, min_pool_cents, max_pool_cents, investor_share_bps, trader_share_bps, status, opened_at, closes_at, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
    ).run(
      id,
      product.id,
      b.name || `${product.name} · Pool`,
      assignedTraderId,
      minPoolCents,
      maxPoolCents,
      invShare,
      trdShare,
      now,
      b.closesAt || product.maturity_date,
      product.is_demo
    );
    ensureLedgerAccount(`POOL_CAPITAL:${id}`, `Capital Pool ${id}`, 'liability');
    ensureLedgerAccount(`POOL_RESERVE:${id}`, `Reserva Pool ${id}`, 'equity');
    ensureLedgerAccount(`POOL_PNL:${id}`, `Resultado Realizado Pool ${id}`, 'revenue');

    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'POOL_CREATED',
      entityType: 'pool',
      entityId: id,
      metadata: { invShare, trdShare },
    });
    res.status(201).json({ id });
  });

  app.patch('/api/admin/pools/:id', requireAuth, requireAdminTier('ops_admin', 'finance_admin'), (req: AuthedRequest, res) => {
    const pool = db.prepare(`SELECT * FROM pools WHERE id = ?`).get(req.params.id) as Record<string, any> | undefined;
    if (!pool) return res.status(404).json({ error: 'Pool não encontrado.' });

    const { status, investorSharePct, traderSharePct, minPoolUsd, maxPoolUsd, closesAt, name, traderId } = req.body as {
      status?: string;
      investorSharePct?: number;
      traderSharePct?: number;
      minPoolUsd?: number;
      maxPoolUsd?: number;
      closesAt?: string;
      name?: string;
      traderId?: string;
    };

    if (traderSharePct !== undefined) {
      const trdPct = Number(traderSharePct);
      if (!Number.isFinite(trdPct) || trdPct < 0 || trdPct > 80) {
        return res.status(400).json({ error: 'Porcentagem de lucro do trader deve estar entre 0% e 80%.' });
      }
      const trdBps = Math.round(trdPct * 100);
      db.prepare(`UPDATE pools SET investor_share_bps = ?, trader_share_bps = ? WHERE id = ?`).run(
        10000 - trdBps,
        trdBps,
        req.params.id
      );
    } else if (investorSharePct !== undefined) {
      const invPct = Number(investorSharePct);
      if (!Number.isFinite(invPct) || invPct < 20 || invPct > 100) {
        return res.status(400).json({ error: 'Participação do investidor deve estar entre 20% e 100%.' });
      }
      const invBps = Math.round(invPct * 100);
      db.prepare(`UPDATE pools SET investor_share_bps = ?, trader_share_bps = ? WHERE id = ?`).run(
        invBps,
        10000 - invBps,
        req.params.id
      );
    }

    const nextMinCents = minPoolUsd !== undefined ? Math.max(100, Math.round(Number(minPoolUsd) * 100)) : pool.min_pool_cents;
    const nextMaxCents = maxPoolUsd !== undefined ? Math.max(nextMinCents, Math.round(Number(maxPoolUsd) * 100)) : pool.max_pool_cents;

    db.prepare(
      `UPDATE pools
       SET status = COALESCE(?, status),
           name = COALESCE(?, name),
           trader_id = COALESCE(?, trader_id),
           closes_at = COALESCE(?, closes_at),
           min_pool_cents = ?,
           max_pool_cents = ?
       WHERE id = ?`
    ).run(
      status || null,
      name ? String(name).trim() : null,
      traderId || null,
      closesAt || null,
      nextMinCents,
      nextMaxCents,
      req.params.id
    );

    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'POOL_UPDATED',
      entityType: 'pool',
      entityId: req.params.id,
      metadata: { status, investorSharePct, traderSharePct, minPoolUsd, maxPoolUsd, closesAt },
    });
    broadcastAll('pool:updated', { poolId: req.params.id });
    res.json({ ok: true });
  });

  app.post('/api/admin/operations/:id/review', requireAuth, requireAdminTier('ops_admin', 'finance_admin'), (req: AuthedRequest, res) => {
    const { decision, reviewNotes } = req.body as {
      decision?: 'approved' | 'rejected' | 'adjustment_requested' | 'in_review';
      reviewNotes?: string;
    };
    const op = db.prepare(`SELECT * FROM manual_operations WHERE id = ?`).get(req.params.id) as Record<string, any> | undefined;
    if (!op) return res.status(404).json({ error: 'Operação não encontrada.' });
    if (op.status === 'approved') {
      return res.status(400).json({ error: 'Esta operação já foi aprovada e contabilizada.' });
    }
    if (!decision) return res.status(400).json({ error: 'Decisão obrigatória.' });

    const now = new Date().toISOString();
    if (decision === 'approved') {
      const absPnl = Math.abs(op.net_pnl_cents);
      if (absPnl > 0) {
        const isProfit = op.net_pnl_cents > 0;
        postDoubleEntryTransaction({
          idempotencyKey: `OP-APPR-${op.id}`,
          userId: op.trader_id,
          txType: 'operation_pnl',
          amountCents: absPnl,
          originAccount: isProfit ? `POOL_OPERATING_ASSET:${op.pool_id}` : `POOL_PNL:${op.pool_id}`,
          destinationAccount: isProfit ? `POOL_PNL:${op.pool_id}` : `POOL_OPERATING_ASSET:${op.pool_id}`,
          externalRef: op.op_code,
          description: `Apuração de resultado aprovado (${op.op_code})`,
          createdBy: req.authUser!.id,
          legs: isProfit
            ? [
                {
                  accountCode: `POOL_OPERATING_ASSET:${op.pool_id}`,
                  accountName: `Capital Operacional Alocado ${op.pool_id}`,
                  accountType: 'asset',
                  debitCents: absPnl,
                  creditCents: 0,
                },
                {
                  accountCode: `POOL_PNL:${op.pool_id}`,
                  accountName: `Resultado Realizado Pool ${op.pool_id}`,
                  accountType: 'revenue',
                  debitCents: 0,
                  creditCents: absPnl,
                },
              ]
            : [
                {
                  accountCode: `POOL_PNL:${op.pool_id}`,
                  accountName: `Resultado Realizado Pool ${op.pool_id}`,
                  accountType: 'revenue',
                  debitCents: absPnl,
                  creditCents: 0,
                },
                {
                  accountCode: `POOL_OPERATING_ASSET:${op.pool_id}`,
                  accountName: `Capital Operacional Alocado ${op.pool_id}`,
                  accountType: 'asset',
                  debitCents: 0,
                  creditCents: absPnl,
                },
              ],
          afterCommit: () => {
            db.prepare(
              `UPDATE pools SET realized_pnl_cents = realized_pnl_cents + ?, operational_capital_cents = operational_capital_cents + ? WHERE id = ?`
            ).run(op.net_pnl_cents, op.net_pnl_cents, op.pool_id);
            db.prepare(
              `UPDATE manual_operations SET status = 'approved', reviewed_by = ?, review_notes = ?, updated_at = ? WHERE id = ?`
            ).run(req.authUser!.id, reviewNotes || 'Evidências validadas.', now, op.id);
          },
        });
      } else {
        db.prepare(
          `UPDATE manual_operations SET status = 'approved', reviewed_by = ?, review_notes = ?, updated_at = ? WHERE id = ?`
        ).run(req.authUser!.id, reviewNotes || 'Operação zerada validada.', now, op.id);
      }
    } else {
      db.prepare(
        `UPDATE manual_operations SET status = ?, reviewed_by = ?, review_notes = ?, updated_at = ? WHERE id = ?`
      ).run(decision, req.authUser!.id, reviewNotes || null, now, op.id);
    }

    createNotification(
      op.trader_id,
      `Operação ${op.op_code} · ${decision.toUpperCase()}`,
      reviewNotes || `Sua operação ${op.op_code} teve o status atualizado para ${decision}.`,
      'operation'
    );
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      action: `OPERATION_${decision.toUpperCase()}`,
      entityType: 'manual_operation',
      entityId: op.id,
      metadata: { netPnlCents: op.net_pnl_cents },
    });
    broadcastToUser(op.trader_id, 'operation:updated', { opId: op.id, status: decision });
    res.json({ ok: true });
  });

  // Pool Settlement Engine with Insufficient Resource Guard (Section 7 & 8)
  app.post('/api/admin/pools/:id/settle', requireAuth, requireAdminTier('finance_admin', 'super_admin'), (req: AuthedRequest, res) => {
    try {
      const pool = db.prepare(`SELECT * FROM pools WHERE id = ?`).get(req.params.id) as Record<string, any> | undefined;
      if (!pool) return res.status(404).json({ error: 'Pool não encontrado.' });
      if (pool.status === 'settled') return res.status(400).json({ error: 'Pool já liquidado.' });

      const activeInvestments = db
        .prepare(`SELECT * FROM investments WHERE pool_id = ? AND status = 'active'`)
        .all(pool.id) as Array<Record<string, any>>;
      if (activeInvestments.length === 0) {
        return res.status(400).json({ error: 'Não há participações ativas neste pool para liquidar.' });
      }

      const totalPrincipalCents = activeInvestments.reduce((sum, inv) => sum + inv.principal_cents, 0);
      const totalContractualYieldCents = activeInvestments.reduce((sum, inv) => sum + inv.contractual_yield_cents, 0);
      const availablePoolResourcesCents = pool.operational_capital_cents + pool.reserve_cents;
      const requiredObligationCents = totalPrincipalCents + totalContractualYieldCents;

      // Section 7: Block automatic settlement & emit admin alert if pool resources are insufficient!
      if (availablePoolResourcesCents < requiredObligationCents) {
        const shortfallCents = requiredObligationCents - availablePoolResourcesCents;
        createNotification(
          req.authUser!.id,
          `ALERTA CRÍTICO: Insuficiência no Pool ${pool.name}`,
          `Liquidação bloqueada automaticamente. Lastro atual ($${(availablePoolResourcesCents / 100).toFixed(2)}) inferior às obrigações ($${(requiredObligationCents / 100).toFixed(2)}). Déficit: $${(shortfallCents / 100).toFixed(2)}.`,
          'alert'
        );
        writeAuditLog({
          actorId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          action: 'SETTLEMENT_BLOCKED_INSUFFICIENT_RESOURCES',
          entityType: 'pool',
          entityId: pool.id,
          metadata: { availablePoolResourcesCents, requiredObligationCents, shortfallCents },
        });
        return res.status(409).json({
          error: `Liquidação bloqueada: recursos reais do pool ($${(availablePoolResourcesCents / 100).toFixed(2)}) são insuficientes para cobrir principal + rendimentos contratuais ($${(requiredObligationCents / 100).toFixed(2)}). Déficit de $${(shortfallCents / 100).toFixed(2)}. Alerta administrativo emitido.`,
        });
      }

      // Eligible net surplus above contractual obligations & principal (split by pool.investor_share_bps / pool.trader_share_bps)
      const eligibleSurplusCents = Math.max(0, pool.realized_pnl_cents - totalContractualYieldCents);
      const traderGrossCommissionCents = Math.round((eligibleSurplusCents * pool.trader_share_bps) / 10000);
      const investorSurplusBonusCents = eligibleSurplusCents - traderGrossCommissionCents;

      const productRow = db.prepare(`SELECT commission_fee_bps FROM products WHERE id = ?`).get(pool.product_id) as
        | { commission_fee_bps: number }
        | undefined;
      const traderRow = db.prepare(`SELECT commission_fee_bps FROM trader_profiles WHERE user_id = ?`).get(pool.trader_id) as
        | { commission_fee_bps: number }
        | undefined;
      const effectiveCommFeeBps = Math.max(
        0,
        Math.min(5000, Number(productRow?.commission_fee_bps ?? traderRow?.commission_fee_bps ?? 0))
      );
      const platformCommissionFeeCents = Math.round((traderGrossCommissionCents * effectiveCommFeeBps) / 10000);
      const traderNetCommissionCents = traderGrossCommissionCents - platformCommissionFeeCents;
      const now = new Date().toISOString();

      // Execute clean balanced per-investment settlement using postDoubleEntryTransaction
      for (const inv of activeInvestments) {
        const bonusShare = Math.round((investorSurplusBonusCents * inv.pool_share_ppm) / 1_000_000);
        const totalYieldPaid = inv.contractual_yield_cents + bonusShare;
        const totalCredit = inv.principal_cents + totalYieldPaid;

        postDoubleEntryTransaction({
          idempotencyKey: `SETTLE-${pool.id}-${inv.id}`,
          userId: inv.investor_id,
          txType: 'pool_settlement',
          amountCents: totalCredit,
          originAccount: `POOL_CAPITAL:${pool.id}`,
          destinationAccount: `LIABILITY_USER_AVAILABLE:${inv.investor_id}`,
          externalRef: inv.contract_code,
          description: `Liquidação de principal + rendimento (${inv.contract_code})`,
          createdBy: req.authUser!.id,
          legs: [
            {
              accountCode: `LIABILITY_USER_INVESTED:${inv.investor_id}`,
              accountName: `Investido Investidor ${inv.investor_id}`,
              accountType: 'liability',
              debitCents: inv.principal_cents,
              creditCents: 0,
            },
            {
              accountCode: `POOL_PNL:${pool.id}`,
              accountName: `Resultado Realizado Pool ${pool.id}`,
              accountType: 'revenue',
              debitCents: totalYieldPaid,
              creditCents: 0,
            },
            {
              accountCode: `LIABILITY_USER_AVAILABLE:${inv.investor_id}`,
              accountName: `Disponível Investidor ${inv.investor_id}`,
              accountType: 'liability',
              debitCents: 0,
              creditCents: totalCredit,
            },
          ],
          afterCommit: () => {
            db.prepare(
              `UPDATE wallets
               SET available_cents = available_cents + ?,
                   invested_cents = MAX(0, invested_cents - ?),
                   realized_yield_cents = realized_yield_cents + ?,
                   pending_yield_cents = MAX(0, pending_yield_cents - ?),
                   updated_at = ?
               WHERE user_id = ?`
            ).run(totalCredit, inv.principal_cents, totalYieldPaid, inv.contractual_yield_cents, now, inv.investor_id);

            db.prepare(
              `UPDATE investments SET realized_yield_cents = ?, status = 'settled', settled_at = ? WHERE id = ?`
            ).run(totalYieldPaid, now, inv.id);

            createNotification(
              inv.investor_id,
              'Liquidação de Pool Concluída',
              `Contrato ${inv.contract_code} liquidado: $${(inv.principal_cents / 100).toFixed(2)} principal + $${(totalYieldPaid / 100).toFixed(2)} rendimento creditados.`,
              'investment'
            );
            broadcastToUser(inv.investor_id, 'wallet:updated', { poolId: pool.id });
          },
        });
      }

      if (traderGrossCommissionCents > 0) {
        const commissionLegs: Array<{
          accountCode: string;
          accountName: string;
          accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
          debitCents: number;
          creditCents: number;
        }> = [
          {
            accountCode: `POOL_PNL:${pool.id}`,
            accountName: `Resultado Realizado Pool ${pool.id}`,
            accountType: 'revenue',
            debitCents: traderGrossCommissionCents,
            creditCents: 0,
          },
        ];
        if (traderNetCommissionCents > 0) {
          commissionLegs.push({
            accountCode: `TRADER_COMMISSION_PAYABLE:${pool.trader_id}`,
            accountName: `Comissões Trader ${pool.trader_id}`,
            accountType: 'liability',
            debitCents: 0,
            creditCents: traderNetCommissionCents,
          });
        }
        if (platformCommissionFeeCents > 0) {
          commissionLegs.push({
            accountCode: 'PLATFORM_FEE_REVENUE',
            accountName: 'Receita Operacional AZKOYEN INVEST',
            accountType: 'revenue',
            debitCents: 0,
            creditCents: platformCommissionFeeCents,
          });
        }

        postDoubleEntryTransaction({
          idempotencyKey: `COMM-${pool.id}`,
          userId: pool.trader_id,
          txType: 'trader_commission',
          amountCents: traderGrossCommissionCents,
          originAccount: `POOL_PNL:${pool.id}`,
          destinationAccount: `TRADER_COMMISSION_PAYABLE:${pool.trader_id}`,
          externalRef: pool.id,
          description: `Comissão de performance (${(pool.trader_share_bps / 100).toFixed(2)}% bruto · taxa mesa ${(effectiveCommFeeBps / 100).toFixed(2)}%) · ${pool.name}`,
          createdBy: req.authUser!.id,
          legs: commissionLegs,
          afterCommit: () => {
            createNotification(
              pool.trader_id,
              'Comissão Realizada Creditada',
              `Comissão líquida de $${(traderNetCommissionCents / 100).toFixed(2)} apurada na liquidação do pool ${pool.name}.`,
              'commission'
            );
          },
        });
      }

      db.prepare(`UPDATE pools SET status = 'settled', settled_at = ? WHERE id = ?`).run(now, pool.id);
      writeAuditLog({
        actorId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        action: 'POOL_SETTLED',
        entityType: 'pool',
        entityId: pool.id,
        metadata: {
          totalPrincipalCents,
          totalContractualYieldCents,
          traderGrossCommissionCents,
          platformCommissionFeeCents,
          traderNetCommissionCents,
          investorSurplusBonusCents,
        },
      });

      res.json({
        settled: true,
        totalPrincipalCents,
        totalContractualYieldCents,
        traderCommissionCents: traderNetCommissionCents,
        platformCommissionFeeCents,
        investorSurplusBonusCents,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Erro ao liquidar pool.' });
    }
  });

  app.post('/api/admin/withdrawals/:id/review', requireAuth, requireAdminTier('finance_admin', 'super_admin'), (req: AuthedRequest, res) => {
    const { action, reviewNotes, txHash } = req.body as {
      action?: 'in_review' | 'approved' | 'processing' | 'completed' | 'rejected';
      reviewNotes?: string;
      txHash?: string;
    };

    const wd = db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(req.params.id) as Record<string, any> | undefined;
    if (!wd) return res.status(404).json({ error: 'Saque não encontrado.' });
    if (['completed', 'rejected'].includes(wd.status)) {
      return res.status(400).json({ error: 'Este saque já foi finalizado.' });
    }
    if (!action) return res.status(400).json({ error: 'Ação obrigatória.' });

    const now = new Date().toISOString();

    if (action === 'rejected') {
      postDoubleEntryTransaction({
        idempotencyKey: `WD-REJ-${wd.id}`,
        userId: wd.user_id,
        txType: 'withdrawal_reject',
        amountCents: wd.requested_usd_cents,
        originAccount: `LIABILITY_USER_RESERVED:${wd.user_id}`,
        destinationAccount: `LIABILITY_USER_AVAILABLE:${wd.user_id}`,
        externalRef: wd.id,
        description: `Estorno de reserva por recusa de saque (${wd.id})`,
        createdBy: req.authUser!.id,
        legs: [
          {
            accountCode: `LIABILITY_USER_RESERVED:${wd.user_id}`,
            accountName: `Reservado Investidor ${wd.user_id}`,
            accountType: 'liability',
            debitCents: wd.requested_usd_cents,
            creditCents: 0,
          },
          {
            accountCode: `LIABILITY_USER_AVAILABLE:${wd.user_id}`,
            accountName: `Disponível Investidor ${wd.user_id}`,
            accountType: 'liability',
            debitCents: 0,
            creditCents: wd.requested_usd_cents,
          },
        ],
        afterCommit: () => {
          db.prepare(
            `UPDATE wallets SET reserved_cents = MAX(0, reserved_cents - ?), available_cents = available_cents + ?, updated_at = ? WHERE user_id = ?`
          ).run(wd.requested_usd_cents, wd.requested_usd_cents, now, wd.user_id);
          db.prepare(
            `UPDATE withdrawals SET status = 'rejected', reviewed_by = ?, review_notes = ?, updated_at = ? WHERE id = ?`
          ).run(req.authUser!.id, reviewNotes || 'Recusado pela análise administrativa.', now, wd.id);
          createNotification(wd.user_id, 'Saque Recusado · Saldo Liberado', `Saque ${wd.id} recusado. Valor liberado para seu saldo disponível.`, 'withdrawal');
        },
      });
    } else if (action === 'completed') {
      const assetAccount = wd.method === 'PIX' ? 'ASSET_PIX_CLEARING' : 'ASSET_USDC_CUSTODY';
      const assetName =
        wd.method === 'PIX' ? 'Conta de Liquidação PIX (BRL -> USD)' : 'Custódia Institucional USDC On-Chain';

      postDoubleEntryTransaction({
        idempotencyKey: `WD-COMP-${wd.id}`,
        userId: wd.user_id,
        txType: 'withdrawal_approve',
        amountCents: wd.requested_usd_cents,
        originAccount: `LIABILITY_USER_RESERVED:${wd.user_id}`,
        destinationAccount: assetAccount,
        externalRef: txHash || wd.id,
        description: `Liquidação definitiva de saque ${wd.method} (${wd.id})`,
        createdBy: req.authUser!.id,
        legs: [
          {
            accountCode: `LIABILITY_USER_RESERVED:${wd.user_id}`,
            accountName: `Reservado Investidor ${wd.user_id}`,
            accountType: 'liability',
            debitCents: wd.requested_usd_cents,
            creditCents: 0,
          },
          {
            accountCode: assetAccount,
            accountName: assetName,
            accountType: 'asset',
            debitCents: 0,
            creditCents: wd.net_payout_cents,
          },
          {
            accountCode: 'PLATFORM_FEE_REVENUE',
            accountName: 'Receita Operacional AZKOYEN INVEST',
            accountType: 'revenue',
            debitCents: 0,
            creditCents: wd.fee_cents,
          },
        ],
        afterCommit: () => {
          db.prepare(
            `UPDATE wallets SET reserved_cents = MAX(0, reserved_cents - ?), updated_at = ? WHERE user_id = ?`
          ).run(wd.requested_usd_cents, now, wd.user_id);
          db.prepare(
            `UPDATE withdrawals SET status = 'completed', reviewed_by = ?, review_notes = ?, tx_hash = ?, updated_at = ? WHERE id = ?`
          ).run(req.authUser!.id, reviewNotes || 'Liquidação executada.', txHash || null, now, wd.id);
          createNotification(wd.user_id, 'Saque Concluído', `Seu saque ${wd.id} de $${(wd.net_payout_cents / 100).toFixed(2)} via ${wd.method} foi liquidado.`, 'withdrawal');
        },
      });
    } else {
      db.prepare(
        `UPDATE withdrawals SET status = ?, reviewed_by = ?, review_notes = ?, updated_at = ? WHERE id = ?`
      ).run(action, req.authUser!.id, reviewNotes || wd.review_notes, now, wd.id);
    }

    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      action: `WITHDRAWAL_${action.toUpperCase()}`,
      entityType: 'withdrawal',
      entityId: wd.id,
    });
    broadcastToUser(wd.user_id, 'wallet:updated', { withdrawalId: wd.id, status: action });
    res.json({ ok: true });
  });

  app.get('/api/admin/reconciliation', requireAuth, requireRole('admin'), (_req, res) => {
    res.json(runReconciliation());
  });

  app.patch('/api/admin/settings', requireAuth, requireAdminTier('super_admin', 'compliance_admin'), (req: AuthedRequest, res) => {
    const updates = req.body as Record<string, string | boolean | number>;
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'default_trader_share_bps') {
        const bps = Math.max(0, Math.min(8000, Math.round(Number(v))));
        setSetting('default_trader_share_bps', String(bps));
        setSetting('default_investor_share_bps', String(10000 - bps));
      } else if (k === 'platform_commission_fee_bps') {
        const bps = Math.max(0, Math.min(5000, Math.round(Number(v))));
        setSetting(k, String(bps));
      } else {
        setSetting(k, String(v));
      }
    }
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'SETTINGS_UPDATED',
      entityType: 'platform_settings',
      metadata: updates,
    });
    broadcastAll('settings:updated', updates);
    res.json({ ok: true });
  });

  app.delete('/api/admin/sessions/:id', requireAuth, requireAdminTier('super_admin', 'compliance_admin'), (req: AuthedRequest, res) => {
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(new Date().toISOString(), req.params.id);
    writeAuditLog({ actorId: req.authUser!.id, actorEmail: req.authUser!.email, action: 'ADMIN_REVOKED_SESSION', entityType: 'session', entityId: req.params.id });
    res.json({ ok: true });
  });

  app.post('/api/admin/support/:id/reply', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
    const { reply, status } = req.body as { reply?: string; status?: string };
    db.prepare(
      `UPDATE support_tickets SET admin_reply = ?, status = COALESCE(?, 'resolved'), updated_at = ? WHERE id = ?`
    ).run(reply || '', status || 'resolved', new Date().toISOString(), req.params.id);
    res.json({ ok: true });
  });
}
