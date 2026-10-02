/* IndexedDB 저장소: CRUD, 휴지통 (PRD F2, F6) */
(function (STM) {
  'use strict';

  const C = STM.constants;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
        return;
      }
      const req = indexedDB.open(C.DB_NAME, C.DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(C.STORE)) {
          const store = db.createObjectStore(C.STORE, { keyPath: 'id' });
          store.createIndex('docNo', 'docNo', { unique: true });
          store.createIndex('category', 'category');
          store.createIndex('date', 'date');
          store.createIndex('status', 'status');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // 다른 탭에서 DB 버전을 올리면 연결을 닫아 업그레이드를 막지 않는다.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('다른 탭에서 앱이 열려 있어 저장소를 열 수 없습니다. 다른 탭을 닫고 새로고침하세요.'));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  }

  function friendlyError(err) {
    if (err && err.name === 'ConstraintError') {
      const e = new Error('이미 같은 문서번호가 등록되어 있습니다.');
      e.code = 'DUPLICATE';
      return e;
    }
    if (err && err.name === 'QuotaExceededError') return new Error('브라우저 저장 공간이 부족합니다.');
    return err || new Error('저장소 오류가 발생했습니다.');
  }

  // work(store, ctx, tx)에서 ctx.result를 채우면 트랜잭션 완료 후 그 값으로 resolve한다.
  function transact(mode, work) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          let tx;
          try {
            tx = db.transaction(C.STORE, mode);
          } catch (e) {
            reject(friendlyError(e));
            return;
          }
          const ctx = { result: undefined, error: null };
          tx.oncomplete = () => resolve(ctx.result);
          tx.onabort = () => reject(friendlyError(ctx.error || tx.error));
          try {
            work(tx.objectStore(C.STORE), ctx, tx);
          } catch (e) {
            ctx.error = e;
            try {
              tx.abort();
            } catch (_) {
              /* 이미 끝난 트랜잭션 */
            }
          }
        })
    );
  }

  function request(mode, makeRequest) {
    return transact(mode, (store, ctx) => {
      const req = makeRequest(store);
      req.onsuccess = () => {
        ctx.result = req.result;
      };
    });
  }

  const getAllRaw = () => request('readonly', (s) => s.getAll());
  const get = (id) => request('readonly', (s) => s.get(id));
  const getByDocNo = (docNo) => request('readonly', (s) => s.index('docNo').get(docNo));
  const hardDelete = (id) => request('readwrite', (s) => s.delete(id));

  function add(ruling) {
    return transact('readwrite', (store, ctx) => {
      store.add(ruling);
      ctx.result = ruling;
    });
  }

  // 읽기-수정-쓰기를 한 트랜잭션에서 처리해 동시 저장 시 다른 필드를 덮어쓰지 않는다.
  function mutate(id, fn) {
    return transact('readwrite', (store, ctx, tx) => {
      const req = store.get(id);
      req.onsuccess = () => {
        if (!req.result) {
          ctx.error = new Error('해당 항목을 찾을 수 없습니다.');
          tx.abort();
          return;
        }
        const next = fn(req.result);
        store.put(next);
        ctx.result = next;
      };
    });
  }

  // patch는 객체 또는 (현재 레코드) => 변경할 필드 객체 함수
  function update(id, patch) {
    return mutate(id, (cur) => {
      const changes = typeof patch === 'function' ? patch(cur) : patch;
      return Object.assign({}, cur, changes, { id: cur.id, createdAt: cur.createdAt, updatedAt: new Date().toISOString() });
    });
  }

  const softDelete = (id) => mutate(id, (cur) => Object.assign({}, cur, { deletedAt: new Date().toISOString() }));
  const restore = (id) => mutate(id, (cur) => Object.assign({}, cur, { deletedAt: null }));

  // 백업 가져오기용: 한 트랜잭션에서 (선택적으로 전체 삭제 후) 여러 건을 저장한다. 하나라도 실패하면 모두 취소된다.
  function bulkPut(records, options) {
    return transact('readwrite', (store, ctx) => {
      if (options && options.clear) store.clear();
      records.forEach((r) => store.put(r));
      ctx.result = records.length;
    });
  }

  function purgeExpiredTrash(days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return transact('readwrite', (store, ctx) => {
      ctx.result = 0;
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const deletedAt = cursor.value.deletedAt;
        if (deletedAt && Date.parse(deletedAt) < cutoff) {
          cursor.delete();
          ctx.result++;
        }
        cursor.continue();
      };
    });
  }

  // 브라우저가 저장소를 자동 정리하지 않도록 영구 저장을 요청한다 (PRD F6-6).
  async function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) {
      /* 지원하지 않는 환경 */
    }
    return false;
  }

  STM.db = { open, getAllRaw, get, getByDocNo, add, update, softDelete, restore, hardDelete, bulkPut, purgeExpiredTrash, requestPersist };
})(window.STM);
