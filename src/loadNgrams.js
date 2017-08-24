const level = require('level');
const argv = require('minimist')(process.argv.slice(2));
const _ = require('highland');
const fs = require('fs');

const file = argv.f;
const name = argv.n;
const card = argv.c;
const database = level(`./db/${name}`);
const put = _.wrapCallback(database.put.bind(database));

_(fs.createReadStream(file, { encoding: 'utf-8' }))
.split()
.map(s => s.split(/\s/))
// .tap(_.log)
// .tap(([word]) => process.stdout.write(word.charAt(0)))
.flatMap((item) => {
  if (card === 0) {
    return put(`uni\x00${item[0]}`, 0);
  }
  if (card === 1) {
    return put(`uni\x00${item[0]}`, item[1]);
  }
  if (card === 2) {
    return put(`bi\x00${item[0]}\x00${item[1]}`, item[2]);
  }
  throw new Error('unsupported cardinality of ngram');
})
.done(() => process.stdout.write('finished\n'));
