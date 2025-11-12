/**
 * Centralized timezone management service
 * Ensures consistent timezone handling across the application
 * All times are stored in UTC and displayed in user's timezone
 */

export type TimezoneConfig = {
  timezone: string;
  use24Hour: boolean;
};

export class TimezoneService {
  private static instance: TimezoneService;
  private timezone: string;
  private use24Hour: boolean;

  private constructor() {
    this.timezone = this.getUserTimezone();
    this.use24Hour = true;

    const stored = localStorage.getItem('timezone_config');
    if (stored) {
      try {
        const config: TimezoneConfig = JSON.parse(stored);
        this.timezone = config.timezone;
        this.use24Hour = config.use24Hour;
      } catch (e) {
        console.warn('Failed to load timezone config');
      }
    }
  }

  static getInstance(): TimezoneService {
    if (!TimezoneService.instance) {
      TimezoneService.instance = new TimezoneService();
    }
    return TimezoneService.instance;
  }

  private getUserTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  getTimezone(): string {
    return this.timezone;
  }

  setTimezone(timezone: string): void {
    this.timezone = timezone;
    this.saveConfig();
  }

  getUse24Hour(): boolean {
    return this.use24Hour;
  }

  setUse24Hour(use24Hour: boolean): void {
    this.use24Hour = use24Hour;
    this.saveConfig();
  }

  private saveConfig(): void {
    const config: TimezoneConfig = {
      timezone: this.timezone,
      use24Hour: this.use24Hour,
    };
    localStorage.setItem('timezone_config', JSON.stringify(config));
  }

  toUTCString(date: Date): string {
    return date.toISOString();
  }

  fromUTCString(isoString: string): Date {
    return new Date(isoString);
  }

  toDateTimeLocalString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  fromDateTimeLocalString(dateTimeString: string): Date {
    return new Date(dateTimeString);
  }

  formatDateTime(date: Date | string): string {
    const iso = typeof date === 'string' ? date : date.toISOString();
    const [datePart, timePart] = iso.split('T');
    const [year, month, day] = datePart.split('-');
    const [hours, minutes] = timePart.split(':');

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIndex = parseInt(month) - 1;

    return `${monthNames[monthIndex]} ${day} • ${hours}:${minutes}`;
  }

  formatTime(date: Date | string): string {
    const iso = typeof date === 'string' ? date : date.toISOString();
    const timePart = iso.split('T')[1];
    const [hours, minutes] = timePart.split(':');

    return `${hours}:${minutes}`;
  }

  formatDate(date: Date | string): string {
    const iso = typeof date === 'string' ? date : date.toISOString();
    const [datePart] = iso.split('T');
    const [year, month, day] = datePart.split('-');

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIndex = parseInt(month) - 1;

    return `${monthNames[monthIndex]} ${day}, ${year}`;
  }

  formatDateRange(startDate: Date | string, endDate: Date | string): string {
    const startISO = typeof startDate === 'string' ? startDate : startDate.toISOString();
    const endISO = typeof endDate === 'string' ? endDate : endDate.toISOString();

    const [startDatePart, startTimePart] = startISO.split('T');
    const [endDatePart, endTimePart] = endISO.split('T');

    const isSameDay = startDatePart === endDatePart;

    if (isSameDay) {
      const [year, month, day] = startDatePart.split('-');
      const [startHours, startMinutes] = startTimePart.split(':');
      const [endHours, endMinutes] = endTimePart.split(':');

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthIndex = parseInt(month) - 1;

      return `${monthNames[monthIndex]} ${day} • ${startHours}:${startMinutes} - ${endHours}:${endMinutes}`;
    } else {
      const [startYear, startMonth, startDay] = startDatePart.split('-');
      const [startHours, startMinutes] = startTimePart.split(':');
      const [endYear, endMonth, endDay] = endDatePart.split('-');
      const [endHours, endMinutes] = endTimePart.split(':');

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const startMonthIndex = parseInt(startMonth) - 1;
      const endMonthIndex = parseInt(endMonth) - 1;

      return `${monthNames[startMonthIndex]} ${startDay} ${startHours}:${startMinutes} - ${monthNames[endMonthIndex]} ${endDay} ${endHours}:${endMinutes}`;
    }
  }

  now(): string {
    return new Date().toISOString();
  }

  getTimezoneOffset(): number {
    return new Date().getTimezoneOffset();
  }

  getTimezoneOffsetString(): string {
    const offset = this.getTimezoneOffset();
    const hours = Math.floor(Math.abs(offset) / 60);
    const minutes = Math.abs(offset) % 60;
    const sign = offset <= 0 ? '+' : '-';

    return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
}

export const timezoneService = TimezoneService.getInstance();

