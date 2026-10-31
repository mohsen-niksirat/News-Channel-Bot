// In-memory mock for sdk/db

export function table(name, columns, extraFn) {
  const t = { _tableName: name, ...columns };
  for (const [k, v] of Object.entries(columns)) {
    if (v && typeof v === 'object') {
      v._key = k;
      v._colName = v._colName || k;
    }
  }
  return t;
}

export function integer(colName) {
  return {
    _type: 'integer',
    _colName: colName,
    primaryKey(opt) { this._primaryKey = true; this._autoIncrement = opt?.autoIncrement; return this; },
    default(val) { this._default = val; return this; },
    notNull() { this._notNull = true; return this; },
    unique() { this._unique = true; return this; },
  };
}

export function text(colName) {
  return {
    _type: 'text',
    _colName: colName,
    default(val) { this._default = val; return this; },
    notNull() { this._notNull = true; return this; },
    unique() { this._unique = true; return this; },
  };
}

export function boolean(colName) {
  return {
    _type: 'boolean',
    _colName: colName,
    default(val) { this._default = val; return this; },
    notNull() { this._notNull = true; return this; },
  };
}

export function index(idxName) {
  return {
    on(...cols) { return { _indexName: idxName, _cols: cols }; }
  };
}

export function sql(strings, ...values) {
  return { _sql: true, strings, values };
}

export function eq(col, val) {
  const key = col?._key || col?._colName || col;
  return (row) => row[key] === val;
}

export function and(...preds) {
  const clean = preds.filter(Boolean);
  return (row) => clean.every((fn) => typeof fn === 'function' ? fn(row) : true);
}

export function or(...preds) {
  const clean = preds.filter(Boolean);
  return (row) => clean.length === 0 || clean.some((fn) => typeof fn === 'function' ? fn(row) : false);
}

export function asc(col) {
  const key = col?._key || col?._colName || col;
  return { key, dir: 'asc' };
}

export function desc(col) {
  const key = col?._key || col?._colName || col;
  return { key, dir: 'desc' };
}
