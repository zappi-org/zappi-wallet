import type { FiatCurrencyInfo } from '@/core/types/fiat'

/**
 * All supported fiat currencies with display info
 */
export const FIAT_CURRENCIES: FiatCurrencyInfo[] = [
  // Major
  { code: 'USD', symbol: '$', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'EUR', symbol: '€', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', symbol: '£', name: 'British Pound', flag: '🇬🇧' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', flag: '🇯🇵' },
  { code: 'KRW', symbol: '₩', name: 'Korean Won', flag: '🇰🇷' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', flag: '🇨🇳' },
  // Asia-Pacific
  { code: 'TWD', symbol: 'NT$', name: 'Taiwan Dollar', flag: '🇹🇼' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', flag: '🇭🇰' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', flag: '🇸🇬' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', flag: '🇳🇿' },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', flag: '🇮🇩' },
  { code: 'THB', symbol: '฿', name: 'Thai Baht', flag: '🇹🇭' },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso', flag: '🇵🇭' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', flag: '🇲🇾' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', flag: '🇮🇳' },
  { code: 'VND', symbol: '₫', name: 'Vietnamese Dong', flag: '🇻🇳' },
  { code: 'PKR', symbol: 'Rs', name: 'Pakistani Rupee', flag: '🇵🇰' },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka', flag: '🇧🇩' },
  { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupee', flag: '🇱🇰' },
  { code: 'MMK', symbol: 'K', name: 'Myanmar Kyat', flag: '🇲🇲' },
  // Americas
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', flag: '🇨🇦' },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso', flag: '🇲🇽' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', flag: '🇧🇷' },
  { code: 'ARS', symbol: 'AR$', name: 'Argentine Peso', flag: '🇦🇷' },
  { code: 'COP', symbol: 'COL$', name: 'Colombian Peso', flag: '🇨🇴' },
  { code: 'CLP', symbol: 'CL$', name: 'Chilean Peso', flag: '🇨🇱' },
  { code: 'PEN', symbol: 'S/', name: 'Peruvian Sol', flag: '🇵🇪' },
  // Europe
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc', flag: '🇨🇭' },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona', flag: '🇸🇪' },
  { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone', flag: '🇳🇴' },
  { code: 'DKK', symbol: 'kr', name: 'Danish Krone', flag: '🇩🇰' },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira', flag: '🇹🇷' },
  { code: 'CZK', symbol: 'Kč', name: 'Czech Koruna', flag: '🇨🇿' },
  { code: 'HUF', symbol: 'Ft', name: 'Hungarian Forint', flag: '🇭🇺' },
  { code: 'PLN', symbol: 'zł', name: 'Polish Zloty', flag: '🇵🇱' },
  { code: 'RON', symbol: 'lei', name: 'Romanian Leu', flag: '🇷🇴' },
  { code: 'UAH', symbol: '₴', name: 'Ukrainian Hryvnia', flag: '🇺🇦' },
  { code: 'RUB', symbol: '₽', name: 'Russian Ruble', flag: '🇷🇺' },
  { code: 'ISK', symbol: 'kr', name: 'Icelandic Króna', flag: '🇮🇸' },
  // Middle East & Africa
  { code: 'ILS', symbol: '₪', name: 'Israeli Shekel', flag: '🇮🇱' },
  { code: 'SAR', symbol: 'SR', name: 'Saudi Riyal', flag: '🇸🇦' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', flag: '🇦🇪' },
  { code: 'KWD', symbol: 'د.ك', name: 'Kuwaiti Dinar', flag: '🇰🇼' },
  { code: 'EGP', symbol: 'E£', name: 'Egyptian Pound', flag: '🇪🇬' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', flag: '🇿🇦' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', flag: '🇳🇬' },
  { code: 'MAD', symbol: 'MAD', name: 'Moroccan Dirham', flag: '🇲🇦' },
]
