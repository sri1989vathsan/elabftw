/**
 * @author eLabFTW contributors
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

const FORMULA_ATTRIBUTE = 'data-formula';
const FORMULA_STATE_ATTRIBUTE = 'data-formula-state';

type CellReference = {
  column: number;
  row: number;
};

type ScalarValue = number | string | null;
type FormulaValue = ScalarValue | FormulaValue[];
type TokenKind = 'eof' | 'number' | 'identifier' | 'plus' | 'minus'
  | 'multiply' | 'divide' | 'power' | 'leftParen' | 'rightParen'
  | 'comma' | 'colon';
type Token = {
  kind: TokenKind;
  text: string;
  value?: number;
};

const ERROR = Object.freeze({
  Circular: '#CIRC!',
  DivideByZero: '#DIV/0!',
  Formula: '#FORMULA!',
  Name: '#NAME?',
  Reference: '#REF!',
  Value: '#VALUE!',
});

class FormulaError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

class FormulaLexer {
  private position = 0;

  constructor(private readonly input: string) {}

  next(): Token {
    this.skipWhitespace();
    if (this.position >= this.input.length) {
      return { kind: 'eof', text: '' };
    }

    const remaining = this.input.slice(this.position);
    const number = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      this.position += number[0].length;
      return { kind: 'number', text: number[0], value: Number(number[0]) };
    }

    const identifier = remaining.match(/^\$?[a-z_][a-z0-9_]*\$?\d*/i);
    if (identifier) {
      this.position += identifier[0].length;
      return { kind: 'identifier', text: identifier[0] };
    }

    const operators: Record<string, TokenKind> = {
      '+': 'plus',
      '-': 'minus',
      '*': 'multiply',
      '/': 'divide',
      '^': 'power',
      '(': 'leftParen',
      ')': 'rightParen',
      ',': 'comma',
      ':': 'colon',
    };
    const character = this.input[this.position];
    const kind = operators[character];
    if (!kind) {
      throw new FormulaError(ERROR.Formula);
    }
    this.position += 1;
    return { kind, text: character };
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.input[this.position] ?? '')) {
      this.position += 1;
    }
  }
}

class FormulaParser {
  private readonly lexer: FormulaLexer;
  private current: Token;

  constructor(
    formula: string,
    private readonly resolveCell: (reference: CellReference) => FormulaValue,
    private readonly resolveRange: (start: CellReference, end: CellReference) => FormulaValue[],
  ) {
    this.lexer = new FormulaLexer(formula);
    this.current = this.lexer.next();
  }

  parse(): number {
    const result = this.parseAddition();
    if (this.current.kind !== 'eof') {
      throw new FormulaError(ERROR.Formula);
    }
    return this.toNumber(result);
  }

  private parseAddition(): FormulaValue {
    let result = this.parseMultiplication();
    while (this.current.kind === 'plus' || this.current.kind === 'minus') {
      const operator = this.current.kind;
      this.advance();
      const right = this.parseMultiplication();
      result = operator === 'plus'
        ? this.toNumber(result) + this.toNumber(right)
        : this.toNumber(result) - this.toNumber(right);
    }
    return result;
  }

  private parseMultiplication(): FormulaValue {
    let result = this.parseUnary();
    while (this.current.kind === 'multiply' || this.current.kind === 'divide') {
      const operator = this.current.kind;
      this.advance();
      const right = this.toNumber(this.parseUnary());
      if (operator === 'divide' && right === 0) {
        throw new FormulaError(ERROR.DivideByZero);
      }
      result = operator === 'multiply'
        ? this.toNumber(result) * right
        : this.toNumber(result) / right;
    }
    return result;
  }

  private parseUnary(): FormulaValue {
    if (this.current.kind === 'plus') {
      this.advance();
      return this.toNumber(this.parseUnary());
    }
    if (this.current.kind === 'minus') {
      this.advance();
      return -this.toNumber(this.parseUnary());
    }
    return this.parsePower();
  }

  private parsePower(): FormulaValue {
    const result = this.parsePrimary();
    if (this.current.kind === 'power') {
      this.advance();
      return this.toNumber(result) ** this.toNumber(this.parseUnary());
    }
    return result;
  }

