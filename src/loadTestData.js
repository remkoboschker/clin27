// for easy evaluation both source and standard text are tokenized and loaded in
// a leveldb database sorted by key.
// [db name, prefix, paragraphNumber, sentenceNumber, wordNumber] should id the same word
// for source (txt prefix) and standard (std prefix)


const level = require('level');
const argv = require('minimist')(process.argv.slice(2));
const _ = require('highland');
const fs = require('fs');

const text = argv.f;
const dbname = `./db/${argv.f.split(/[./]/)[1]}`;
const database = level(dbname);


function pad(num) {
  return `000${num}`.slice(-4);
}

function tokenise(filestream) {
  const paragraphNumber = 1;
  let sentenceNumber = 0;
  let wordNumber = 0;
  return filestream
  // sentences
  .splitBy('\n')
  .flatMap((sentence) => {
    const words = sentence.match(/[^\s]+/g);
    if (words !== null) {
      sentenceNumber += 1;
      wordNumber = 0;
      return _(words)
      .map((word) => {
        wordNumber += 1;
        return { paragraphNumber, sentenceNumber, wordNumber, word };
      });
    }
    return _([]);
  });
}

function store({ keyPrefix, db }) {
  const put = _.wrapCallback(db.put.bind(db));
  return function ({ paragraphNumber, sentenceNumber, wordNumber, word }) {
    return put(`${keyPrefix}\x00${pad(paragraphNumber)}\x00${pad(sentenceNumber)}\x00${pad(wordNumber)}`, word);
  };
}

function tokeniseAndStore({ filename, keyPrefix, db }) {
  const storage = store({ keyPrefix, db });
  return _(fs.createReadStream(filename, { encoding: 'utf-8' }))
  .through(tokenise)
  .flatMap(storage);
}

tokeniseAndStore({
  filename: text,
  keyPrefix: 'txt',
  db: database,
}).done(() => {
  process.stdout.write('done with source text\n');
});

