import crypto from 'crypto';

// Status emoji map
export const STATUS_EMOJI: Record<string, string> = {
  open: '○',
  wip: '🔨',
  blocked: '🚫',
  review: '👀',
  done: '✅',
  archived: '📦',
};

export const VALID_STATUSES = ['open', 'wip', 'blocked', 'review', 'done', 'archived'];

// Brand colors — cycle through these
const BRAND_COLORS = [
  '\x1b[36m',  // cyan
  '\x1b[33m',  // yellow
  '\x1b[35m',  // magenta
  '\x1b[32m',  // green
  '\x1b[34m',  // blue
  '\x1b[91m',  // bright red
  '\x1b[96m',  // bright cyan
  '\x1b[93m',  // bright yellow
];

const brandColorMap = new Map<string, string>();
let colorIndex = 0;

export function getBrandColor(brand: string): string {
  if (!brandColorMap.has(brand)) {
    brandColorMap.set(brand, BRAND_COLORS[colorIndex % BRAND_COLORS.length]);
    colorIndex++;
  }
  return brandColorMap.get(brand)!;
}

// ANSI helpers
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

export function generateId(): string {
  const hash = crypto.randomBytes(3).toString('hex');
  return `trak-${hash}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toISOString().split('T')[0];
}

export function heatBar(score: number, max: number = 10): string {
  const filled = Math.min(Math.round((score / max) * 5), 5);
  const empty = 5 - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
}

export function statusColor(status: string): string {
  switch (status) {
    case 'open': return c.white;
    case 'wip': return c.yellow;
    case 'blocked': return c.red;
    case 'review': return c.magenta;
    case 'done': return c.green;
    case 'archived': return c.gray;
    default: return c.white;
  }
}

export function priorityLabel(p: number): string {
  switch (p) {
    case 0: return `${c.gray}P0${c.reset}`;
    case 1: return `${c.green}P1${c.reset}`;
    case 2: return `${c.yellow}P2${c.reset}`;
    case 3: return `${c.red}P3${c.reset}`;
    default: return `P${p}`;
  }
}

export function truncate(s: string, len: number): string {
  if (s.length <= len) return s;
  return s.slice(0, len - 1) + '…';
}

export function padRight(s: string, len: number): string {
  // Account for ANSI codes in length calculation
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
  if (visible.length >= len) return s;
  return s + ' '.repeat(len - visible.length);
}