  private parsePrimary(): FormulaValue {
    if (this.current.kind === 'number') {
      const value = this.current.value as number;
      this.advance();
      return value;
    }

    if (this.current.kind === 'leftParen') {
      this.advance();
      const result = this.parseAddition();
      this.expect('rightParen');
      return result;
    }

    if (this.current.kind !== 'identifier') {
      throw new FormulaError(ERROR.Formula);
    }

    const identifier = this.current.text;
    this.advance();
    if (this.isCurrent('leftParen')) {
      return this.parseFunction(identifier);
    }

    const reference = parseCellReference(identifier);
    if (!reference) {
      throw new FormulaError(ERROR.Name);
    }
    if (this.isCurrent('colon')) {
      this.advance();
      if (this.current.kind !== 'identifier') {
        throw new FormulaError(ERROR.Reference);
      }
      const endReference = parseCellReference(this.current.text);
      if (!endReference) {
        throw new FormulaError(ERROR.Reference);
      }
      this.advance();
      return this.resolveRange(reference, endReference);
    }
    return this.resolveCell(reference);
  }

  private parseFunction(identifier: string): number {
    this.expect('leftParen');
    const args: FormulaValue[] = [];
    if (this.current.kind !== 'rightParen') {
      args.push(this.parseAddition());
      while (this.current.kind === 'comma') {
        this.advance();
        args.push(this.parseAddition());
      }
    }
    this.expect('rightParen');

    const values = flattenValues(args);
    const numbers = values.filter((value): value is number => (
      typeof value === 'number' && Number.isFinite(value)
    ));
    switch (identifier.toUpperCase()) {
    case 'SUM':
      return numbers.reduce((total, value) => total + value, 0);
    case 'AVERAGE':
      if (numbers.length === 0) {
        throw new FormulaError(ERROR.DivideByZero);
      }
      return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    case 'MIN':
      return numbers.length === 0 ? 0 : Math.min(...numbers);
    case 'MAX':
      return numbers.length === 0 ? 0 : Math.max(...numbers);
    case 'COUNT':
      return numbers.length;
    default:
      throw new FormulaError(ERROR.Name);
    }
  }

  private toNumber(value: FormulaValue): number {
    if (value === null) {
      return 0;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new FormulaError(ERROR.Value);
    }
    return value;
  }

  private expect(kind: TokenKind): void {
    if (this.current.kind !== kind) {
      throw new FormulaError(ERROR.Formula);
    }
    this.advance();
  }

  private advance(): void {
    this.current = this.lexer.next();
  }

  private isCurrent(kind: TokenKind): boolean {
    return this.current.kind === kind;
  }
}

function flattenValues(values: FormulaValue[]): ScalarValue[] {
  return values.flatMap(value => Array.isArray(value) ? flattenValues(value) : [value]);
}

function parseCellReference(reference: string): CellReference | null {
  const match = reference.match(/^\$?([a-z]+)\$?([1-9]\d*)$/i);
  if (!match) {
    return null;
  }

  let column = 0;
  for (const character of match[1].toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return {
    column: column - 1,
    row: Number(match[2]) - 1,
  };
}

function readLiteral(cell: HTMLTableCellElement): ScalarValue {
  const text = cell.textContent?.trim() ?? '';
  if (text.length === 0) {
    return null;
  }
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    return Number(text);
  }
  return text;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new FormulaError(ERROR.Value);
  }
  if (Object.is(value, -0)) {
    return '0';
  }
  return Number.parseFloat(value.toPrecision(15)).toString();
}

