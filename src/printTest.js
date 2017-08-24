const level = require('level');
const argv = require('minimist')(process.argv.slice(2));
const _ = require('highland');

const name = argv.f;
const db = level(`db/${name}`);

_(db.createReadStream())
.tap(_.log)
.done(() => {});
