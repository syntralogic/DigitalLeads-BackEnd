import geoip from 'geoip-lite';
import { logger } from '../config/logger';

export interface GeoData {
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  isp?: string;
}

export const geoipUtils = {
  // Get geo data from IP
  getGeoData(ip: string): GeoData | null {
    try {
      // Skip private IPs
      if (this.isPrivateIP(ip)) {
        return null;
      }

      const geo = geoip.lookup(ip);
      if (!geo) {
        return null;
      }

      return {
        country: geo.country,
        countryCode: geo.country,
        region: geo.region,
        city: geo.city,
        latitude: geo.ll?.[0],
        longitude: geo.ll?.[1],
        timezone: geo.timezone,
      };
    } catch (error) {
      logger.error('GeoIP lookup error:', { ip, error });
      return null;
    }
  },

  // Check if IP is private
  isPrivateIP(ip: string): boolean {
    const parts = ip.split('.');
    if (parts.length !== 4) {
      // IPv6 or invalid
      return true;
    }

    const first = parseInt(parts[0]);
    const second = parseInt(parts[1]);

    // Private IP ranges
    if (first === 10) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 127) return true;

    return false;
  },

  // Get country from IP
  getCountry(ip: string): string | null {
    const data = this.getGeoData(ip);
    return data?.country || null;
  },

  // Get city from IP
  getCity(ip: string): string | null {
    const data = this.getGeoData(ip);
    return data?.city || null;
  },

  // Get timezone from IP
  getTimezone(ip: string): string | null {
    const data = this.getGeoData(ip);
    return data?.timezone || null;
  },

  // Get coordinates from IP
  getCoordinates(ip: string): { lat: number; lng: number } | null {
    const data = this.getGeoData(ip);
    if (!data || !data.latitude || !data.longitude) {
      return null;
    }
    return {
      lat: data.latitude,
      lng: data.longitude,
    };
  },

  // Get ISP from IP (requires additional service, placeholder)
  getISP(_ip: string): string | null {
    // In production, use an ISP lookup service
    return null;
  },

  // Get country code from IP
  getCountryCode(ip: string): string | null {
    const data = this.getGeoData(ip);
    return data?.countryCode || null;
  },

  // Batch lookup
  batchLookup(ips: string[]): Map<string, GeoData | null> {
    const results = new Map<string, GeoData | null>();
    for (const ip of ips) {
      results.set(ip, this.getGeoData(ip));
    }
    return results;
  },

  // Check if IP is from specific country
  isFromCountry(ip: string, countryCode: string): boolean {
    const data = this.getGeoData(ip);
    return data?.countryCode?.toUpperCase() === countryCode.toUpperCase();
  },

  // Get distance between two IPs in kilometers
  getDistance(ip1: string, ip2: string): number | null {
    const coord1 = this.getCoordinates(ip1);
    const coord2 = this.getCoordinates(ip2);

    if (!coord1 || !coord2) {
      return null;
    }

    // Haversine formula
    const R = 6371; // Earth's radius in km
    const dLat = (coord2.lat - coord1.lat) * Math.PI / 180;
    const dLon = (coord2.lng - coord1.lng) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(coord1.lat * Math.PI / 180) * Math.cos(coord2.lat * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },
};