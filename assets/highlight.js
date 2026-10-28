// Minimal syntax highlighter, self-hosted on purpose: no third-party requests (privacy policy, CSP).
// tokenize() returns [{ type, text }] covering the input losslessly; type null means plain text.
// ponytail: regex tokenizer, misses nested constructs ($() inside strings); swap in a real parser if that matters.
var HIGHLIGHT_LANGS = {
    powershell: [
        ['comment',  /<#[\s\S]*?#>|#.*/],
        ['string',   /@"[\s\S]*?"@|@'[\s\S]*?'@|"(?:[^"`]|`[\s\S])*"|'(?:[^']|'')*'/],
        ['variable', /\$(?:\{[^}]*\}|[\w:?]+)/],
        ['type',     /\[[A-Za-z][\w.]*(?:\[\])?\]/],
        ['operator', /-(?:eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|in|notin|contains|notcontains|replace|split|join|and|or|not|is|isnot|as|f)\b/],
        ['keyword',  /\b(?:function|param|begin|process|end|if|elseif|else|foreach|for|while|do|until|switch|try|catch|finally|return|break|continue|exit|throw)\b/],
        ['command',  /\b[A-Z][A-Za-z]*(?:-[A-Z][A-Za-z]*)+\b/],
        ['param',    /-[A-Za-z]\w*/],
        ['number',   /\b\d+(?:\.\d+)?\b/]
    ]
};

function tokenize(source, language) {
    var rules = HIGHLIGHT_LANGS[String(language).toLowerCase()];
    if (!rules) return [{ type: null, text: source }];

    // One alternation with a capture group per rule: the earliest match wins, ties go to the earlier rule
    var re = new RegExp(rules.map(function(r) { return '(' + r[1].source + ')'; }).join('|'), 'g');
    var tokens = [];
    var last = 0;
    var m;
    while ((m = re.exec(source)) !== null) {
        if (m.index > last) tokens.push({ type: null, text: source.slice(last, m.index) });
        var i = 1;
        while (m[i] === undefined) i++;
        tokens.push({ type: rules[i - 1][0], text: m[0] });
        last = re.lastIndex;
    }
    if (last < source.length) tokens.push({ type: null, text: source.slice(last) });
    return tokens;
}

if (typeof module !== 'undefined') module.exports = { tokenize: tokenize };
