import { Booking, ProfessionalSummary } from '../types/domain';
export const professionalsMock: ProfessionalSummary[] = [
  {
    id: '1',
    name: 'Carla Menezes',
    category: 'Personal Trainer',
    city: 'Recife',
    rating: 4.9,
    reviewCount: 124,
    priceStartsAt: 120,
    isFavorite: true,
    nextAvailableLabel: 'Hoje às 18:00',
    shortBio: 'Treinos personalizados para força, emagrecimento e condicionamento.',
  },
];
export const bookingsMock: Booking[] = [
  {
    id: 'booking-1',
    professionalId: '1',
    professionalName: 'Carla Menezes',
    category: 'Personal Trainer',
    serviceName: 'Sessão avulsa',
    scheduledAt: '2026-03-17T18:00:00.000Z',
    durationMinutes: 60,
    locationLabel: 'Academia do condomínio',
    price: 120,
    bookingStatus: 'confirmed',
    paymentStatus: 'pre_authorized',
    autoCaptureWindowLabel: '24 horas após confirmação parcial',
    confirmedBy: ['professional'],
  },
];
