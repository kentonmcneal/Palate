/* Offline handler tests: node THIS_FILE PALATE_ROOT [PROPOSAL_DIRECTORY]
 * No credentials, network, SDK, or live DB. Executes real transpiled handlers.
 * Query/SDK mocks are NOT evidence of PostgreSQL RLS enforcement.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const [repo, proposal] = process.argv.slice(2);
const ts = createRequire(path.join(repo, 'mobile/package.json'))('typescript');
function fixture(options = {}) {
  const caller = '00000000-0000-4000-8000-000000000001';
  const peer = '00000000-0000-4000-8000-000000000002';
  const follows = options.oneWay ? [{ follower_id: caller, followee_id: peer }] : [
    { follower_id: caller, followee_id: peer }, { follower_id: peer, followee_id: caller },
  ];
  return { caller, peer, data: {
    follows,
    profiles: [
      { id: caller, profile_visibility: options.posterVisibility || 'public', display_name: 'Poster', push_token: 'caller-token', push_social_activity: true },
      { id: peer, profile_visibility: options.visibility || 'public', push_token: 'peer-token', push_social_activity: true },
    ],
    blocked_users: options.block === 'outgoing' ? [{ blocker_id: caller, blocked_id: peer }] : options.block === 'incoming' ? [{ blocker_id: peer, blocked_id: caller }] : [],
    visits: [{ id: 'visit', user_id: caller, is_public: options.hidden !== true, restaurant: null }],
    restaurants_resolved: [], place_dislikes: [],
    feature_flags: [{ key: 'server_push', enabled: options.pushEnabled !== false }],
    feed_events: [{ id: 'post', user_id: options.otherOwner ? peer : caller, kind: 'visit_logged', visit_id: options.visitLinked ? 'visit' : null, payload: { restaurant_name: 'Sensitive venue' } }],
  } };
}
async function run(name, options = {}) {
  const f = fixture(options), reads = [], pushes = [], authTokens = [];
  if (name === 'notify-feed-post' && options.oneWay) f.data.follows = [{ follower_id: f.peer, followee_id: f.caller }];
  if (options.wrongVisitOwner) f.data.visits[0].user_id = f.peer;
  const admin = {
    auth: { async getUser(token) { authTokens.push(token); return options.badAuth ? { data: { user: null }, error: { message: 'invalid' } } : { data: { user: { id: f.caller } }, error: null }; } },
    from(table) {
      reads.push(table);
      let rows = (f.data[table] || []).slice(), single = false;
      const q = {
        select() { return q; }, eq(k, v) { rows = rows.filter(r => r[k] === v); return q; },
        in(k, vals) { rows = rows.filter(r => vals.includes(r[k])); return q; },
        not(k, op, v) { rows = rows.filter(r => r[k] !== v); return q; },
        or() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; },
        limit(n) { rows = rows.slice(0, n); return q; },
        maybeSingle() { single = true; return q; },
        then(resolve, reject) { return Promise.resolve(options.readError === table
          ? { data: null, error: { message: 'fixture read failure' } }
          : { data: single ? rows[0] || null : rows, error: null }).then(resolve, reject); },
      };
      return q;
    },
  };
  let handler;
  const file = proposal ? path.join(proposal, `${name}.proposed.ts`) : path.join(repo, `supabase/functions/${name}/index.ts`);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Request, Response, console: { error() {} },
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://fixture.invalid' : 'fixture-key' } },
    require(name) {
      if (name.includes('/http/server')) return { serve: h => { handler = h; } };
      if (name.includes('supabase-js')) return { createClient: () => admin };
      if (name.endsWith('/err-text.ts')) return { errText: e => e?.message || String(e) };
      if (name.endsWith('/retry.ts')) return { retryRead: run => run() };
      throw new Error(`Unexpected import ${name}`);
    },
    fetch: async (url, init) => {
      assert.equal(url, 'https://exp.host/--/api/v2/push/send');
      pushes.push(...JSON.parse(init.body)); return new Response('{}', { status: 200 });
    },
  }, { filename: file });
  const response = await handler(new Request('https://fixture.invalid/function', {
    method: 'POST', headers: { ...(options.noAuth ? {} : { Authorization: 'Bearer fixture-user-jwt' }), 'Content-Type': 'application/json' },
    body: JSON.stringify(name === 'group-recs' ? { lat: 38, lng: -76, member_ids: [f.peer] } : { feed_event_id: 'post' }),
  }));
  return { status: response.status, body: await response.json(), reads, pushes, authTokens };
}
let count = 0;
async function test(name, body) { await body(); console.log('PASS ' + name); count++; }
(async () => {
  for (const opts of [{ noAuth: true }, { badAuth: true }]) {
    for (const name of ['group-recs', 'notify-feed-post']) await test(`${name} refuses ${JSON.stringify(opts)}`, async () => {
      const r = await run(name, opts); assert.equal(r.status, 401); assert.equal(r.pushes.length, 0); assert.equal(r.reads.length, 0);
    });
  }
  for (const block of ['incoming', 'outgoing']) await test(`group blocks ${block}, even when follows remain`, async () => {
    const r = await run('group-recs', { block }); assert.equal(r.status, 403); assert.ok(!r.reads.includes('visits'));
  });
  for (const opts of [{ visibility: 'private' }, { visibility: 'friends', oneWay: true }]) await test(`group refuses ${JSON.stringify(opts)}`, async () => {
    const r = await run('group-recs', opts); assert.equal(r.status, 403); assert.ok(!r.reads.includes('visits'));
  });
  for (const readError of ['blocked_users', 'profiles', 'follows']) await test(`group fails closed on ${readError}`, async () => {
    const r = await run('group-recs', { readError }); assert.equal(r.status, 503); assert.ok(!r.reads.includes('visits'));
  });
  for (const visibility of ['public', 'friends']) await test(`group preserves authorized ${visibility} recommendations`, async () => {
    const r = await run('group-recs', { visibility }); assert.equal(r.status, 200); assert.ok(r.reads.includes('visits'));
  });
  for (const opts of [{ posterVisibility: 'private' }, { posterVisibility: 'friends', oneWay: true }, { block: 'incoming' }, { block: 'outgoing' }, { visitLinked: true, hidden: true }, { visitLinked: true, wrongVisitOwner: true }, { pushEnabled: false }]) await test(`notify sends nothing for ${JSON.stringify(opts)}`, async () => {
    const r = await run('notify-feed-post', opts); assert.equal(r.status, 200); assert.equal(r.pushes.length, 0);
  });
  for (const readError of ['blocked_users', 'follows', 'visits']) await test(`notify fails closed on ${readError}`, async () => {
    const r = await run('notify-feed-post', { readError, visitLinked: true }); assert.equal(r.status, 500); assert.equal(r.pushes.length, 0);
  });
  await test('notify refuses another owner’s event', async () => {
    const r = await run('notify-feed-post', { otherOwner: true }); assert.equal(r.status, 403); assert.equal(r.pushes.length, 0);
  });
  for (const posterVisibility of ['public', 'friends']) await test(`notify preserves authorized ${posterVisibility} recipient`, async () => {
    const r = await run('notify-feed-post', { posterVisibility, visitLinked: true }); assert.equal(r.status, 200);
    assert.equal(r.pushes.length, 1); assert.equal(r.pushes[0].to, 'peer-token'); assert.deepEqual(r.authTokens, ['fixture-user-jwt']);
  });
  console.log(`${count} offline handler cases passed; no SQL or live services invoked.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
