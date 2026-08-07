export const dateUtils = {
  // Format date to ISO string
  toISO(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toISOString();
  },

  // Format date to locale string
  toLocale(date: Date | string, locale: string = 'en-US'): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString(locale);
  },

  // Get start of day
  startOfDay(date: Date = new Date()): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  },

  // Get end of day
  endOfDay(date: Date = new Date()): Date {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  },

  // Get start of week (Monday)
  startOfWeek(date: Date = new Date()): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  },

  // Get end of week (Sunday)
  endOfWeek(date: Date = new Date()): Date {
    const d = this.startOfWeek(date);
    d.setDate(d.getDate() + 6);
    d.setHours(23, 59, 59, 999);
    return d;
  },

  // Get start of month
  startOfMonth(date: Date = new Date()): Date {
    const d = new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  },

  // Get end of month
  endOfMonth(date: Date = new Date()): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    d.setHours(23, 59, 59, 999);
    return d;
  },

  // Get start of year
  startOfYear(date: Date = new Date()): Date {
    const d = new Date(date);
    d.setMonth(0);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  },

  // Get end of year
  endOfYear(date: Date = new Date()): Date {
    const d = new Date(date);
    d.setMonth(11);
    d.setDate(31);
    d.setHours(23, 59, 59, 999);
    return d;
  },

  // Format relative time (e.g., "2 hours ago")
  timeAgo(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diff = now.getTime() - d.getTime();

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
    if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
    if (weeks > 0) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'Just now';
  },

  // Check if date is today
  isToday(date: Date | string): boolean {
    const d = typeof date === 'string' ? new Date(date) : date;
    const today = new Date();
    return d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();
  },

  // Check if date is in range
  isInRange(date: Date | string, start: Date | string, end: Date | string): boolean {
    const d = typeof date === 'string' ? new Date(date) : date;
    const s = typeof start === 'string' ? new Date(start) : start;
    const e = typeof end === 'string' ? new Date(end) : end;
    return d >= s && d <= e;
  },

  // Get date range from granularity
  getDateRangeFromGranularity(granularity: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'): { start: Date; end: Date } {
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);

    switch (granularity) {
      case 'hourly':
        start = new Date(now);
        start.setHours(now.getHours() - 1);
        end = now;
        break;
      case 'daily':
        start = this.startOfDay(now);
        end = now;
        break;
      case 'weekly':
        start = this.startOfWeek(now);
        end = now;
        break;
      case 'monthly':
        start = this.startOfMonth(now);
        end = now;
        break;
      case 'custom':
        // Will be provided by user
        break;
    }

    return { start, end };
  },
};