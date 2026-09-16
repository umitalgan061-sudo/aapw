import { EntityId, clamp, hashString, mixHash, stableChecksum, stableStringify } from './types.ts';

export type ItemKind = 'weapon' | 'armor' | 'consumable' | 'quest' | 'material' | 'currency' | 'tool' | 'misc';
export type EquipmentSlot = 'head' | 'chest' | 'legs' | 'hands' | 'weapon' | 'offhand' | 'accessory';

export interface ItemDefinition {
  id: string;
  kind: ItemKind;
  stackLimit: number;
  weight: number;
  value: number;
  tags: readonly string[];
  equipSlot?: EquipmentSlot;
  durabilityMax?: number;
  power?: number;
}

export interface ItemStack {
  uid: number;
  itemId: string;
  quantity: number;
  durability?: number;
  metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface InventoryConfig {
  slotCapacity: number;
  weightCapacity: number;
  transactionLimit: number;
}

export interface InventoryResult {
  ok: boolean;
  reason?: string;
  changed: boolean;
  deltaWeight: number;
  affectedUids: readonly number[];
}
