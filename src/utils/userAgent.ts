import { UAParser } from 'ua-parser-js';

export interface DeviceInfo {
  device: string;
  os: string;
  browser: string;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isBot: boolean;
  osVersion: string;
  browserVersion: string;
  deviceVendor: string;
  deviceModel: string;
}

export const userAgentUtils = {
  // Parse user agent
  parse(userAgent: string): DeviceInfo {
    const parser = new UAParser(userAgent);
    const result = parser.getResult();

    const device = result.device || {};
    const os = result.os || {};
    const browser = result.browser || {};

    const isMobile = device.type === 'mobile';
    const isTablet = device.type === 'tablet';
    const isDesktop = !device.type || device.type === 'desktop';
    const isBot = !browser.name;

    return {
      device: device.vendor && device.model ? `${device.vendor} ${device.model}` : (device.type || 'Unknown'),
      os: os.name || 'Unknown',
      browser: browser.name || 'Unknown',
      isMobile,
      isTablet,
      isDesktop,
      isBot,
      osVersion: os.version || 'Unknown',
      browserVersion: browser.version || 'Unknown',
      deviceVendor: device.vendor || 'Unknown',
      deviceModel: device.model || 'Unknown',
    };
  },

  // Get device type
  getDeviceType(userAgent: string): string {
    const info = this.parse(userAgent);
    if (info.isBot) return 'Bot';
    if (info.isMobile) return 'Mobile';
    if (info.isTablet) return 'Tablet';
    return 'Desktop';
  },

  // Get OS
  getOS(userAgent: string): string {
    return this.parse(userAgent).os;
  },

  // Get browser
  getBrowser(userAgent: string): string {
    return this.parse(userAgent).browser;
  },

  // Check if mobile
  isMobile(userAgent: string): boolean {
    return this.parse(userAgent).isMobile;
  },

  // Check if bot
  isBot(userAgent: string): boolean {
    return this.parse(userAgent).isBot;
  },

  // Get device vendor
  getDeviceVendor(userAgent: string): string {
    return this.parse(userAgent).deviceVendor;
  },

  // Get device model
  getDeviceModel(userAgent: string): string {
    return this.parse(userAgent).deviceModel;
  },

  // Get OS version
  getOSVersion(userAgent: string): string {
    return this.parse(userAgent).osVersion;
  },

  // Get browser version
  getBrowserVersion(userAgent: string): string {
    return this.parse(userAgent).browserVersion;
  },

  // Batch parse
  batchParse(userAgents: string[]): Map<string, DeviceInfo> {
    const results = new Map<string, DeviceInfo>();
    for (const ua of userAgents) {
      results.set(ua, this.parse(ua));
    }
    return results;
  },

  // Get device family (Apple, Android, Windows, etc.)
  getDeviceFamily(userAgent: string): string {
    const info = this.parse(userAgent);
    const os = info.os.toLowerCase();

    if (os.includes('ios') || os.includes('iphone') || os.includes('ipad')) {
      return 'Apple';
    }
    if (os.includes('android')) {
      return 'Android';
    }
    if (os.includes('windows')) {
      return 'Windows';
    }
    if (os.includes('mac')) {
      return 'Mac';
    }
    if (os.includes('linux')) {
      return 'Linux';
    }
    return 'Other';
  },
};