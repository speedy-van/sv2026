import { Building2, GraduationCap, House, Package, Piano, Sofa, Trash2, Truck, Warehouse, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavIcon = LucideIcon;

export interface ServiceLink {
  href: string;
  icon: NavIcon;
  label: string;
  summary: string;
}

export const services: ServiceLink[] = [
  { href: '/services/house-removals', icon: House, label: 'Home moves', summary: 'Flats, houses and whole-home moves.' },
  { href: '/services/man-and-van', icon: Truck, label: 'Man and van', summary: 'Small moves and single-item jobs.' },
  { href: '/services/furniture-delivery', icon: Sofa, label: 'Furniture delivery', summary: 'Sofas, beds, tables and bulky items.' },
  { href: '/services/student-moves', icon: GraduationCap, label: 'Student moves', summary: 'Halls, flats and term-time moves.' },
  { href: '/services/office-removals', icon: Building2, label: 'Office moves', summary: 'Small offices and workplace moves.' },
  { href: '/services/storage-moves', icon: Warehouse, label: 'Storage moves', summary: 'To storage, from storage or between units.' },
  { href: '/services/ikea-delivery', icon: Package, label: 'IKEA and flat-pack', summary: 'Flat-pack collection and delivery.' },
  { href: '/services/rubbish-removal', icon: Trash2, label: 'Rubbish removal', summary: 'Clearance priced as a single-address job.' },
  { href: '/services/piano-moving', icon: Piano, label: 'Piano moving', summary: 'Piano moves with access checks.' },
  { href: '/services/same-day-delivery', icon: Zap, label: 'Same-day delivery', summary: 'Urgent small deliveries when slots are free.' },
];

export const cityLinks = [
  { href: '/removals/glasgow', label: 'Glasgow' },
  { href: '/removals/edinburgh', label: 'Edinburgh' },
  { href: '/removals/aberdeen', label: 'Aberdeen' },
  { href: '/removals/dundee', label: 'Dundee' },
  { href: '/removals/inverness', label: 'Inverness' },
  { href: '/removals/perth', label: 'Perth' },
  { href: '/removals/stirling', label: 'Stirling' },
  { href: '/removals/dunfermline', label: 'Dunfermline' },
] as const;

export const companyLinks = [
  { href: '/about', label: 'About' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Prices' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/guides', label: 'Guides' },
  { href: '/drive-with-us', label: 'Drive with us' },
  { href: '/contact', label: 'Contact' },
] as const;

export const helpLinks = [
  { href: '/help', label: 'FAQs' },
  { href: '/contact', label: 'Existing booking help' },
  { href: '/legal/cancellation', label: 'Cancellation policy' },
] as const;
