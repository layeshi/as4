// Pure protocol metadata shared by tools, views and telemetry.
import { ENTITY_LOOKS } from '../entities/catalog.js';
export const LOOK_WHATS = Object.freeze(['here', 'self', 'laws', 'law', 'proposals', 'proposal', 'procedure', 'groups', 'group', 'residents', 'places', 'refounds', 'cradle', 'lexicon', 'petitions']);
export const LOOK_WHATS_P4 = Object.freeze([...LOOK_WHATS, 'inbox', 'actions']);
export const MATERIAL_LOOKS = Object.freeze(['materials', 'services', 'demands', 'orders', 'research', 'observations', 'projects', 'project']);
export const COOP_LOOKS = Object.freeze(['cards', 'collaborations', 'relations', 'cooperation_rules']);
export function lookSections(premise = 0) {
  return [6,7].includes(premise) ? [...LOOK_WHATS_P4, ...MATERIAL_LOOKS, ...COOP_LOOKS, 'programs', ...ENTITY_LOOKS]
    : premise === 5 ? [...LOOK_WHATS_P4, ...MATERIAL_LOOKS] : premise === 4 ? LOOK_WHATS_P4 : LOOK_WHATS;
}
