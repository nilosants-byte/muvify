export type UserRole = 'client' | 'professional';
export type NetworkStatus = 'online' | 'offline';
export type AccountPayoutStatus =
  | 'not_started'
  | 'pending_review'
  | 'enabled'
  | 'restricted'
  | 'rejected';
export type BookingStatus =
  | 'pending_payment_auth'
  | 'authorized'
  | 'confirmed'
  | 'in_progress'
  | 'awaiting_confirmation'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'payment_capture_scheduled';
export type BookingConfirmationSource = 'client' | 'professional' | 'automatic';
export type PaymentStatus =
  | 'pre_authorized'
  | 'captured'
  | 'cancelled'
  | 'refunded'
  | 'capture_scheduled'
  | 'failed';
export type NotificationType = 'booking' | 'payment' | 'support' | 'system' | 'review';
export interface Category {
  id: string;
  name: string;
  icon: string;
  description?: string;
}
export interface ProfessionalSummary {
  id: string;
  name: string;
  category: string;
  avatarUrl?: string;
  city: string;
  rating: number;
  reviewCount: number;
  priceStartsAt: number;
  isFavorite: boolean;
  nextAvailableLabel?: string;
  shortBio?: string;
}
export interface TimeSlot {
  id: string;
  startAt: string;
  endAt: string;
  available: boolean;
}
export interface WeeklyAvailabilityRange {
  start: string;
  end: string;
}
export interface WeeklyAvailabilityDay {
  dayKey: 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab' | 'dom';
  enabled: boolean;
  ranges: WeeklyAvailabilityRange[];
}
export interface Booking {
  id: string;
  professionalId: string;
  professionalName: string;
  category: string;
  serviceName: string;
  scheduledAt: string;
  durationMinutes: number;
  locationLabel: string;
  address?: string;
  price: number;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  autoCaptureWindowLabel?: string;
  confirmedBy?: BookingConfirmationSource[];
}
export interface ReviewPayload {
  bookingId: string;

  rating: number;
  comment: string;
}
export interface ApiListResponse<T> {
  items: T[];
  nextCursor?: string | null;
}
export interface ApiErrorShape {
  message: string;
  code?: string;
  fieldErrors?: Record<string, string>;
}


