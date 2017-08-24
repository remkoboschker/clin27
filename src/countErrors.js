// node countErrors.js tranlation.txt gold.txt

const fs = require('fs');
const _ = require('highland');

const translation = fs.createReadStream(process.argv[2], 'utf-8');
const gold = fs.createReadStream(process.argv[3], 'utf-8');
const translationTokens = _(translation).splitBy(/\s/);
const goldTokens = _(gold).splitBy(/\s/);

_.zip(translationTokens, goldTokens)
.filter(pair => pair[0] !== pair[1])
.map(pair => `${pair[0]}-${pair[1]}`)
.reduce((acc, val) => {
  if (acc.has(val)) {
    acc.set(val, acc.get(val) + 1);
  } else {
    acc.set(val, 1);
  }
  return acc;
}, new Map())
.flatMap(map => _(map.entries()))
.sortBy((a, b) => a[1] - b[1])
.tap(_.log)
.done(() => {});

