export const MATERIAL_OP_FIELDS = {
  cancel_project: [['project', 'id', true]],
  project_policy: [
    ['project', 'id', true],
    ['access', 'id', true],
  ],
  research_policy: [
    ['place', 'id', true],
    ['access', 'id', true],
    ['fee', 'int', true],
    ['agents', 'ids'],
    ['groups', 'ids'],
  ],
  material_policy: [['restricted', 'bool', true]],
};
