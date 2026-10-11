/** Quét log theo từng đoạn block (RPC công khai thường giới hạn khoảng quét của eth_getLogs)
 *  và nhớ block đã quét để các lần poll sau chỉ lấy phần mới. */
export function createLogScanner(step = 50000, minStep = 2000) {
  let next = null, logs = [];
  return async function scan(query, from, latest) {
    if (next === null) next = from;
    let s = step;
    while (next <= latest) {
      const to = Math.min(next + s - 1, latest);
      try { logs = logs.concat(await query(next, to)); next = to + 1; }
      catch (e) { if (s <= minStep) throw e; s = Math.max(minStep, Math.floor(s / 2)); }
    }
    return logs;
  };
}
