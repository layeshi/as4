import test from 'node:test';
import assert from 'node:assert/strict';
import { countWord, nameKey } from '../src/text.js';
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
function original(text, key) {
  if (!key) return 0;
  const hay = text.toLowerCase();
  if (cjk.test(key)) {
    let n = 0, from = 0;
    for (;;) { const at = hay.indexOf(key, from); if (at < 0) return n; n++; from = at + key.length; }
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (hay.match(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu')) || []).length;
}
test('word substring prefilter preserves original Unicode, literal regex and boundary counts', () => {
  const words = ['猫','猫猫','かな','한글','Straße','İ','FOO','foo_bar','a+b','a.b','[word]','𐐀','café','cafe\u0301','', '\\', '\ud800'];
  const texts = ['', '猫猫猫かな한글', 'foo FOOBAR foo_bar !FOO! 1foo foo1', 'İ i\u0307 𐐀𐐨', words.join(' / '), words.join(''), words.join('_')];
  for (const text of texts) for (const word of words) {
    const key = nameKey(word);
    assert.equal(countWord(text,key), original(text,key), JSON.stringify({text,key}));
  }
});
