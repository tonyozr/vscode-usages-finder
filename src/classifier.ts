import { UsageKind } from './model';

export type TargetKind = 'value' | 'function' | 'type' | 'namespace' | 'unknown';
export type HighlightKind = 'read' | 'write' | 'text';

export interface ClassifyInput {
  lineText: string;
  startCol: number;
  endCol: number;
  isDeclaration: boolean;
  isDefinition: boolean;
  target: TargetKind;
  highlight?: HighlightKind;
}

const SUBSCRIPTS = String.raw`(?:\s*\[[^\[\]]*\])*`;
const PLAIN_ASSIGN = new RegExp(String.raw`^${SUBSCRIPTS}\s*=(?!=)`);
const COMPOUND_ASSIGN = new RegExp(String.raw`^${SUBSCRIPTS}\s*(?:\+|-|\*|/|%|&|\||\^|<<|>>)=`);
const POST_INCDEC = new RegExp(String.raw`^${SUBSCRIPTS}\s*(?:\+\+|--)`);
const PRE_INCDEC = /(?:\+\+|--)\s*$/;
// `&x` passed or assigned: the callee/pointer may modify it.
const ADDRESS_OF = /(?:[(,={]|\breturn)\s*&\s*$/;
const CALL = /^\s*\(/;
const TEMPLATE_CALL = /^\s*<[^;(){}]*>\s*\(/;

export function classify(input: ClassifyInput): UsageKind {
  if (input.isDefinition) {
    return 'definition';
  }
  if (input.isDeclaration) {
    return 'declaration';
  }

  const before = input.lineText.slice(0, input.startCol);
  const after = input.lineText.slice(input.endCol);

  if (input.target === 'value' || input.target === 'unknown') {
    if (COMPOUND_ASSIGN.test(after) || POST_INCDEC.test(after) || PRE_INCDEC.test(before)) {
      return 'readWrite';
    }
    if (PLAIN_ASSIGN.test(after)) {
      return 'write';
    }
    if (ADDRESS_OF.test(before)) {
      return 'readWrite';
    }
  }

  if (CALL.test(after) || (input.target === 'function' && TEMPLATE_CALL.test(after))) {
    return 'call';
  }

  switch (input.target) {
    case 'type':
      return 'type';
    case 'function':
    case 'namespace':
      return 'other';
    default:
      return input.highlight === 'write' ? 'write' : 'read';
  }
}