function buildGrid(table: HTMLTableElement): HTMLTableCellElement[][] {
  const grid: HTMLTableCellElement[][] = [];
  const isWellPlate = table.hasAttribute('data-well-plate');
  Array.from(table.rows).forEach((row, sourceRowIndex) => {
    if (isWellPlate && sourceRowIndex === 0) {
      return;
    }
    const rowIndex = isWellPlate ? sourceRowIndex - 1 : sourceRowIndex;
    grid[rowIndex] ??= [];
    let columnIndex = 0;
    const cells = Array.from(row.cells);
    if (isWellPlate) {
      cells.shift();
    }
    cells.forEach(cell => {
      while (grid[rowIndex][columnIndex]) {
        columnIndex += 1;
      }
      const rowSpan = Math.max(cell.rowSpan || 1, 1);
      const columnSpan = Math.max(cell.colSpan || 1, 1);
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        grid[rowIndex + rowOffset] ??= [];
        for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
          grid[rowIndex + rowOffset][columnIndex + columnOffset] = cell;
        }
      }
      columnIndex += columnSpan;
    });
  });
  return grid;
}

export default class FormulaTable {
  evaluate(table: HTMLTableElement): void {
    const grid = buildGrid(table);
    const computed = new Map<HTMLTableCellElement, number>();
    const formulaCells = new Set<HTMLTableCellElement>();
    Array.from(table.rows).forEach(row => {
      Array.from(row.cells).forEach(cell => {
        if (cell.hasAttribute(FORMULA_ATTRIBUTE)) {
          formulaCells.add(cell);
        }
      });
    });

    const resolveCell = (
      cell: HTMLTableCellElement | undefined,
      stack: Set<HTMLTableCellElement>,
    ): FormulaValue => {
      if (!cell) {
        throw new FormulaError(ERROR.Reference);
      }
      const formula = cell.getAttribute(FORMULA_ATTRIBUTE);
      if (!formula) {
        return readLiteral(cell);
      }
      if (computed.has(cell)) {
        return computed.get(cell);
      }
      if (stack.has(cell)) {
        throw new FormulaError(ERROR.Circular);
      }
      if (!formula.startsWith('=')) {
        throw new FormulaError(ERROR.Formula);
      }

      const nextStack = new Set(stack);
      nextStack.add(cell);
      const parser = new FormulaParser(
        formula.slice(1),
        reference => resolveReference(reference, nextStack),
        (start, end) => resolveRange(start, end, nextStack),
      );
      const value = parser.parse();
      computed.set(cell, value);
      return value;
    };

    const resolveReference = (
      reference: CellReference,
      stack: Set<HTMLTableCellElement>,
    ): FormulaValue => {
      return resolveCell(grid[reference.row]?.[reference.column], stack);
    };

    const resolveRange = (
      start: CellReference,
      end: CellReference,
      stack: Set<HTMLTableCellElement>,
    ): FormulaValue[] => {
      const rowStart = Math.min(start.row, end.row);
      const rowEnd = Math.max(start.row, end.row);
      const columnStart = Math.min(start.column, end.column);
      const columnEnd = Math.max(start.column, end.column);
      const cells = new Set<HTMLTableCellElement>();
      for (let row = rowStart; row <= rowEnd; row += 1) {
        for (let column = columnStart; column <= columnEnd; column += 1) {
          const cell = grid[row]?.[column];
          if (!cell) {
            throw new FormulaError(ERROR.Reference);
          }
          cells.add(cell);
        }
      }
      return Array.from(cells).map(cell => resolveCell(cell, stack));
    };

    formulaCells.forEach(cell => {
      try {
        const value = resolveCell(cell, new Set());
        if (typeof value !== 'number') {
          throw new FormulaError(ERROR.Value);
        }
        cell.textContent = formatNumber(value);
        cell.setAttribute(FORMULA_STATE_ATTRIBUTE, 'valid');
      } catch (error) {
        cell.textContent = error instanceof FormulaError ? error.code : ERROR.Formula;
        cell.setAttribute(FORMULA_STATE_ATTRIBUTE, 'error');
      }
    });
  }

  evaluateAll(root: ParentNode): void {
    const tables: HTMLTableElement[] = [];
    const rootElement = root as Element;
    if (rootElement.matches?.('table')) {
      tables.push(rootElement as HTMLTableElement);
    }
    root.querySelectorAll<HTMLTableElement>('table').forEach(table => tables.push(table));
    tables.forEach(table => this.evaluate(table));
  }
}

export { ERROR as FormulaTableError };
