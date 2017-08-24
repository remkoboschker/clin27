const level = require('level');
const _ = require('highland');

const db = level('./db/blankaart');

_(db.createReadStream({
  // gte: 'std\x00',
  // lte: 'std\x00\xff',
}))
.map(({ key, value }) => [...key.split('\x00'), value])
.group(a => a[0])
.flatMap(gr => _(gr.txt).zip(_(gr.std)))
.tap(pair => process.stdout.write(`${pair[0].join(' ')}\t\t${pair[1].join(' ')}\n`))
.done(() => {});
