export type Granularity = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';
export type ReportDimension = 'offer' | 'network' | 'country' | 'device' | 'browser' | 'os' | 'source';

export interface ReportParams {
  dimension: ReportDimension;
  granularity: Granularity;
  from?: string;
  to?: string;
  search?: string;
}

export interface ReportRow {
  id: string;
  label: string;
  clicks: number;
  conversions: number;
  revenue: number;
  payout: number;
  conversionRate: number;
  epc: number;
}

export interface SeriesPoint {
  timestamp: string;
  value: number;
  label?: string;
}

export interface GeoReport {
  country: string;
  countryCode: string;
  clicks: number;
  conversions: number;
  revenue: number;
  conversionRate: number;
  percentage: number;
}

export interface DeviceReport {
  device: string;
  clicks: number;
  conversions: number;
  revenue: number;
  conversionRate: number;
}