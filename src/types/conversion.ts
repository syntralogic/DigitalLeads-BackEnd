export interface Conversion {
  id: string;
  conversionId: string;
  offerId: string;
  offer?: {
    id: string;
    name: string;
  };
  networkId: string;
  network?: {
    id: string;
    name: string;
  };
  clickId: string | null;
  click?: {
    clickId: string;
    country: string | null;
    device: string | null;
    browser: string | null;
  } | null;
  revenue: number | null;
  payout: number | null;
  status: ConversionStatus;
  country: string | null;
  device: string | null;
  browser: string | null;
  timestamp: string;
  isFraudulent: boolean;
  fraudReasons: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface ConversionCreateInput {
  conversionId: string;
  offerId: string;
  networkId: string;
  clickId?: string;
  revenue?: number;
  payout?: number;
  status?: ConversionStatus;
  country?: string;
  device?: string;
  browser?: string;
  ip?: string;
  userAgent?: string;
}

export interface ConversionUpdateInput {
  status?: ConversionStatus;
  revenue?: number;
  payout?: number;
  country?: string;
  device?: string;
  browser?: string;
}

export interface ConversionListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ConversionStatus;
  offer?: string;
  network?: string;
  from?: string;
  to?: string;
  sort?: string;
}

export interface ConversionStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  hold: number;
  chargeback: number;
  totalRevenue: number;
  totalPayout: number;
  averageRevenue: number;
  averagePayout: number;
  byStatus: Record<ConversionStatus, number>;
  byOffer: Record<string, {
    conversions: number;
    revenue: number;
  }>;
  byNetwork: Record<string, {
    conversions: number;
    revenue: number;
  }>;
  byCountry: Record<string, number>;
  byDevice: Record<string, number>;
  byBrowser: Record<string, number>;
  timeline: Array<{
    date: string;
    count: number;
    revenue: number;
  }>;
}

export interface ConversionTimelineParams {
  offer?: string;
  network?: string;
  from?: string;
  to?: string;
  granularity?: 'hour' | 'day' | 'week' | 'month';
}

export interface ConversionTimelinePoint {
  timestamp: string;
  value: number;
  revenue: number;
  payout: number;
}

export interface ConversionExportParams {
  search?: string;
  status?: ConversionStatus;
  offer?: string;
  network?: string;
  from?: string;
  to?: string;
  format?: 'csv' | 'json' | 'excel';
}