// Script library: everything is rendered from scripts/scripts.json, so adding a
// script means adding the file and one manifest entry, no HTML changes.
var BASE = 'scripts/';
var library = { categories: [], scripts: [] };
var state = { q: '', cat: '', tags: [] };

var els = {
    library: document.getElementById('library'),
    detail: document.getElementById('detail'),
    categories: document.getElementById('categories'),
    search: document.getElementById('search'),
    tags: document.getElementById('tags'),
    count: document.getElementById('count'),
    list: document.getElementById('list')
};

// Builds DOM nodes with textContent only, so manifest or script text can never inject markup
function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function(key) {
        if (key === 'text') node.textContent = attrs[key];
        else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function(child) { if (child) node.appendChild(child); });
    return node;
}

function categoryName(id) {
    var cat = library.categories.find(function(c) { return c.id === id; });
    return cat ? cat.name : id;
}

// ---- Filtering ----

function haystack(s) {
    return [s.title, s.summary, s.file, s.language, categoryName(s.category)]
        .concat(s.tags, s.platforms, s.rmm || [], s.details || [], s.source || '')
        .join(' ')
        .toLowerCase();
}

function matches(s, ignoreCategory) {
    if (!ignoreCategory && state.cat && s.category !== state.cat) return false;
    if (state.tags.some(function(t) { return s.tags.indexOf(t) === -1; })) return false;
    var text = haystack(s);
    return state.q.toLowerCase().split(/\s+/).every(function(word) { return text.indexOf(word) !== -1; });
}

// ---- URL state (?q=...&cat=...&tags=a,b, detail via #script-id) ----

function readUrl() {
    var params = new URLSearchParams(location.search);
    state.q = params.get('q') || '';
    state.cat = params.get('cat') || '';
    state.tags = (params.get('tags') || '').split(',').filter(Boolean);
}

function writeUrl() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.cat) params.set('cat', state.cat);
    if (state.tags.length) params.set('tags', state.tags.join(','));
    var query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
}

// ---- List view ----

function tagButton(tag) {
    var btn = el('button', { type: 'button', class: 'tag', 'aria-pressed': state.tags.indexOf(tag) !== -1, text: '#' + tag });
    btn.addEventListener('click', function() { toggleTag(tag); });
    return btn;
}

function toggleTag(tag) {
    var i = state.tags.indexOf(tag);
    if (i === -1) state.tags.push(tag); else state.tags.splice(i, 1);
    location.hash = '';
    update();
}

function renderCategories() {
    var visible = library.scripts.filter(function(s) { return matches(s, true); });
    var entries = [{ id: '', name: 'All scripts' }].concat(library.categories);

    els.categories.replaceChildren.apply(els.categories, entries.map(function(cat) {
        var n = visible.filter(function(s) { return !cat.id || s.category === cat.id; }).length;
        var btn = el('button', { type: 'button', 'aria-pressed': state.cat === cat.id }, [
            el('span', { text: cat.name }),
            el('span', { class: 'n', text: String(n) })
        ]);
        if (!n && cat.id !== state.cat) btn.disabled = true;
        btn.addEventListener('click', function() {
            state.cat = cat.id;
            update();
        });
        return el('li', {}, [btn]);
    }));
}

function renderTags() {
    var counts = {};
    library.scripts.forEach(function(s) {
        s.tags.forEach(function(t) { counts[t] = (counts[t] || 0) + 1; });
    });
    var tags = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    els.tags.replaceChildren.apply(els.tags, tags.map(tagButton));
}

function renderList() {
    var found = library.scripts.filter(function(s) { return matches(s); });
    els.count.textContent = found.length + (found.length === 1 ? ' script' : ' scripts');

    els.list.replaceChildren.apply(els.list, found.map(function(s) {
        return el('li', { class: 'script-card' }, [
            el('h3', {}, [el('a', { href: '#' + s.id, text: s.title })]),
            el('div', { class: 'meta' }, [
                el('span', { text: categoryName(s.category) }),
                el('span', { text: s.language }),
                el('span', { text: s.platforms.join(', ') }),
                el('span', { text: 'Updated ' + s.updated })
            ]),
            el('p', { text: s.summary }),
            el('div', { class: 'card-tags' }, s.tags.map(tagButton))
        ]);
    }));
}

