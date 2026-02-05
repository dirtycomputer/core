/**
 * ID 生成工具
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * 生成 UUID v4
 */
export function generateId(): string {
  return uuidv4();
}

/**
 * 生成带前缀的 ID
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
}

/**
 * 生成短 ID (用于显示)
 */
export function generateShortId(): string {
  return uuidv4().replace(/-/g, '').substring(0, 8);
}
