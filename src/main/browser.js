// Mod-Browser 3.0: Modrinth-Suche mit Kategorien, Sortierung, Details, Galerie, Versionswahl und Kompatibilitäts-Check
const MR = 'https://api.modrinth.com/v2';
const TYPES = { mods: 'mod', modpacks: 'modpack', resourcepacks: 'resourcepack', shaderpacks: 'shader', datapacks: 'datapack' };
module.exports = function browser(ctx) {
  const { ipcMain, getJson, profileById, store, pickVersion, installModrinthVersion, ensureFabricApi, tmSnapshotQuiet, saveStore, handlers, send, kindDir } = ctx;
  const fs = require('fs'), path = require('path');
  let tagCache = null;
  const installedIds = (p) => new Set(Object.keys(p?.installed || {}).filter(k => { const f = p.installed[k]; return f && ['mods', 'resourcepacks', 'shaderpacks'].some(d => fs.existsSync(path.join(kindDir(p.id, d), f)) || fs.existsSync(path.join(kindDir(p.id, d), f + '.disabled'))); }));

  ipcMain.handle('browser:tags', async () => {
    if (!tagCache) {
      const cats = await getJson(`${MR}/tag/category`);
      tagCache = { categories: cats.filter(c => c.header !== 'resolutions').map(c => ({ name: c.name, type: c.project_type, header: c.header, icon: c.icon })) };
    }
    return tagCache;
  });

  ipcMain.handle('browser:search', async (_e, { query = '', kind = 'mods', categories = [], sort = 'relevance', profileId, page = 0, limit = 24, any = false }) => {
    const p = profileById(profileId);
    const facets = [[`project_type:${TYPES[kind] || 'mod'}`]];
    for (const c of categories) facets.push([`categories:${c}`]);
    if (p && !any) {
      if (kind !== 'modpacks') facets.push([`versions:${p.version}`]);
      if (kind === 'mods' && p.loader) facets.push([`categories:${p.loader}`]);
    }
    const idx = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'relevance';
    const u = `${MR}/search?limit=${limit}&offset=${page * limit}&index=${query || idx !== 'relevance' ? idx : 'downloads'}&query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
    const r = await getJson(u); const inst = installedIds(p);
    return { total: r.total_hits, page, items: r.hits.map(h => ({ id: h.project_id, slug: h.slug, title: h.title, desc: h.description, icon: h.icon_url, author: h.author, downloads: h.downloads, follows: h.follows, categories: h.display_categories || h.categories, banner: h.featured_gallery || h.gallery?.[0] || null, color: h.color, updated: h.date_modified, client: h.client_side, server: h.server_side, installed: inst.has(h.project_id) })) };
  });

  ipcMain.handle('browser:project', async (_e, { id, profileId }) => {
    const p = profileById(profileId);
    const pr = await getJson(`${MR}/project/${encodeURIComponent(id)}`);
    let versions = [];
    const q = new URLSearchParams();
    if (p && pr.project_type !== 'modpack') { q.set('game_versions', JSON.stringify([p.version])); if (pr.project_type === 'mod' && p.loader) q.set('loaders', JSON.stringify([p.loader])); }
    try { versions = await getJson(`${MR}/project/${pr.id}/version?${q}`); } catch {}
    const all = versions.length || !p ? versions : [];
    // Abhängigkeiten der empfohlenen Version prüfen
    const best = pickVersion(versions) || null; let deps = [];
    if (best) {
      const req = (best.dependencies || []).filter(d => d.dependency_type === 'required' && d.project_id);
      if (req.length) {
        let projs = []; try { projs = await getJson(`${MR}/projects?ids=${encodeURIComponent(JSON.stringify(req.map(d => d.project_id)))}`); } catch {}
        deps = await Promise.all(req.map(async (d) => { const x = projs.find(y => y.id === d.project_id); let ok = true; if (p) { try { const q2 = new URLSearchParams({ game_versions: JSON.stringify([p.version]) }); if (p.loader) q2.set('loaders', JSON.stringify([p.loader])); ok = (await getJson(`${MR}/project/${d.project_id}/version?${q2}`)).length > 0; } catch { ok = false; } } return { id: d.project_id, title: x?.title || d.project_id, icon: x?.icon_url || null, available: ok }; }));
      }
    }
    const inst = installedIds(p);
    return {
      id: pr.id, slug: pr.slug, type: pr.project_type, title: pr.title, desc: pr.description, body: String(pr.body || '').slice(0, 30000), icon: pr.icon_url, downloads: pr.downloads, followers: pr.followers,
      categories: pr.categories, loaders: pr.loaders, gameVersions: (pr.game_versions || []).slice(-12), license: pr.license?.id || pr.license?.name || '', updated: pr.updated, published: pr.published,
      links: { source: pr.source_url, issues: pr.issues_url, wiki: pr.wiki_url, discord: pr.discord_url, page: `https://modrinth.com/${pr.project_type}/${pr.slug}` },
      gallery: (pr.gallery || []).sort((a, b) => (b.featured - a.featured) || a.ordering - b.ordering).slice(0, 16).map(g => ({ url: g.url, raw: g.raw_url || g.url, title: g.title || '', desc: g.description || '' })),
      client: pr.client_side, server: pr.server_side,
      versions: all.slice(0, 30).map(v => ({ id: v.id, name: v.name, number: v.version_number, type: v.version_type, date: v.date_published, downloads: v.downloads, size: (v.files.find(f => f.primary) || v.files[0])?.size || 0, gameVersions: v.game_versions.slice(-4), loaders: v.loaders })),
      recommended: best?.id || null, deps, compatible: !p || pr.project_type === 'modpack' || versions.length > 0, installed: inst.has(pr.id),
      profile: p ? { id: p.id, name: p.name, version: p.version, loader: p.loader || '' } : null,
    };
  });

  ipcMain.handle('browser:install', async (_e, { id, versionId, profileId, kind = 'mods', name }) => {
    if (kind === 'modpacks') return handlers['packs:install'](null, { source: 'modrinth', projectId: id, name });
    const p = profileById(profileId); if (!p) throw new Error('Erst ein Profil wählen');
    await tmSnapshotQuiet(p.id, 'Vor einer Installation (Mod-Browser)');
    let v = null;
    if (versionId) v = await getJson(`${MR}/version/${versionId}`);
    else { const q = new URLSearchParams({ game_versions: JSON.stringify([p.version]) }); if (kind === 'mods' && p.loader) q.set('loaders', JSON.stringify([p.loader])); v = pickVersion(await getJson(`${MR}/project/${id}/version?${q}`)); }
    if (!v) throw new Error(`Keine passende Version für ${p.version}${p.loader ? ' ' + p.loader : ''}`);
    if (kind === 'mods') await ensureFabricApi(p);
    send('launch:progress', { task: `Installiere ${v.name || v.version_number}`, percent: 0.5 });
    const files = await installModrinthVersion(p, kind, v, new Set());
    saveStore(); send('launch:progress', { task: 'Installiert', percent: 0 });
    return { files, profiles: store.profiles };
  });
};
