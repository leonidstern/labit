// The few Redis commands the comments API uses, kept in memory: for co/dev.mjs and the tests.
export function memoryRedis() {
  const db = new Map();
  const one = ([cmd, key, ...rest]) => {
    if (cmd === 'PING') return 'PONG';
    if (cmd === 'GET') return db.get(key) ?? null;
    if (cmd === 'SET') return db.set(key, rest[0]) && 'OK';
    if (cmd === 'INCR') return db.set(key, (Number(db.get(key)) || 0) + 1).get(key);
    if (cmd === 'EXPIRE') return 1;
    if (cmd === 'HGETALL') return [...(db.get(key) || [])].flat();
    const h = db.get(key) || db.set(key, new Map()).get(key);
    if (cmd === 'HSET') for (let i = 0; i < rest.length; i += 2) h.set(rest[i], rest[i + 1]);
    else if (cmd === 'HDEL') for (const f of rest) h.delete(f);
    else throw new Error(`unknown command ${cmd}`);
    return rest.length;
  };
  const run = async (commands) => commands.map(one);
  run.db = db;
  return run;
}
