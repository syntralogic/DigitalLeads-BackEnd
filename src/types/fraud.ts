export interface FraudSignal {
  type: string;
  label: string;
  count: number | null;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
}

export interface FraudScore {
  fraudScore: number;
  riskLevel: string;
}

export interface InvalidClick {
  id: string;
  ip: string;
  reason: string;
  time: string;
  country?: string;
  device?: string;
}

export interface FraudDetectionConfig {
  enabled: boolean;
  scoreThreshold: number;
  duplicateClickWindow: number;
  duplicateConversionWindow: number;
  vpnDetection: boolean;
  proxyDetection: boolean;
  botDetection: boolean;
  blacklistIPs: string[];
  whitelistIPs: string[];
}