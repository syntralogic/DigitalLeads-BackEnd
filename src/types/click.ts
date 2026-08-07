export interface Click {
  id: string;
  clickId: string;
  ip: string | null;
  country: string | null;
  city: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  isp: string | null;
  carrier: string | null;
  referrer: string | null;
  campaign: string | null;
  sub1: string | null;
  sub2: string | null;
  sub3: string | null;
  sub4: string | null;
  sub5: string | null;
  sub6: string | null;
  sub7: string | null;
  sub8: string | null;
  sub9: string | null;
  sub10: string | null;
  timestamp: string;
  offerId: string | null;
  offer?: {
    id: string;
    name: string;
  };
  networkId: string | null;
  network?: {
    id: string;
    name: string;
  };
  conversion?: {
    id: string;
    status: ConversionStatus;
    revenue: number | null;
  } | null;
  isFraudulent: boolean;
  fraudReasons: string | null;
  userAgent: string | null;
  sessionId: string | null;
  revenue: number | null;
}

export interface ClickCreateInput {
  offerId: string;
  networkId?: string;
  ip: string;
  userAgent: string;
  referrer?: string;
  campaign?: string;
  sub1?: string;
  sub2?: string;
  sub3?: string;
  sub4?: string;
  sub5?: string;
  sub6?: string;
  sub7?: string;
  sub8?: string;
  sub9?: string;
  sub10?: string;
}

export interface ClickTrackResponse {
  success: boolean;
  clickId: string;
  redirectUrl: string;
  message: string;
}

export interface ClickListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  country?: string;
  device?: string;
  browser?: string;
  from?: string;
  to?: string;
  sort?: string;
}

export interface ClickStats {
  total: number;
  unique: number;
  fraudulent: number;
  byCountry: Record<string, number>;
  byDevice: Record<string, number>;
  byBrowser: Record<string, number>;
  byOffer: Record<string, number>;
  byNetwork: Record<string, number>;
  hourly: Array<{
    hour: string;
    count: number;
  }>;
  daily: Array<{
    date: string;
    count: number;
  }>;
}

export type ConversionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'HOLD' | 'CHARGEBACK';