function update() {
    writeUrl();
    renderCategories();
    renderTags();
    renderList();
}

// ---- Detail view ----

function table(rows, keyA, keyB) {
    return el('table', {}, [el('tbody', {}, rows.map(function(r) {
        return el('tr', {}, [el('td', { text: r[keyA] }), el('td', { text: r[keyB] })]);
    }))]);
}

function section(title, content) {
    return content ? [el('h3', { text: title }), content] : [];
}

function renderDetail(s) {
    var fileName = s.file.split('/').pop();
    var copy = el('button', { type: 'button', class: 'btn', text: 'Copy script' });
    copy.addEventListener('click', function() {
        navigator.clipboard.writeText(s.source || '').then(function() {
            copy.textContent = 'Copied';
        }, function(err) {
            console.warn('Copy failed:', err);
            copy.textContent = 'Copy failed, use Download';
        });
    });

    var children = [
        el('a', { href: '#', class: 'back', text: '← All scripts' }),
        el('h2', { text: s.title }),
        el('div', { class: 'meta' }, [
            el('span', { text: categoryName(s.category) }),
            el('span', { text: s.language }),
            el('span', { text: s.platforms.join(', ') }),
            s.rmm ? el('span', { text: 'RMM: ' + s.rmm.join(', ') }) : null,
            el('span', { text: 'Updated ' + s.updated }),
            el('span', {}, [el('a', { href: BASE + 'LICENSE', text: 'MIT License' })])
        ]),
        el('p', { text: s.summary }),
        el('div', { class: 'card-tags' }, s.tags.map(tagButton)),
        el('div', { class: 'actions' }, [
            copy,
            el('a', { class: 'btn secondary', href: BASE + s.file, download: fileName, text: 'Download ' + fileName }),
            el('a', { class: 'btn secondary', href: BASE + s.file, text: 'View raw' })
        ])
    ];

    children = children
        .concat(section('What it does', s.details && el('ul', {}, s.details.map(function(d) { return el('li', { text: d }); }))))
        .concat(section('Requirements', s.requirements && el('ul', {}, s.requirements.map(function(d) { return el('li', { text: d }); }))))
        .concat(section('Parameters', s.parameters && table(s.parameters, 'name', 'description')))
        .concat(section('Exit codes', s.exitCodes && table(s.exitCodes, 'code', 'meaning')))
        .concat(section('Example', s.example && el('pre', { class: 'example' }, [el('code', { text: s.example })])))
        .concat(section('Source', el('pre', {}, [el('code', { text: s.source || 'Loading…' })])));

    els.detail.replaceChildren.apply(els.detail, children);
    document.title = s.title + ' – Script Library – Kiefer Networks';
}

function route(keepScroll) {
    var id = decodeURIComponent(location.hash.slice(1));
    var s = library.scripts.find(function(x) { return x.id === id; });
    els.library.hidden = !!s;
    els.detail.hidden = !s;
    if (s) {
        renderDetail(s);
        if (!keepScroll) window.scrollTo(0, 0);
    } else {
        document.title = 'Script Library for MSPs – Kiefer Networks';
    }
}

// ---- Init ----

els.search.addEventListener('input', function() {
    state.q = els.search.value.trim();
    update();
});

window.addEventListener('hashchange', route);

fetch(BASE + 'scripts.json')
    .then(function(res) {
        if (!res.ok) throw new Error('scripts.json: HTTP ' + res.status);
        return res.json();
    })
    .then(function(data) {
        library = data;
        readUrl();
        els.search.value = state.q;
        update();
        route();

        // Load script sources for the code view and full-text search
        return Promise.all(library.scripts.map(function(s) {
            return fetch(BASE + s.file)
                .then(function(res) {
                    if (!res.ok) throw new Error(s.file + ': HTTP ' + res.status);
                    return res.text();
                })
                .then(function(text) { s.source = text; })
                .catch(function(err) { console.error('Script not loaded:', err); });
        }));
    })
    .then(function() {
        renderList();
        route(true);
    })
    .catch(function(err) {
        console.error(err);
        els.count.textContent = 'The script list could not be loaded. Please reload the page.';
    });
