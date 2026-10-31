// In-memory mock for sdk

const store = {
  users: [],
  sources: [],
  custom_providers: [],
  ai_keys: [],
  token_usage: [],
  posts: [],
};

let autoInc = 1;
export const sentMessages = [];

export function resetMockDb() {
  for (const k of Object.keys(store)) {
    store[k] = [];
  }
  autoInc = 1;
  sentMessages.length = 0;
}

let mockFetchFn = null;
export function setMockFetch(fn) {
  mockFetchFn = fn;
}

export const fetch = async (...args) => {
  if (mockFetchFn) {
    return await mockFetchFn(...args);
  }
  return await globalThis.fetch(...args);
};

export const api = {
  sendMessage: async (args) => {
    sentMessages.push(args);
    return { message_id: Math.floor(Math.random() * 10000) + 1, ...args };
  },
  editMessageText: async (args) => {
    sentMessages.push({ action: 'editMessageText', ...args });
    return { message_id: args.message_id };
  },
  answerCallbackQuery: async (args) => {
    return { ok: true };
  },
  setChatMenuButton: async (args) => {
    return { ok: true };
  },
  getChatMenuButton: async (args) => {
    return { type: 'default' };
  },
};

export const db = {
  _store: store,

  select(selectFields) {
    let tableName = null;
    let wherePred = null;
    let orderList = [];
    let limitCount = null;

    const builder = {
      from(t) {
        tableName = t?._tableName || t;
        return builder;
      },
      where(pred) {
        wherePred = pred;
        return builder;
      },
      orderBy(...orders) {
        orderList = orders;
        return builder;
      },
      limit(n) {
        limitCount = n;
        return builder;
      },
      async get() {
        const rows = await builder.all();
        return rows[0] || null;
      },
      async all() {
        const tableData = store[tableName] || [];
        let result = tableData.slice();

        if (wherePred) {
          result = result.filter(wherePred);
        }

        if (orderList.length > 0) {
          result.sort((a, b) => {
            for (const ord of orderList) {
              const k = ord?.key || ord;
              const dir = ord?.dir === 'desc' ? -1 : 1;
              const va = a[k] !== undefined ? a[k] : 0;
              const vb = b[k] !== undefined ? b[k] : 0;
              if (va < vb) return -1 * dir;
              if (va > vb) return 1 * dir;
            }
            return 0;
          });
        }

        if (limitCount !== null) {
          result = result.slice(0, limitCount);
        }

        // Project fields if specified
        if (selectFields && typeof selectFields === 'object') {
          return result.map((r) => {
            const out = {};
            for (const [outKey, srcCol] of Object.entries(selectFields)) {
              const inKey = srcCol?._key || srcCol?._colName || outKey;
              out[outKey] = r[inKey];
            }
            return out;
          });
        }

        return result.map(r => ({ ...r }));
      },
    };

    return builder;
  },

  insert(table) {
    const tableName = table?._tableName || table;
    let valuesObj = {};
    let shouldReturn = false;

    const builder = {
      values(val) {
        valuesObj = val;
        return builder;
      },
      returning() {
        shouldReturn = true;
        return builder;
      },
      async run() {
        if (!store[tableName]) store[tableName] = [];
        const newRow = {
          id: valuesObj.id || autoInc++,
          createdAt: Math.floor(Date.now() / 1000),
          ...valuesObj,
        };
        store[tableName].push(newRow);
        if (shouldReturn) {
          return [{ ...newRow }];
        }
        return { changes: 1 };
      },
    };

    return builder;
  },

  update(table) {
    const tableName = table?._tableName || table;
    let patch = {};
    let wherePred = null;

    const builder = {
      set(val) {
        patch = val;
        return builder;
      },
      where(pred) {
        wherePred = pred;
        return builder;
      },
      async run() {
        const tableData = store[tableName] || [];
        let count = 0;
        for (const row of tableData) {
          if (!wherePred || wherePred(row)) {
            Object.assign(row, patch);
            count++;
          }
        }
        return { changes: count };
      },
    };

    return builder;
  },

  delete(table) {
    const tableName = table?._tableName || table;
    let wherePred = null;

    const builder = {
      where(pred) {
        wherePred = pred;
        return builder;
      },
      async run() {
        const tableData = store[tableName] || [];
        if (!wherePred) {
          const count = tableData.length;
          store[tableName] = [];
          return { changes: count };
        }
        const initialLen = tableData.length;
        store[tableName] = tableData.filter((r) => !wherePred(r));
        return { changes: initialLen - store[tableName].length };
      },
    };

    return builder;
  },
};
