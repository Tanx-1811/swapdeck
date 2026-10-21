import {
  Briefcase,
  Bug,
  Building2,
  Code,
  Coffee,
  FlaskConical,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  House,
  Leaf,
  Palette,
  Rocket,
  Shield,
  Star,
  Store,
  User,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { AccountIcon } from '../core/util';

/** The drawing behind each account/workspace symbol (one icon family, one stroke). */
export const ICONS: Record<AccountIcon, LucideIcon> = {
  briefcase: Briefcase,
  building: Building2,
  house: House,
  user: User,
  users: Users,
  handshake: Handshake,
  store: Store,
  rocket: Rocket,
  code: Code,
  flask: FlaskConical,
  wrench: Wrench,
  shield: Shield,
  globe: Globe,
  star: Star,
  heart: Heart,
  leaf: Leaf,
  palette: Palette,
  graduation: GraduationCap,
  coffee: Coffee,
  bug: Bug,
};

export function SymbolIcon({ name, size }: { name: string | undefined; size: number }) {
  const Icon = name ? ICONS[name as AccountIcon] : undefined;
  return Icon ? <Icon width={size} height={size} aria-hidden="true" /> : null;
}
