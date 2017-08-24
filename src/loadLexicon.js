const level = require('level');
const argv = require('minimist')(process.argv.slice(2));
const _ = require('highland');
const fs = require('fs');

const text = argv.f;
const dbname = `./db/${argv.f.split(/[./]/)[0]}`;
const database = level(dbname, { });
console.log(dbname);

_(fs.createReadStream(text, { encoding: 'utf-8' }))
.split()
.flatMap((line) => {
  if (line === '') {
    return _([]);
  }
  const [orig, trans] = line.split(' ');
  const put = _.wrapCallback(database.put.bind(database));
  return put(orig, trans);
})
.done(() => { console.log('done'); });