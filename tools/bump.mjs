/**
 * 部署前跑一次：把 index.html、src/*.js 內所有資源網址加上 ?v=<時間戳>。
 *
 * 為什麼需要：GitHub Pages 對所有檔案都送 Cache-Control: max-age=600，
 * 同一個網址十分鐘內不會再問伺服器。換了版本號就等於換了網址，
 * 瀏覽器一定重新下載，不會出現「新 HTML + 舊 JS」的半新半舊狀況。
 *
 * 用法：
 *   node tools/bump.mjs          # 用現在時間做版本
 *   node tools/bump.mjs 20261118 # 指定版本
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp =
  process.argv[2] ||
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

let changed = 0;

function stampFile(file, rules) {
  const before = readFileSync(file, 'utf8');
  let after = before;
  for (const [re, rep] of rules) after = after.replace(re, rep);
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
    console.log('  bumped', file.replace(ROOT + '\\', '').replace(ROOT + '/', ''));
  }
}

// index.html：CSS 與進入點
stampFile(join(ROOT, 'index.html'), [
  [/(\.\/style\.css)(\?v=[^"']*)?/g, `$1?v=${stamp}`],
  [/(\.\/src\/main\.js)(\?v=[^"']*)?/g, `$1?v=${stamp}`],
]);

// src/*.js：所有相對 import 與資產網址
const importRe = /(from\s+['"])(\.\.?\/[^'"?]+\.js)(\?v=[^'"]*)?(['"])/g;
const assetRe = /(['"]assets\/[^'"?]+)(\?v=[^'"]*)?(['"])/g;

for (const name of readdirSync(SRC)) {
  if (!name.endsWith('.js')) continue;
  stampFile(join(SRC, name), [
    [importRe, `$1$2?v=${stamp}$4`],
    [assetRe, `$1?v=${stamp}$3`],
  ]);
}

console.log(`\n版本：${stamp}`);
console.log(changed ? `已更新 ${changed} 個檔案，記得 commit + push。` : '沒有任何改動。');
