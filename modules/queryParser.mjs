const FIELD_NAMES = new Set(['from', 'subject', 'body', 'fileext']);

export function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue; }
    if (input[i] === '-') { tokens.push({ type: 'NOT', value: '-' }); i++; continue; }
    if (input[i] === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue; }
    if (input[i] === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue; }
    if (input[i] === '"') {
      const quoteStart = i;
      i++;
      let str = '';
      while (i < input.length && input[i] !== '"') str += input[i++];
      if (i >= input.length) {
        throw new SyntaxError(`Незакрытая кавычка в позиции ${quoteStart + 1}`);
      }
      i++;
      tokens.push({ type: 'QUOTED', value: str });
      continue;
    }

    let word = '';
    while (i < input.length && !/[\s"()]/.test(input[i])) word += input[i++];
    if (!word) { i++; continue; }

    const upper = word.toUpperCase();
    if (upper === 'AND') tokens.push({ type: 'AND', value: 'AND' });
    else if (upper === 'OR') tokens.push({ type: 'OR', value: 'OR' });
    else if (word.includes(':')) {
      const colonIdx = word.indexOf(':');
      const fieldPart = word.substring(0, colonIdx).toLowerCase();
      const rest = word.substring(colonIdx + 1);
      if (FIELD_NAMES.has(fieldPart)) {
        tokens.push({ type: 'FIELD', value: fieldPart });
        if (rest.length > 0) tokens.push({ type: 'WORD', value: rest });
      } else {
        tokens.push({ type: 'WORD', value: word });
      }
    } else tokens.push({ type: 'WORD', value: word });
  }
  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }
  peek() { return this.tokens[this.pos]; }
  consume() { return this.tokens[this.pos++]; }
  parse() {
    const node = this.parseOr();
    const trailing = this.peek();
    if (trailing.type === 'RPAREN') throw new SyntaxError('Лишняя закрывающая скобка');
    if (trailing.type !== 'EOF') throw new SyntaxError(`Неожиданный токен: ${trailing.value}`);
    return node;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.peek().type === 'OR') {
      this.consume();
      left = { type: 'OR', left, right: this.parseAnd() };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (true) {
      const { type } = this.peek();
      if (type === 'AND') {
        this.consume();
        left = { type: 'AND', left, right: this.parseNot() };
      } else if (type === 'NOT' || type === 'WORD' || type === 'QUOTED' || type === 'FIELD' || type === 'LPAREN') {
        left = { type: 'AND', left, right: this.parseNot() };
      } else break;
    }
    return left;
  }

  parseNot() {
    if (this.peek().type === 'NOT') {
      this.consume();
      return { type: 'NOT', operand: this.parsePrimary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    if (this.peek().type === 'LPAREN') {
      this.consume();
      if (this.peek().type === 'RPAREN') throw new SyntaxError('Пустая группа условий');
      const node = this.parseOr();
      if (this.peek().type !== 'RPAREN') throw new SyntaxError('Не закрыта скобка');
      this.consume();
      return node;
    }
    return this.parseTerm();
  }

  parseTerm() {
    let field = 'subject';
    if (this.peek().type === 'FIELD') field = this.consume().value;

    let value = '';
    let exact = false;
    if (this.peek().type === 'QUOTED') {
      value = this.consume().value;
      exact = true;
    } else if (this.peek().type === 'WORD') {
      value = this.consume().value;
    }
    if (!value) {
      if (this.peek().type === 'EOF') throw new SyntaxError('Ожидалось значение условия');
      throw new SyntaxError(`Ожидалось значение условия перед «${this.peek().value}»`);
    }

    if (field === 'from') return { type: 'TERM', field: 'sender_email', value, exact };
    return { type: 'TERM', field, value, exact };
  }
}

export function parseQuery(query) {
  if (!query || !query.trim()) return null;
  return new Parser(tokenize(query.trim())).parse();
}
