// Ein simulierter Launcher für die Zwei-Spieler-Tests. Aufruf: node e2e-client.js <Szenario> <Name> <Anderer> <Port>
const crypto = require('crypto');
const [, , SCEN, NAME, OTHER, PORT] = process.argv;
const md5 = (s) => crypto.createHash('md5').update(s.toLowerCase()).digest('hex');
const dash = (h) => h.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
const me = md5(NAME), other = dash(md5(OTHER));
const realFetch = globalThis.fetch;
const party = SCEN.startsWith('party');
const store = { profiles: SCEN === 'party-A' ? [{ id: 'pa', name: 'Party Vanilla', version: '1.21.1', loader: '', loaderVersion: '', memory: 4, installed: {} }] : [], accounts: [{ id: me, name: NAME, refreshToken: NAME }], currentAccount: null, settings: { presenceServer: `http://127.0.0.1:${PORT}` }, friendsByAccount: party ? { [me]: [{ uuid: other, name: OTHER, added: Date.now() }] } : {} };
const msmc = { Auth: class { async refresh(tok) { return { msToken: { refresh_token: tok }, getMinecraft: async () => ({ mclc: () => ({ access_token: 'x', name: tok }), profile: { id: md5(tok), name: tok, skins: [], capes: [] } }) }; } } };
const h = require('./harness')({ store, msmc, fetch: async (url, opts) => { const u = String(url); if (u.includes('session/minecraft/join')) return new Response(null, { status: 204 }); if (u.includes('api.mojang.com/users/profiles/minecraft/')) { const n = decodeURIComponent(u.split('/').pop()); return new Response(JSON.stringify({ id: md5(n), name: n })); } return realFetch(url, opts); } });
const launched = []; h.electron.ipcMain.handle('launch', async (_e, id, server) => { launched.push({ id, server }); return true; });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, tries = 30) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(500); } return null; };
const log = (m) => console.log(`[${NAME}] ${m}`);
(async () => {
  await h.call('auth:switch', me);
  await h.call('friends:list'); await sleep(1200); await h.call('friends:list');
  if (SCEN === 'freunde-A') {
    const r = await h.call('friends:add', OTHER); h.ok(r.result === 'sent', 'Anfrage gesendet');
    const l = await until(async () => { await sleep(1500); const x = await h.call('friends:list'); return x.friends.find(f => f.name === OTHER && f.online) && x; });
    h.ok(!!l, 'nach Annahme gegenseitig online');
    await h.call('friends:setStatus', { status: 'away', note: 'Suche Leute' });
    await h.call('friends:invite', { uuid: other, message: 'Komm rüber' }); h.ok(true, 'Einladung gesendet');
  } else if (SCEN === 'freunde-B') {
    const req = await until(async () => (await h.call('friends:list')).incoming.find(x => x.name === OTHER));
    h.ok(!!req, 'Anfrage angekommen');
    await h.call('friends:respond', { uuid: req.uuid, accept: true });
    const seen = await until(async () => { await sleep(1000); const f = (await h.call('friends:list')).friends.find(x => x.name === OTHER); return f?.online && f.note === 'Suche Leute' && f; }, 40);
    h.ok(!!seen, 'sieht Status und Notiz des Freundes');
    h.ok(!!(await until(async () => h.notes.some(n => /lädt dich ein/.test(n)), 20)), 'Einladung als Benachrichtigung');
  } else if (SCEN === 'party-A') {
    await sleep(1500);
    await h.call('chat:send', { to: other, text: 'Party?' });
    await h.call('party:create'); await h.call('party:invite', other);
    h.ok(!!(await until(async () => (await h.call('social:poll')).party?.members.length === 2)), 'Freund ist der Party beigetreten');
    const v = await h.call('party:plan', { profileId: 'pa', server: 'gommehd.net' }); h.ok(!!v.party.plan?.code, 'Plan festgelegt');
    h.ok(!!(await until(async () => (await h.call('social:poll')).party.members.every(m => m.ready))), 'alle bereit');
    await h.call('party:launch', 3);
    h.ok(!!(await until(async () => launched.length, 20)) && launched[0].server === 'gommehd.net', 'Leiter startet gemeinsam');
    h.ok((await h.call('chat:thread', other)).some(m => m.in && m.text === 'Bin dabei'), 'Antwort im Chat');
  } else if (SCEN === 'party-B') {
    h.ok(!!(await until(async () => { await h.call('social:poll'); return (await h.call('chat:threads'))[0]?.unread === 1; })), 'Nachricht angekommen');
    await h.call('chat:send', { to: other, text: 'Bin dabei' });
    const inv = await until(async () => (await h.call('social:poll')).invites[0]); h.ok(!!inv, 'Party-Einladung erhalten');
    await h.call('party:join', inv.id);
    h.ok(!!(await until(async () => (await h.call('social:poll')).party?.plan)), 'Plan sichtbar');
    const r = await h.call('party:ready', true); h.ok(!!r.profileId, 'bereit – Profil automatisch eingerichtet');
    h.ok(!!(await until(async () => { await h.call('social:poll'); return launched.length; })) && launched[0].server === 'gommehd.net', 'Mitglied startet gemeinsam');
  }
  h.done();
})().catch(e => { console.error(NAME, e); process.exit(1); });
