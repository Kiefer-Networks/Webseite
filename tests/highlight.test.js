// Run: node tests/highlight.test.js
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');
var tokenize = require('../assets/highlight.js').tokenize;

function types(src) {
    return tokenize(src, 'PowerShell').filter(function(t) { return t.type; })
        .map(function(t) { return t.type + ':' + t.text; });
}

// Lossless: joining all tokens gives back every published script unchanged
var manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/scripts.json'), 'utf8'));
manifest.scripts.forEach(function(s) {
    var src = fs.readFileSync(path.join(__dirname, '../scripts', s.file), 'utf8');
    assert.strictEqual(tokenize(src, s.language).map(function(t) { return t.text; }).join(''), src, s.file);
});

assert.deepStrictEqual(types('# note $x'), ['comment:# note $x']);
assert.deepStrictEqual(types("'it''s' \"a`\"b\""), ["string:'it''s'", 'string:"a`"b"']);
assert.deepStrictEqual(types('$env:TEMP -replace [regex]::Escape($pw)'),
    ['variable:$env:TEMP', 'operator:-replace', 'type:[regex]', 'variable:$pw']);
assert.deepStrictEqual(types('Write-Log -Level 3'), ['command:Write-Log', 'param:-Level', 'number:3']);
assert.deepStrictEqual(types('$h[$i]'), ['variable:$h', 'variable:$i']);
assert.deepStrictEqual(types('if ($a) { exit 2 }'), ['keyword:if', 'variable:$a', 'keyword:exit', 'number:2']);
assert.deepStrictEqual(tokenize('x', 'cobol'), [{ type: null, text: 'x' }]);

console.log('highlight: all checks passed');
