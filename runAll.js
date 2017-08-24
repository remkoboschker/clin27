const Translator = require('./src/parallel');
const level = require('level');
const Immutable = require('immutable');

async function timer() {
  return new Promise((reject, resolve) => {
    setTimeout(resolve, 250);
  });
}

async function run(dbs) {
  console.log(dbs.size);
  if (dbs.size === 0) {
    return Promise.resolve();
  }
  const { textDb, textName } = dbs.first();
  const translator = Translator({
    textDb: level(textDb, { valueEncoding: 'json' }),
    vocabDb: level('./db/dict'),
    ngramsDb: level('./db/rob-ngram'),
    lexiconDb: level('./db/all'),
    vocabName: 'mydict',
    ngramName: 'rob',
    textName,
    levSum: 0.5,
    changeIfInDict: false,
    altProb: false,
  });
  console.log(textName);
  await timer();
  await translator.translate();
  return await run(dbs.shift());
}

const list = Immutable.List([
  {
    textDb: './db/1607-hooft-parallel',
    textName: 'hooft',
  },
  {
    textDb: './db/1616-bredero-parallel',
    textName: 'bredero',
  },
  {
    textDb: './db/1626-beeckman-parallel',
    textName: 'beeckman',
  },
  {
    textDb: './db/1636-degroot-parallel',
    textName: 'degroot',
  },
  {
    textDb: './db/1646-frederik-parallel',
    textName: 'frederik',
  },
  {
    textDb: './db/1656-vanriebeek-parallel',
    textName: 'vanriebeek',
  },
  {
    textDb: './db/1668-hamel-parallel',
    textName: 'hamel',
  },
  {
    textDb: './db/1678-leeuwenhoek-parallel',
    textName: 'leeuwenhoek',
  },
  {
    textDb: './db/1686-bidloo-parallel',
    textName: 'bidloo',
  },
  {
    textDb: './db/1692-huygens-parallel',
    textName: 'huygens',
  },
]);

run(list)
.then(() => {})
.catch((err) => {
  console.error(err);
  // process.stdout.write(err.message);
});
