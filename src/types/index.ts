// src/types/index.ts
export enum UserRole {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  VIEWER = 'VIEWER',
  API_ONLY = 'API_ONLY'
}

export enum NetworkStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED'
}

export enum OfferStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  DISABLED = 'DISABLED',
  EXPIRED = 'EXPIRED'
}

export enum ConversionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  HOLD = 'HOLD',
  CHARGEBACK = 'CHARGEBACK'
}

export enum FraudType {
  VPN = 'VPN',
  PROXY = 'PROXY',
  BOT = 'BOT',
  DUPLICATE_CLICK = 'DUPLICATE_CLICK',
  DUPLICATE_CONVERSION = 'DUPLICATE_CONVERSION',
  FAKE_LEAD = 'FAKE_LEAD',
  BLACKLISTED_IP = 'BLACKLISTED_IP',
  HIGH_RISK_IP = 'HIGH_RISK_IP'
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}