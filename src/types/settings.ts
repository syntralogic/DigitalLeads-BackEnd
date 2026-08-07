export interface BrandingSettings {
  panelName: string;
  logoUrl: string | null;
  supportEmail: string | null;
  whiteLabelDomain: string | null;
}

export interface BrandingSettingsUpdate {
  panelName?: string;
  logoUrl?: string | null;
  supportEmail?: string | null;
  whiteLabelDomain?: string | null;
}

export interface SmtpSettings {
  host: string;
  port: number;
  username: string;
  fromEmail: string;
  secure: boolean;
  password?: string;
}

export interface SmtpSettingsUpdate {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  fromEmail?: string;
  secure?: boolean;
}

export interface SmtpTestResult {
  ok: boolean;
  message: string;
  error?: string;
}

export interface SecuritySettings {
  twoFactorRequired: boolean;
  ipAllowlist: string | null;
  sessionTimeoutMinutes: number;
}

export interface SecuritySettingsUpdate {
  twoFactorRequired?: boolean;
  ipAllowlist?: string | null;
  sessionTimeoutMinutes?: number;
}

export interface UserRoleSettings {
  roles: UserRole[];
  permissions: Permission[];
}

export interface UserRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Permission {
  id: string;
  name: string;
  description: string;
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'manage';
  createdAt: string;
}

export interface ApiKeySettings {
  id: string;
  label: string;
  lastUsed: string | null;
  createdAt: string;
  revoked: boolean;
}

export interface ApiKeyCreateRequest {
  label: string;
}

export interface ApiKeyCreateResponse {
  id: string;
  label: string;
  key: string;
  createdAt: string;
}

export interface BackupSettings {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  retentionDays: number;
  lastBackup: string | null;
  nextBackup: string | null;
  storagePath: string;
}

export interface BackupResponse {
  success: boolean;
  url: string;
  message: string;
  timestamp: string;
  size?: number;
}

export interface UserInviteRequest {
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'VIEWER' | 'API_ONLY';
}

export interface UserInviteResponse {
  id: string;
  email: string;
  role: string;
  name: string;
  tempPassword?: string;
}

export interface TwoFactorSettings {
  enabled: boolean;
  secret?: string;
  backupCodes?: string[];
}

export interface TwoFactorVerifyRequest {
  token: string;
}

export interface TwoFactorEnableResponse {
  secret: string;
  qrCode: string;
  backupCodes: string[];
}