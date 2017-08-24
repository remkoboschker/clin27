const level = require('level');
const argv = require('minimist')(process.argv.slice(2));
const _ = require('highland');

const text = argv.f;
const standard = argv.s;
const dbname = `./db/${argv.f.split('.')[0]}`;
const database = level(dbname);
const { tokeniseAndStore } = require('./tokeniseAndStore');

tokeniseAndStore({
  filename: text,
  keyPrefix: 'txt',
  db: database,
}).done(() => {
  process.stdout.write('done with source text\n');
});

tokeniseAndStore({
  filename: standard,
  keyPrefix: 'std',
  db: database,
}).done(() => process.stdout.write('done with standard text\n'));
